import type { AudioBackend } from '../audio/AudioBackend';
import type { AudioLease, AudioOwnershipManager } from '../audio/AudioOwnership';
import { IntervalTicker, PerformanceClock, type Clock, type Ticker } from '../engine/Clock';
import type { CompiledCue } from '../timeline/types';

/**
 * Editor-side segment preview (spec §7.2).
 *
 * Deliberately *not* the real engine: it has its own clock and ticker, and it
 * never touches `pullId`, the engine snapshot, the debug recorder, or the
 * session/pull offsets. Preview time is plain editing-timeline time.
 *
 * Cues are dispatched at their real relative spacing, so a collision can
 * actually be heard, and nothing outside the window is ever spoken.
 */

export const DEFAULT_PREVIEW_PADDING_MS = 5000;

export type PreviewState = 'idle' | 'playing' | 'draining' | 'stopped' | 'error';

export interface PreviewWindow {
  startMs: number;
  endMs: number;
  centerMs: number;
}

export interface PreviewSnapshot {
  state: PreviewState;
  window: PreviewWindow | null;
  /** Preview-timeline position, in the same coordinates as the cue triggers. */
  positionMs: number;
  firedCueIds: string[];
  pendingCount: number;
  error: string | null;
}

const IDLE: PreviewSnapshot = {
  state: 'idle',
  window: null,
  positionMs: 0,
  firedCueIds: [],
  pendingCount: 0,
  error: null,
};

export interface PreviewControllerOptions {
  audio: AudioBackend;
  ownership: AudioOwnershipManager;
  clock?: Clock;
  ticker?: Ticker;
  tickIntervalMs?: number;
  /** How long to keep the lease after the last cue, so speech can finish. */
  drainMs?: number;
}

export interface StartPreviewInput {
  /** Cues of the run being previewed, already filtered to the current profile. */
  cues: readonly CompiledCue[];
  /** Instant the window is centred on, usually a reminder's trigger time. */
  centerMs: number;
  paddingMs?: number;
  /** Clamp bounds: `[-countdownMs, durationMs]`. */
  minMs: number;
  maxMs: number;
}

export type StartPreviewResult =
  | { ok: true; window: PreviewWindow; cueCount: number }
  | { ok: false; error: string };

export function previewWindowFor(input: StartPreviewInput): PreviewWindow {
  const padding = input.paddingMs ?? DEFAULT_PREVIEW_PADDING_MS;
  const startMs = Math.max(input.minMs, input.centerMs - padding);
  const endMs = Math.min(input.maxMs, input.centerMs + padding);
  return { startMs, endMs, centerMs: input.centerMs };
}

export class PreviewController {
  private readonly audio: AudioBackend;
  private readonly ownership: AudioOwnershipManager;
  private readonly clock: Clock;
  private readonly ticker: Ticker;
  private readonly tickIntervalMs: number;
  private readonly drainMs: number;

  private snapshot: PreviewSnapshot = IDLE;
  private readonly listeners = new Set<() => void>();

  private lease: AudioLease | null = null;
  private queue: CompiledCue[] = [];
  private cursor = 0;
  private window: PreviewWindow | null = null;
  private startedAtMs = 0;
  private drainUntilMs: number | null = null;
  /** Bumped on every start/stop so stale async callbacks can be ignored. */
  private runToken = 0;

  constructor(options: PreviewControllerOptions) {
    this.audio = options.audio;
    this.ownership = options.ownership;
    this.clock = options.clock ?? new PerformanceClock();
    this.ticker = options.ticker ?? new IntervalTicker();
    this.tickIntervalMs = options.tickIntervalMs ?? 50;
    this.drainMs = options.drainMs ?? 4000;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PreviewSnapshot => this.snapshot;

  /** Speak one cue on its own (single-cue audition, spec §7.1). */
  previewSingleCue(cue: CompiledCue): StartPreviewResult {
    const token = this.beginRun('cue-preview');
    if (typeof token === 'string') return { ok: false, error: token };

    // Uses the cue's *resolved* audio config, including per-cue overrides.
    this.audio.play(cue);
    this.window = null;
    this.queue = [];
    this.cursor = 0;
    this.drainUntilMs = this.clock.nowMs() + this.drainMs;
    this.set({
      state: 'draining',
      window: null,
      positionMs: cue.triggerMs,
      firedCueIds: [cue.id],
      pendingCount: 0,
      error: null,
    });
    this.ticker.start(() => this.tick(), this.tickIntervalMs);
    return { ok: true, window: { startMs: cue.triggerMs, endMs: cue.triggerMs, centerMs: cue.triggerMs }, cueCount: 1 };
  }

  /** Play everything inside the window, at real relative spacing. */
  start(input: StartPreviewInput): StartPreviewResult {
    const window = previewWindowFor(input);
    if (window.endMs < window.startMs) {
      return { ok: false, error: '預覽區間無效（結束時間早於開始時間）' };
    }

    const token = this.beginRun('segment-preview');
    if (typeof token === 'string') return { ok: false, error: token };

    this.queue = input.cues
      .filter((cue) => cue.triggerMs >= window.startMs && cue.triggerMs <= window.endMs)
      .slice()
      .sort((a, b) => a.triggerMs - b.triggerMs);
    this.cursor = 0;
    this.window = window;
    this.startedAtMs = this.clock.nowMs();
    this.drainUntilMs = null;

    this.set({
      state: 'playing',
      window,
      positionMs: window.startMs,
      firedCueIds: [],
      pendingCount: this.queue.length,
      error: null,
    });

    this.ticker.start(() => this.tick(), this.tickIntervalMs);
    // Dispatch anything already due at the very first instant of the window.
    this.tick();
    return { ok: true, window, cueCount: this.queue.length };
  }

  /** Stop immediately and cancel everything still queued. */
  stop(reason: string | null = null): void {
    this.runToken += 1;
    this.ticker.stop();
    const hadLease = this.lease !== null;
    this.queue = [];
    this.cursor = 0;
    this.drainUntilMs = null;
    if (hadLease) {
      // Only cancel while we still own the device.
      this.audio.cancelAll();
      this.lease?.release();
      this.lease = null;
    }
    this.set({
      ...this.snapshot,
      state: reason === null ? 'stopped' : 'error',
      pendingCount: 0,
      error: reason,
    });
  }

  /** Release resources without reporting an error (unmount / navigate away). */
  dispose(): void {
    this.stop(null);
    this.listeners.clear();
  }

  /** Advance preview time. Public so tests can drive it with a FakeClock. */
  tick(): void {
    if (this.snapshot.state !== 'playing' && this.snapshot.state !== 'draining') return;

    if (this.snapshot.state === 'draining') {
      if (this.drainUntilMs !== null && this.clock.nowMs() >= this.drainUntilMs) {
        this.finish();
      }
      return;
    }

    const window = this.window;
    if (!window) return;

    const positionMs = window.startMs + (this.clock.nowMs() - this.startedAtMs);
    const fired = [...this.snapshot.firedCueIds];

    while (this.cursor < this.queue.length && this.queue[this.cursor].triggerMs <= positionMs) {
      const cue = this.queue[this.cursor];
      this.cursor += 1;
      // Past the window end nothing new is dispatched (spec §7.2.6).
      if (cue.triggerMs > window.endMs) continue;
      this.audio.play(cue);
      fired.push(cue.id);
    }

    const done = this.cursor >= this.queue.length && positionMs >= window.endMs;
    if (done) {
      // Keep the lease briefly so the last utterance is not cut off.
      this.drainUntilMs = this.clock.nowMs() + this.drainMs;
      this.set({
        state: 'draining',
        window,
        positionMs: window.endMs,
        firedCueIds: fired,
        pendingCount: 0,
        error: null,
      });
      return;
    }

    this.set({
      state: 'playing',
      window,
      positionMs,
      firedCueIds: fired,
      pendingCount: this.queue.length - this.cursor,
      error: null,
    });
  }

  private finish(): void {
    this.runToken += 1;
    this.ticker.stop();
    this.drainUntilMs = null;
    if (this.lease) {
      this.lease.release();
      this.lease = null;
    }
    this.set({ ...this.snapshot, state: 'stopped', pendingCount: 0 });
  }

  /**
   * Take the audio device for a new preview run.
   * Returns the run token, or a readable error string when refused.
   */
  private beginRun(kind: 'cue-preview' | 'segment-preview'): number | string {
    // A previous preview is stopped first, and its lease released, so
    // re-acquiring cannot revoke ourselves half-way.
    if (this.lease) this.stop(null);

    const lease = this.ownership.tryAcquire(kind, {
      onRevoke: () => {
        // Somebody with higher priority took over: stop our ticker and drop the
        // queue, but never call cancelAll here — the new owner may be speaking.
        this.runToken += 1;
        this.ticker.stop();
        this.queue = [];
        this.cursor = 0;
        this.drainUntilMs = null;
        this.lease = null;
        this.set({ ...this.snapshot, state: 'stopped', pendingCount: 0 });
      },
      onAcquire: () => {
        // Clear whatever the previous owner had queued, now that we hold it.
        this.audio.cancelAll();
      },
    });

    if (!lease) {
      const holder = this.ownership.currentKind;
      const message =
        holder === 'playback'
          ? '正式播放進行中：請先重置或等這一場結束，才能在編輯器試聽'
          : '另一個試聽正在進行中';
      this.set({ ...this.snapshot, state: 'error', error: message });
      return message;
    }

    this.lease = lease;
    this.runToken += 1;
    return this.runToken;
  }

  private set(next: PreviewSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
