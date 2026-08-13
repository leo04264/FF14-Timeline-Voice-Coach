import { PerformanceClock, type Clock } from '../engine/Clock';
import type { CompiledCue } from '../timeline/types';
import type {
  AudioBackend,
  AudioTelemetryListener,
  AudioTelemetryPhase,
  VisibilityState,
} from './AudioBackend';

/**
 * V0.1 audio backend: Web Speech API (spec §48).
 *
 * Everything speechSynthesis-specific is confined to this file; the engine only
 * knows AudioBackend (spec §97).
 */

export interface BrowserTtsOptions {
  clock?: Clock;
  visibility?: () => VisibilityState;
}

function defaultVisibility(): VisibilityState {
  if (typeof document === 'undefined') return 'visible';
  return document.visibilityState === 'hidden' ? 'hidden' : 'visible';
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export class BrowserTtsBackend implements AudioBackend {
  private readonly clock: Clock;
  private readonly visibility: () => VisibilityState;
  private listener: AudioTelemetryListener | null = null;
  private playbackId = 0;
  private voices: SpeechSynthesisVoice[] = [];

  constructor(options: BrowserTtsOptions = {}) {
    this.clock = options.clock ?? new PerformanceClock();
    this.visibility = options.visibility ?? defaultVisibility;
  }

  async prepare(_cues: CompiledCue[]): Promise<void> {
    if (!isSpeechSynthesisSupported()) return;
    // Some Chrome builds keep the first utterance queued until the synthesiser
    // has been touched at least once inside a user gesture.
    //
    // This must happen *synchronously*, before awaiting the voice list. The
    // player calls load() (which fires prepare) immediately before start(), and
    // start() can dispatch an already-overdue cue in the same tick. Cancelling
    // after the await would land in a later microtask and kill that utterance —
    // the first cue of every pull would fail with `canceled`.
    window.speechSynthesis.cancel();
    this.voices = await loadVoices();
  }

  getVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }

  play(cue: CompiledCue): void {
    this.playbackId += 1;
    const playbackId = this.playbackId;

    if (!isSpeechSynthesisSupported()) {
      this.report(cue.id, playbackId, 'error', 'speechSynthesis is not available');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cue.text);
    utterance.lang = cue.audio.lang;
    utterance.rate = cue.audio.rate;
    utterance.pitch = cue.audio.pitch;
    utterance.volume = cue.audio.volume;

    if (cue.audio.voiceUri) {
      const voice = this.voices.find((candidate) => candidate.voiceURI === cue.audio.voiceUri);
      if (voice) utterance.voice = voice;
    }

    utterance.onstart = () => this.report(cue.id, playbackId, 'started');
    utterance.onend = () => this.report(cue.id, playbackId, 'ended');
    utterance.onerror = (event) =>
      this.report(cue.id, playbackId, 'error', (event as SpeechSynthesisErrorEvent).error);

    this.report(cue.id, playbackId, 'requested');
    window.speechSynthesis.speak(utterance);
  }

  /** Speak arbitrary text (voice preview in Settings). Not telemetered. */
  speakPreview(text: string, config: { lang: string; rate: number; pitch: number; volume: number; voiceUri?: string }): boolean {
    if (!isSpeechSynthesisSupported()) return false;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = config.lang;
    utterance.rate = config.rate;
    utterance.pitch = config.pitch;
    utterance.volume = config.volume;
    if (config.voiceUri) {
      const voice = this.voices.find((candidate) => candidate.voiceURI === config.voiceUri);
      if (voice) utterance.voice = voice;
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    return true;
  }

  cancelAll(): void {
    if (!isSpeechSynthesisSupported()) return;
    window.speechSynthesis.cancel();
  }

  setTelemetryListener(listener: AudioTelemetryListener | null): void {
    this.listener = listener;
  }

  private report(
    cueId: string,
    playbackId: number,
    phase: AudioTelemetryPhase,
    error?: string,
  ): void {
    this.listener?.({
      cueId,
      playbackId,
      phase,
      atMs: this.clock.nowMs(),
      visibilityState: this.visibility(),
      error,
    });
  }
}

/** Chrome populates the voice list asynchronously. */
export function loadVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  if (!isSpeechSynthesisSupported()) return Promise.resolve([]);

  const immediate = window.speechSynthesis.getVoices();
  if (immediate.length > 0) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener('voiceschanged', finish);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', finish);
    setTimeout(finish, timeoutMs);
  });
}
