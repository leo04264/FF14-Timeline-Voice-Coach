import { combineTargets, matchesTarget } from './target';
import { validateTimeline, type ValidationReport } from './validator';
import type {
  AudioConfig,
  CompiledCue,
  CompiledTimeline,
  CuePriority,
  PlayerProfile,
  ResolvedAudioConfig,
  TimelinePackage,
} from './types';

/** Browser TTS defaults (spec §48). */
export const DEFAULT_AUDIO_CONFIG: ResolvedAudioConfig = {
  lang: 'zh-TW',
  rate: 1.15,
  pitch: 1,
  volume: 1,
};

export const DEFAULT_CUE_PRIORITY: CuePriority = 'normal';

const PRIORITY_RANK: Readonly<Record<CuePriority, number>> = {
  high: 0,
  normal: 1,
  low: 2,
};

export interface CompileOptions {
  profile: PlayerProfile;
  /** Tracks the player switched on before START (spec §43). */
  enabledTrackIds: readonly string[];
  /** Countdown override; falls back to `encounter.countdownMs` (spec §17). */
  countdownMs?: number;
  /** Player-level audio settings; per-cue `audio` wins over these. */
  audioDefaults?: AudioConfig;
}

export class TimelineCompileError extends Error {
  readonly report: ValidationReport;

  constructor(report: ValidationReport) {
    super(`這份時間軸有 ${report.errors.length} 個必須修正的錯誤，無法編譯`);
    this.name = 'TimelineCompileError';
    this.report = report;
  }
}

function resolveAudio(
  defaults: AudioConfig | undefined,
  cueAudio: AudioConfig | undefined,
): ResolvedAudioConfig {
  const merged: ResolvedAudioConfig = {
    lang: cueAudio?.lang ?? defaults?.lang ?? DEFAULT_AUDIO_CONFIG.lang,
    rate: cueAudio?.rate ?? defaults?.rate ?? DEFAULT_AUDIO_CONFIG.rate,
    pitch: cueAudio?.pitch ?? defaults?.pitch ?? DEFAULT_AUDIO_CONFIG.pitch,
    volume: cueAudio?.volume ?? defaults?.volume ?? DEFAULT_AUDIO_CONFIG.volume,
  };
  const voiceUri = cueAudio?.voiceUri ?? defaults?.voiceUri;
  if (voiceUri) merged.voiceUri = voiceUri;
  return merged;
}

interface SortKey {
  triggerMs: number;
  priorityRank: number;
  trackOrder: number;
  eventOrder: number;
  cueOrder: number;
}

/**
 * Deterministic ordering (spec §24):
 *   triggerMs -> priority (high > normal > low) -> track -> event -> cue order.
 */
export function compareCompiled(a: SortKey, b: SortKey): number {
  if (a.triggerMs !== b.triggerMs) return a.triggerMs - b.triggerMs;
  if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
  if (a.trackOrder !== b.trackOrder) return a.trackOrder - b.trackOrder;
  if (a.eventOrder !== b.eventOrder) return a.eventOrder - b.eventOrder;
  return a.cueOrder - b.cueOrder;
}

/**
 * TimelinePackage + PlayerProfile + enabled tracks -> CompiledTimeline
 * (spec §22). Validation runs first; blocking errors never reach the engine
 * (spec §73).
 */
export function compileTimeline(
  timeline: TimelinePackage,
  options: CompileOptions,
): CompiledTimeline {
  const report = validateTimeline(timeline);
  if (report.hasBlockingError) throw new TimelineCompileError(report);

  const enabled = new Set(options.enabledTrackIds);
  const rows: (CompiledCue & SortKey)[] = [];

  timeline.tracks.forEach((track, trackOrder) => {
    if (!enabled.has(track.id)) return; // Track filter

    track.events.forEach((event, eventOrder) => {
      event.cues.forEach((cue, cueOrder) => {
        if (cue.enabled === false) return; // Disabled cues keep their data (spec §21)

        const target = combineTargets(track.target, cue.target);
        if (!matchesTarget(target, options.profile)) return; // Target filter

        const priority = cue.priority ?? DEFAULT_CUE_PRIORITY;
        rows.push({
          id: cue.id,
          trackId: track.id,
          eventId: event.id,
          eventName: event.name,
          eventAtMs: event.atMs,
          triggerMs: event.atMs + cue.offsetMs,
          offsetMs: cue.offsetMs,
          phase: event.phase,
          category: event.category,
          text: cue.text,
          priority,
          audio: resolveAudio(options.audioDefaults, cue.audio),
          priorityRank: PRIORITY_RANK[priority],
          trackOrder,
          eventOrder,
          cueOrder,
        });
      });
    });
  });

  rows.sort(compareCompiled);

  const cues: CompiledCue[] = rows.map((row) => ({
    id: row.id,
    trackId: row.trackId,
    eventId: row.eventId,
    eventName: row.eventName,
    eventAtMs: row.eventAtMs,
    triggerMs: row.triggerMs,
    offsetMs: row.offsetMs,
    phase: row.phase,
    category: row.category,
    text: row.text,
    priority: row.priority,
    audio: row.audio,
  }));

  return {
    timelineId: timeline.id,
    name: timeline.meta.name,
    durationMs: timeline.encounter.durationMs,
    countdownMs: options.countdownMs ?? timeline.encounter.countdownMs,
    profile: options.profile,
    enabledTrackIds: [...options.enabledTrackIds],
    cues,
  };
}
