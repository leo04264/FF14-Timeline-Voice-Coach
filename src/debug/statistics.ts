import type {
  DebugCueRecord,
  DebugStatistics,
  MetricSummary,
  VisibilityComparison,
} from './types';

const EMPTY_SUMMARY: MetricSummary = {
  count: 0,
  average: 0,
  p50: 0,
  p95: 0,
  p99: 0,
  max: 0,
};

/** Nearest-rank percentile over an ascending sample. */
export function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAscending.length);
  const index = Math.min(sortedAscending.length - 1, Math.max(0, rank - 1));
  return sortedAscending[index];
}

export function summarize(values: number[]): MetricSummary {
  if (values.length === 0) return { ...EMPTY_SUMMARY };
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    average: total / sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
  };
}

function collect(records: DebugCueRecord[], pick: (r: DebugCueRecord) => number | undefined): number[] {
  const values: number[] = [];
  for (const record of records) {
    const value = pick(record);
    if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
  }
  return values;
}

/** Spec §51 — the numbers that decide whether Browser TTS is good enough. */
export function computeStatistics(records: DebugCueRecord[]): DebugStatistics {
  return {
    totalRecords: records.length,
    played: records.filter((r) => r.status === 'played').length,
    skipped: records.filter((r) => r.status === 'skipped').length,
    errors: records.filter((r) => r.status === 'error').length,
    engineLate: summarize(collect(records.filter((r) => r.status !== 'skipped'), (r) => r.engineLateMs)),
    ttsQueueDelay: summarize(collect(records, (r) => r.ttsQueueDelayMs)),
    approxAudibleLate: summarize(collect(records, (r) => r.approxAudibleLateMs)),
  };
}

/** Foreground vs background comparison (spec §52). */
export function compareByVisibility(records: DebugCueRecord[]): VisibilityComparison {
  return {
    visible: computeStatistics(records.filter((r) => r.visibilityTrigger === 'visible')),
    hidden: computeStatistics(records.filter((r) => r.visibilityTrigger === 'hidden')),
  };
}

export type TimingVerdict = 'excellent' | 'acceptable' | 'watch' | 'problematic' | 'unusable' | 'unknown';

/** Spec §88 evaluation bands for Approx Audible Late P95. */
export function evaluateApproxAudibleP95(p95: number, sampleCount: number): TimingVerdict {
  if (sampleCount === 0) return 'unknown';
  if (p95 <= 150) return 'excellent';
  if (p95 <= 300) return 'acceptable';
  if (p95 <= 500) return 'watch';
  if (p95 <= 1000) return 'problematic';
  return 'unusable';
}

export const TIMING_VERDICT_LABEL: Record<TimingVerdict, string> = {
  excellent: '非常好 (<=150ms)',
  acceptable: '可接受 (150–300ms)',
  watch: '觀察 (300–500ms)',
  problematic: 'Raid 體驗有問題 (500–1000ms)',
  unusable: 'Browser TTS 不建議正式使用 (>1000ms)',
  unknown: '尚無資料',
};

export function formatMetric(value: number): string {
  if (!Number.isFinite(value)) return '--';
  return `${value.toFixed(0)}ms`;
}
