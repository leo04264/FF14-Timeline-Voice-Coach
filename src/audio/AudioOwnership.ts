/**
 * Application-level audio ownership (spec §7.3).
 *
 * Creating a second `BrowserTtsBackend` does *not* isolate anything: both talk
 * to the one `window.speechSynthesis`, and `cancel()` from either kills the
 * other's utterances. So instead of pretending there are two devices, exactly
 * one owner may hold the synthesiser at a time, and every caller must acquire
 * it before speaking and release it when done.
 *
 * Scope is this application instance only — no cross-tab or cross-device
 * coordination is attempted.
 */

export type AudioOwnerKind = 'playback' | 'cue-preview' | 'segment-preview' | 'settings-preview';

/** Priority order: a live pull outranks every editor-side preview. */
const RANK: Readonly<Record<AudioOwnerKind, number>> = {
  playback: 0,
  'segment-preview': 1,
  'cue-preview': 2,
  'settings-preview': 3,
};

export interface AudioLease {
  readonly kind: AudioOwnerKind;
  readonly id: number;
  /** False once this lease has been released or revoked. */
  readonly active: boolean;
  release(): void;
}

export interface AcquireOptions {
  /**
   * Called when somebody with higher priority takes over, or when the same kind
   * re-acquires (a new preview replacing the previous one). Must stop the
   * caller's own playback and schedules — it must NOT cancel the synthesiser,
   * because by then the next owner may already be speaking.
   */
  onRevoke?: () => void;
  /**
   * Called after the lease is granted so the previous owner's queued speech can
   * be cleared. Only the incoming owner does this, exactly once.
   */
  onAcquire?: () => void;
}

export class AudioOwnershipConflict extends Error {
  constructor(readonly current: AudioOwnerKind) {
    super(
      current === 'playback'
        ? '正式播放進行中，請先重置或等這一場結束，才能使用編輯器試聽'
        : '另一個試聽正在進行中',
    );
    this.name = 'AudioOwnershipConflict';
  }
}

interface Holder {
  kind: AudioOwnerKind;
  id: number;
  onRevoke?: () => void;
}

export class AudioOwnershipManager {
  private holder: Holder | null = null;
  private nextId = 1;
  private readonly listeners = new Set<() => void>();

  get currentKind(): AudioOwnerKind | null {
    return this.holder?.kind ?? null;
  }

  /** True when this kind could take the synthesiser right now. */
  canAcquire(kind: AudioOwnerKind): boolean {
    if (!this.holder) return true;
    // Same kind always replaces itself (a new preview stops the old one).
    if (this.holder.kind === kind) return true;
    return RANK[kind] < RANK[this.holder.kind];
  }

  /**
   * Take ownership.
   *
   * Throws {@link AudioOwnershipConflict} rather than silently cancelling a
   * higher-priority owner, so an editor preview can never interrupt a pull.
   */
  acquire(kind: AudioOwnerKind, options: AcquireOptions = {}): AudioLease {
    if (!this.canAcquire(kind)) {
      throw new AudioOwnershipConflict(this.holder!.kind);
    }

    const previous = this.holder;
    if (previous) {
      this.holder = null;
      // Let the outgoing owner stop its own timers before we clear the queue.
      previous.onRevoke?.();
    }

    const id = this.nextId;
    this.nextId += 1;
    this.holder = { kind, id, onRevoke: options.onRevoke };
    options.onAcquire?.();
    this.notify();

    const manager = this;
    return {
      kind,
      id,
      get active() {
        return manager.holder?.id === id;
      },
      release() {
        manager.releaseById(id);
      },
    };
  }

  /**
   * Acquire without throwing. Returns `null` when refused, so UI can simply
   * disable a button.
   */
  tryAcquire(kind: AudioOwnerKind, options: AcquireOptions = {}): AudioLease | null {
    try {
      return this.acquire(kind, options);
    } catch (error) {
      if (error instanceof AudioOwnershipConflict) return null;
      throw error;
    }
  }

  releaseById(id: number): void {
    if (this.holder?.id !== id) return; // already revoked; do not touch the new owner
    this.holder = null;
    this.notify();
  }

  /** Force-release whatever is held, e.g. on unmount of the whole app. */
  releaseAll(): void {
    const previous = this.holder;
    this.holder = null;
    previous?.onRevoke?.();
    this.notify();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AudioOwnerKind | null => this.holder?.kind ?? null;

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Shared instance for the app; tests build their own. */
export const audioOwnership = new AudioOwnershipManager();
