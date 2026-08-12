import { useMemo, useState } from 'react';
import { downloadCsv, recordsToCsv } from '../../debug/csv';
import {
  compareByVisibility,
  computeStatistics,
  evaluateApproxAudibleP95,
  formatMetric,
  TIMING_VERDICT_LABEL,
} from '../../debug/statistics';
import type { DebugCueRecord, DebugStatistics, MetricSummary } from '../../debug/types';
import { formatMs } from '../../timeline/time';

interface DebugPanelProps {
  records: DebugCueRecord[];
  onClear(): void;
  /** Collapsed by default during a fight (spec §44). */
  defaultOpen?: boolean;
}

function MetricRow({ label, metric }: { label: string; metric: MetricSummary }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="mono">{metric.count}</td>
      <td className="mono">{formatMetric(metric.average)}</td>
      <td className="mono">{formatMetric(metric.p50)}</td>
      <td className="mono">{formatMetric(metric.p95)}</td>
      <td className="mono">{formatMetric(metric.p99)}</td>
      <td className="mono">{formatMetric(metric.max)}</td>
    </tr>
  );
}

function StatisticsTable({ stats }: { stats: DebugStatistics }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Metric</th>
          <th>Count</th>
          <th>Avg</th>
          <th>P50</th>
          <th>P95</th>
          <th>P99</th>
          <th>Max</th>
        </tr>
      </thead>
      <tbody>
        <MetricRow label="Engine late" metric={stats.engineLate} />
        <MetricRow label="TTS queue delay" metric={stats.ttsQueueDelay} />
        <MetricRow label="Approx audible late" metric={stats.approxAudibleLate} />
      </tbody>
    </table>
  );
}

export function DebugPanel({ records, onClear, defaultOpen = false }: DebugPanelProps) {
  const [pullFilter, setPullFilter] = useState<number | 'all'>('all');

  const pulls = useMemo(
    () => [...new Set(records.map((record) => record.pullId))].sort((a, b) => a - b),
    [records],
  );

  const filtered = useMemo(
    () => (pullFilter === 'all' ? records : records.filter((record) => record.pullId === pullFilter)),
    [records, pullFilter],
  );

  const stats = useMemo(() => computeStatistics(filtered), [filtered]);
  const byVisibility = useMemo(() => compareByVisibility(filtered), [filtered]);
  const verdict = evaluateApproxAudibleP95(
    stats.approxAudibleLate.p95,
    stats.approxAudibleLate.count,
  );

  return (
    <details className="panel" open={defaultOpen}>
      <summary>
        Debug / Timing{' '}
        <span className="muted small">
          ({records.length} records, {pulls.length} pulls)
        </span>
      </summary>

      <div className="col" style={{ marginTop: '0.75rem' }}>
        <div className="row">
          <label className="field">
            Pull
            <select
              value={String(pullFilter)}
              onChange={(event) =>
                setPullFilter(event.target.value === 'all' ? 'all' : Number(event.target.value))
              }
            >
              <option value="all">All pulls</option>
              {pulls.map((pull) => (
                <option key={pull} value={pull}>
                  Pull {pull}
                </option>
              ))}
            </select>
          </label>
          <span className="spacer" />
          <button
            type="button"
            disabled={records.length === 0}
            onClick={() => downloadCsv('ff14-timeline-debug.csv', recordsToCsv(records))}
          >
            Export CSV
          </button>
          <button type="button" className="ghost" disabled={records.length === 0} onClick={onClear}>
            Clear Debug
          </button>
        </div>

        <div className="debug-grid">
          <div className="stat">
            <div className="label">Records</div>
            <div className="value">{stats.totalRecords}</div>
          </div>
          <div className="stat">
            <div className="label">Played</div>
            <div className="value">{stats.played}</div>
          </div>
          <div className="stat">
            <div className="label">Skipped</div>
            <div className={`value ${stats.skipped > 0 ? 'text-warn' : ''}`}>{stats.skipped}</div>
          </div>
          <div className="stat">
            <div className="label">Errors</div>
            <div className={`value ${stats.errors > 0 ? 'text-error' : ''}`}>{stats.errors}</div>
          </div>
          <div className="stat">
            <div className="label">Approx audible P95</div>
            <div className="value">{formatMetric(stats.approxAudibleLate.p95)}</div>
          </div>
        </div>

        <p className="small">
          Verdict: <strong>{TIMING_VERDICT_LABEL[verdict]}</strong>
        </p>

        <h3>Statistics</h3>
        <StatisticsTable stats={stats} />

        <h3>Foreground vs Background</h3>
        <table>
          <thead>
            <tr>
              <th>Visibility</th>
              <th>Records</th>
              <th>Skipped</th>
              <th>Engine late P95</th>
              <th>Approx audible P95</th>
              <th>Approx audible Max</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>visible</td>
              <td className="mono">{byVisibility.visible.totalRecords}</td>
              <td className="mono">{byVisibility.visible.skipped}</td>
              <td className="mono">{formatMetric(byVisibility.visible.engineLate.p95)}</td>
              <td className="mono">{formatMetric(byVisibility.visible.approxAudibleLate.p95)}</td>
              <td className="mono">{formatMetric(byVisibility.visible.approxAudibleLate.max)}</td>
            </tr>
            <tr>
              <td>hidden</td>
              <td className="mono">{byVisibility.hidden.totalRecords}</td>
              <td className="mono">{byVisibility.hidden.skipped}</td>
              <td className="mono">{formatMetric(byVisibility.hidden.engineLate.p95)}</td>
              <td className="mono">{formatMetric(byVisibility.hidden.approxAudibleLate.p95)}</td>
              <td className="mono">{formatMetric(byVisibility.hidden.approxAudibleLate.max)}</td>
            </tr>
          </tbody>
        </table>

        <h3>Records</h3>
        <div className="scroll-y">
          <table>
            <thead>
              <tr>
                <th>Pull</th>
                <th>Cue</th>
                <th>Text</th>
                <th>Trigger</th>
                <th>Engine late</th>
                <th>TTS delay</th>
                <th>Approx</th>
                <th>Vis (trigger)</th>
                <th>Vis (audio)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((record) => (
                <tr key={record.recordId}>
                  <td className="mono">{record.pullId}</td>
                  <td>{record.eventName}</td>
                  <td>{record.text}</td>
                  <td className="mono">{formatMs(record.triggerMs)}</td>
                  <td className="mono">{formatMetric(record.engineLateMs)}</td>
                  <td className="mono">
                    {record.ttsQueueDelayMs === undefined
                      ? '--'
                      : formatMetric(record.ttsQueueDelayMs)}
                  </td>
                  <td className="mono">
                    {record.approxAudibleLateMs === undefined
                      ? '--'
                      : formatMetric(record.approxAudibleLateMs)}
                  </td>
                  <td>{record.visibilityTrigger}</td>
                  <td>{record.visibilityAudioStart ?? '--'}</td>
                  <td
                    className={
                      record.status === 'skipped'
                        ? 'text-warn'
                        : record.status === 'error'
                          ? 'text-error'
                          : ''
                    }
                  >
                    {record.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
