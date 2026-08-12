import type { VisibilityState } from '../audio/AudioBackend';

export type DebugRecordStatus = 'pending' | 'played' | 'skipped' | 'error';

/**
 * One dispatched (or skipped) cue (spec §49–§54).
 * All *AtMs fields come from the engine clock (`performance.now()`).
 */
export interface DebugCueRecord {
  recordId: number;
  pullId: number;
  cueId: string;
  playbackId?: number;
  eventName: string;
  text: string;
  /** Timeline position the cue was scheduled at. */
  triggerMs: number;
  /** Timeline position when the engine actually dispatched it. */
  timelineElapsedMs: number;
  /** Cue due -> engine trigger. */
  engineLateMs: number;
  requestedAtMs: number;
  audioStartAtMs?: number;
  audioEndAtMs?: number;
  /** speechSynthesis.speak() -> onstart. */
  ttsQueueDelayMs?: number;
  /** engineLate + ttsQueueDelay. */
  approxAudibleLateMs?: number;
  visibilityTrigger: VisibilityState;
  visibilityAudioStart?: VisibilityState;
  status: DebugRecordStatus;
  error?: string;
}

export interface MetricSummary {
  count: number;
  average: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface DebugStatistics {
  totalRecords: number;
  played: number;
  skipped: number;
  errors: number;
  engineLate: MetricSummary;
  ttsQueueDelay: MetricSummary;
  approxAudibleLate: MetricSummary;
}

export interface VisibilityComparison {
  visible: DebugStatistics;
  hidden: DebugStatistics;
}
