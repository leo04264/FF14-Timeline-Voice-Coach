import type { CompiledCue } from '../timeline/types';
import type { AudioBackend, AudioTelemetryListener } from './AudioBackend';
import type { AudioLease, AudioOwnershipManager } from './AudioOwnership';

/**
 * Ownership gate in front of the real audio backend (spec §7.3.5).
 *
 * The engine is framework-free and simply calls `prepare` / `play` /
 * `cancelAll`. Those calls are destructive on a *shared* `speechSynthesis`, so
 * this proxy forwards them only while the playback side actually holds the
 * audio lease:
 *
 *   - idle `engine.load()` (which the player runs whenever inputs change) no
 *     longer cancels an editor preview, and its `prepare()` warm-up no longer
 *     fires `speechSynthesis.cancel()` behind a preview's back
 *   - `play()` implies a pull is running, so it takes the lease if the caller
 *     forgot to; playback outranks every preview
 *
 * The player takes the lease explicitly in `requestStart`, before `load()`, so
 * the Chrome warm-up inside `prepare()` still happens with the device held.
 */
export class OwnedAudioBackend implements AudioBackend {
  private lease: AudioLease | null = null;

  constructor(
    private readonly inner: AudioBackend,
    private readonly ownership: AudioOwnershipManager,
  ) {}

  get holdsLease(): boolean {
    return this.lease?.active === true;
  }

  /**
   * Take the audio device for a pull. Idempotent while already held.
   *
   * `onRevoke` is not supplied: playback has the highest priority, so nothing
   * can take the device away from it.
   */
  acquireForPlayback(): void {
    if (this.holdsLease) return;
    this.lease = this.ownership.acquire('playback', {
      onAcquire: () => {
        // Clear whatever a preview had queued, now that playback owns it.
        this.inner.cancelAll();
      },
    });
  }

  /** Release after WIPE / completion / unmount, cancelling our own speech. */
  releasePlayback(): void {
    const lease = this.lease;
    this.lease = null;
    if (lease?.active !== true) return;
    this.inner.cancelAll();
    lease.release();
  }

  async prepare(cues: CompiledCue[]): Promise<void> {
    // Warm-up is destructive (it cancels), so it needs the device.
    if (!this.holdsLease) return;
    await this.inner.prepare(cues);
  }

  play(cue: CompiledCue): void {
    // A cue firing means a pull is live; make sure we own the device.
    if (!this.holdsLease) this.acquireForPlayback();
    this.inner.play(cue);
  }

  cancelAll(): void {
    if (!this.holdsLease) return;
    this.inner.cancelAll();
  }

  setTelemetryListener(listener: AudioTelemetryListener | null): void {
    this.inner.setTelemetryListener(listener);
  }
}
