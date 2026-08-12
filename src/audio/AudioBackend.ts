import type { CompiledCue } from '../timeline/types';

/**
 * Audio abstraction (spec §47). The engine talks only to this interface, so the
 * V0.2 WebAudio backend can replace BrowserTtsBackend without touching the
 * domain model, compiler or player core (spec §89).
 */

export type AudioTelemetryPhase = 'requested' | 'started' | 'ended' | 'error';

export type VisibilityState = 'visible' | 'hidden';

export interface AudioTelemetryEvent {
  cueId: string;
  /** Monotonic per-playback id, so repeated plays of the same cue stay distinct. */
  playbackId: number;
  phase: AudioTelemetryPhase;
  /** Clock time (same clock as the engine) when the phase happened. */
  atMs: number;
  visibilityState: VisibilityState;
  error?: string;
}

export type AudioTelemetryListener = (event: AudioTelemetryEvent) => void;

export interface AudioBackend {
  /** Warm-up hook (voice list, buffers). Must be safe to call repeatedly. */
  prepare(cues: CompiledCue[]): Promise<void>;
  play(cue: CompiledCue): void;
  cancelAll(): void;
  setTelemetryListener(listener: AudioTelemetryListener | null): void;
}

/** Backend used in tests and when audio is muted. */
export class NullAudioBackend implements AudioBackend {
  readonly played: CompiledCue[] = [];
  private listener: AudioTelemetryListener | null = null;
  private playbackId = 0;

  async prepare(): Promise<void> {
    // nothing to do
  }

  play(cue: CompiledCue): void {
    this.played.push(cue);
    this.playbackId += 1;
    this.listener?.({
      cueId: cue.id,
      playbackId: this.playbackId,
      phase: 'requested',
      atMs: 0,
      visibilityState: 'visible',
    });
  }

  cancelAll(): void {
    // nothing to cancel
  }

  setTelemetryListener(listener: AudioTelemetryListener | null): void {
    this.listener = listener;
  }
}
