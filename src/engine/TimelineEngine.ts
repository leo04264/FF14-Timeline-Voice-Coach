import type { AudioBackend, VisibilityState } from '../audio/AudioBackend';
import type { CompiledCue, CompiledTimeline } from '../timeline/types';
import { IntervalTicker, PerformanceClock, type Clock, type Ticker } from './Clock';

/**
 * Framework-free timeline runtime (spec §30). No React, no speechSynthesis,
 * no localStorage in here — the engine owns time and cue dispatch only.
 */

export type EngineState = 'idle' | 'countdown' | 'running' | 'paused' | 'completed';

export const DEFAULT_TICK_INTERVAL_MS = 50;
export const DEFAULT_MAX_LATE_MS = 3000;
/** UI refresh cadence; decoupled from the 50ms scheduler tick (spec §94). */
export const DEFAULT_NOTIFY_INTERVAL_MS = 100;

export interface EngineOptions {
  audio: AudioBackend;
  clock?: Clock;
  ticker?: Ticker;
  tickIntervalMs?: number;
  /** Cues later than this are skipped instead of played (spec §85). */
  maxLateMs?: number;
  notifyIntervalMs?: number;
  visibility?: () => VisibilityState;
}

export type EngineEvent =
  | { type: 'state-change'; pullId: number; state: EngineState }
  | { type: 'pull-started'; pullId: number }
  | { type: 'wipe'; pullId: number }
  | { type: 'completed'; pullId: number }
  | {
      type: 'cue-fired';
      pullId: number;
      cue: CompiledCue;
      /** Cue due -> engine trigger, in ms (spec §50). */
      engineLateMs: number;
      timelineElapsedMs: number;
      atMs: number;
      visibilityState: VisibilityState;
    }
  | {
      type: 'cue-skipped';
      pullId: number;
      cue: CompiledCue;
      lateByMs: number;
      timelineElapsedMs: number;
      atMs: number;
      visibilityState: VisibilityState;
    };

export type EngineEventListener = (event: EngineEvent) => void;

export interface EngineSnapshot {
  state: EngineState;
  pullId: number;
  timelineId: string | null;
  timelineName: string;
  durationMs: number;
  countdownMs: number;
  /** Wall time since START minus the countdown. */
  rawElapsedMs: number;
  timelineElapsedMs: number;
  sessionOffsetMs: number;
  pullOffsetMs: number;
  effectiveOffsetMs: number;
  currentCue: CompiledCue | null;
  /** Clock time the current cue fired at, for the 3s highlight (spec §45). */
  currentCueAtMs: number | null;
  nextCues: CompiledCue[];
  firedCount: number;
  skippedCount: number;
  totalCues: number;
  hasTimeline: boolean;
}

const IDLE_SNAPSHOT: EngineSnapshot = {
  state: 'idle',
  pullId: 0,
  timelineId: null,
  timelineName: '',
  durationMs: 0,
  countdownMs: 0,
  rawElapsedMs: 0,
  timelineElapsedMs: 0,
  sessionOffsetMs: 0,
  pullOffsetMs: 0,
  effectiveOffsetMs: 0,
  currentCue: null,
  currentCueAtMs: null,
  nextCues: [],
  firedCount: 0,
  skippedCount: 0,
  totalCues: 0,
  hasTimeline: false,
};

const NEXT_CUE_COUNT = 3;

function defaultVisibility(): VisibilityState {
  if (typeof document === 'undefined') return 'visible';
  return document.visibilityState === 'hidden' ? 'hidden' : 'visible';
}

export class TimelineEngine {
  private readonly clock: Clock;
  private readonly ticker: Ticker;
  private readonly audio: AudioBackend;
  private readonly tickIntervalMs: number;
  private readonly maxLateMs: number;
  private readonly notifyIntervalMs: number;
  private readonly visibility: () => VisibilityState;

  private compiled: CompiledTimeline | null = null;
  private state: EngineState = 'idle';
  private pullId = 0;

  private startedAtMs = 0;
  private pausedAtMs: number | null = null;
  private pausedTotalMs = 0;

  private cueIndex = 0;
  private firedCount = 0;
  private skippedCount = 0;
  private currentCue: CompiledCue | null = null;
  private currentCueAtMs: number | null = null;

  private sessionOffsetMs = 0;
  private pullOffsetMs = 0;

  private snapshot: EngineSnapshot = IDLE_SNAPSHOT;
  private lastNotifyMs = Number.NEGATIVE_INFINITY;
  private readonly storeListeners = new Set<() => void>();
  private readonly eventListeners = new Set<EngineEventListener>();

  constructor(options: EngineOptions) {
    this.audio = options.audio;
    this.clock = options.clock ?? new PerformanceClock();
    this.ticker = options.ticker ?? new IntervalTicker();
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.maxLateMs = options.maxLateMs ?? DEFAULT_MAX_LATE_MS;
    this.notifyIntervalMs = options.notifyIntervalMs ?? DEFAULT_NOTIFY_INTERVAL_MS;
    this.visibility = options.visibility ?? defaultVisibility;
  }

  // ---------------------------------------------------------------- lifecycle

  /** Load a compiled timeline. Resets runtime state but keeps the session offset. */
  load(compiled: CompiledTimeline): void {
    this.stopTicker();
    this.audio.cancelAll();
    this.compiled = compiled;
    this.resetRuntime();
    this.setState('idle', true);
    void this.audio.prepare(compiled.cues);
  }

  unload(): void {
    this.stopTicker();
    this.audio.cancelAll();
    this.compiled = null;
    this.resetRuntime();
    this.setState('idle', true);
  }

  /** Start a fresh pull. The UI requires WIPE before calling this again. */
  start(): void {
    if (!this.compiled) return;
    this.audio.cancelAll();
    this.resetRuntime();

    this.pullId += 1;
    this.startedAtMs = this.clock.nowMs();
    this.state = this.compiled.countdownMs > 0 ? 'countdown' : 'running';

    this.emit({ type: 'pull-started', pullId: this.pullId });
    this.emit({ type: 'state-change', pullId: this.pullId, state: this.state });

    this.ticker.start(() => this.tick(), this.tickIntervalMs);
    this.tick();
    this.notify(true);
  }

  /** WIPE / RESET (spec §38, §39). Session offset survives; pull offset does not. */
  wipe(): void {
    this.stopTicker();
    this.audio.cancelAll();
    const pullId = this.pullId;
    this.resetRuntime();
    this.state = 'idle';
    this.emit({ type: 'wipe', pullId });
    this.emit({ type: 'state-change', pullId, state: 'idle' });
    this.notify(true);
  }

  /** Debug / Practice only — FF14 fights cannot be paused (spec §40). */
  pause(): void {
    if (this.state !== 'countdown' && this.state !== 'running') return;
    this.pausedAtMs = this.clock.nowMs();
    this.stopTicker();
    this.setState('paused', true);
  }

  resume(): void {
    if (this.state !== 'paused' || this.pausedAtMs === null) return;
    this.pausedTotalMs += this.clock.nowMs() - this.pausedAtMs;
    this.pausedAtMs = null;
    this.state = this.timelineElapsedMs() < 0 ? 'countdown' : 'running';
    this.emit({ type: 'state-change', pullId: this.pullId, state: this.state });
    this.ticker.start(() => this.tick(), this.tickIntervalMs);
    this.tick();
    this.notify(true);
  }

  destroy(): void {
    this.stopTicker();
    this.audio.cancelAll();
    this.storeListeners.clear();
    this.eventListeners.clear();
  }

  // ------------------------------------------------------------------ offsets

  /** Survives WIPE and pulls (spec §34). */
  setSessionOffsetMs(ms: number): void {
    if (!Number.isFinite(ms)) return;
    this.sessionOffsetMs = Math.round(ms);
    this.notify(true);
  }

  /** Cleared on WIPE (spec §35). */
  setPullOffsetMs(ms: number): void {
    if (!Number.isFinite(ms)) return;
    this.pullOffsetMs = Math.round(ms);
    // Cues already dispatched are never replayed: the cue index only moves
    // forward, so a negative nudge cannot rewind past them.
    this.notify(true);
  }

  adjustPullOffsetMs(deltaMs: number): void {
    this.setPullOffsetMs(this.pullOffsetMs + deltaMs);
  }

  adjustSessionOffsetMs(deltaMs: number): void {
    this.setSessionOffsetMs(this.sessionOffsetMs + deltaMs);
  }

  get effectiveOffsetMs(): number {
    return this.sessionOffsetMs + this.pullOffsetMs;
  }

  // ---------------------------------------------------------------- subscribe

  /** useSyncExternalStore-compatible subscription. */
  subscribe = (listener: () => void): (() => void) => {
    this.storeListeners.add(listener);
    return () => {
      this.storeListeners.delete(listener);
    };
  };

  getSnapshot = (): EngineSnapshot => this.snapshot;

  addEventListener(listener: EngineEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  // --------------------------------------------------------------------- tick

  /** Advance the runtime. Public so tests can drive it with a FakeClock. */
  tick(): void {
    if (!this.compiled) return;
    if (this.state !== 'countdown' && this.state !== 'running') return;

    const elapsed = this.timelineElapsedMs();
    const cues = this.compiled.cues;

    if (this.state === 'countdown' && elapsed >= 0) {
      this.state = 'running';
      this.emit({ type: 'state-change', pullId: this.pullId, state: 'running' });
      this.notify(true);
    }

    let fired = false;
    while (this.cueIndex < cues.length && cues[this.cueIndex].triggerMs <= elapsed) {
      const cue = cues[this.cueIndex];
      this.cueIndex += 1;

      const lateByMs = elapsed - cue.triggerMs;
      const atMs = this.clock.nowMs();
      const visibilityState = this.visibility();

      if (lateByMs > this.maxLateMs) {
        // Browser threw us a long stall; do not dump stale lines (spec §85).
        this.skippedCount += 1;
        this.emit({
          type: 'cue-skipped',
          pullId: this.pullId,
          cue,
          lateByMs,
          timelineElapsedMs: elapsed,
          atMs,
          visibilityState,
        });
        fired = true;
        continue;
      }

      this.emit({
        type: 'cue-fired',
        pullId: this.pullId,
        cue,
        engineLateMs: lateByMs,
        timelineElapsedMs: elapsed,
        atMs,
        visibilityState,
      });
      this.audio.play(cue);
      this.firedCount += 1;
      this.currentCue = cue;
      this.currentCueAtMs = atMs;
      fired = true;
    }

    if (this.cueIndex >= cues.length && elapsed >= this.compiled.durationMs) {
      this.stopTicker();
      this.state = 'completed';
      this.emit({ type: 'completed', pullId: this.pullId });
      this.emit({ type: 'state-change', pullId: this.pullId, state: 'completed' });
      this.notify(true);
      return;
    }

    this.notify(fired);
  }

  // ------------------------------------------------------------------ helpers

  private timelineElapsedMs(): number {
    if (!this.compiled) return 0;
    if (this.state === 'idle') return -this.compiled.countdownMs;
    const reference = this.pausedAtMs ?? this.clock.nowMs();
    const wallElapsed = reference - this.startedAtMs - this.pausedTotalMs;
    const rawElapsed = wallElapsed - this.compiled.countdownMs;
    return rawElapsed - this.effectiveOffsetMs;
  }

  private rawElapsedMs(): number {
    return this.timelineElapsedMs() + this.effectiveOffsetMs;
  }

  private resetRuntime(): void {
    this.cueIndex = 0;
    this.firedCount = 0;
    this.skippedCount = 0;
    this.currentCue = null;
    this.currentCueAtMs = null;
    this.pullOffsetMs = 0;
    this.pausedAtMs = null;
    this.pausedTotalMs = 0;
    this.startedAtMs = this.clock.nowMs();
  }

  private setState(state: EngineState, forceNotify = false): void {
    if (this.state === state) {
      if (forceNotify) this.notify(true);
      return;
    }
    this.state = state;
    this.emit({ type: 'state-change', pullId: this.pullId, state });
    this.notify(true);
  }

  private stopTicker(): void {
    this.ticker.stop();
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  private buildSnapshot(): EngineSnapshot {
    const compiled = this.compiled;
    if (!compiled) {
      return { ...IDLE_SNAPSHOT, sessionOffsetMs: this.sessionOffsetMs, pullId: this.pullId };
    }

    const timelineElapsedMs =
      this.state === 'idle' ? -compiled.countdownMs : this.timelineElapsedMs();

    return {
      state: this.state,
      pullId: this.pullId,
      timelineId: compiled.timelineId,
      timelineName: compiled.name,
      durationMs: compiled.durationMs,
      countdownMs: compiled.countdownMs,
      rawElapsedMs: this.state === 'idle' ? -compiled.countdownMs : this.rawElapsedMs(),
      timelineElapsedMs,
      sessionOffsetMs: this.sessionOffsetMs,
      pullOffsetMs: this.pullOffsetMs,
      effectiveOffsetMs: this.effectiveOffsetMs,
      currentCue: this.currentCue,
      currentCueAtMs: this.currentCueAtMs,
      nextCues: compiled.cues.slice(this.cueIndex, this.cueIndex + NEXT_CUE_COUNT),
      firedCount: this.firedCount,
      skippedCount: this.skippedCount,
      totalCues: compiled.cues.length,
      hasTimeline: true,
    };
  }

  /**
   * Snapshot updates are throttled to `notifyIntervalMs`; cue and state changes
   * force an immediate update so the UI never lags behind audio.
   */
  private notify(force: boolean): void {
    const now = this.clock.nowMs();
    if (!force && now - this.lastNotifyMs < this.notifyIntervalMs) return;
    this.lastNotifyMs = now;
    this.snapshot = this.buildSnapshot();
    for (const listener of this.storeListeners) listener();
  }
}
