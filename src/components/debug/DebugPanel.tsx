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
import { DEBUG_STATUS_LABEL, VISIBILITY_LABEL } from '../../i18n/labels';
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
    <div className="table-scroll debug-table" role="region" aria-label="延遲統計" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th>指標</th>
            <th>筆數</th>
            <th>平均</th>
            <th>P50</th>
            <th>P95</th>
            <th>P99</th>
            <th>最大</th>
          </tr>
        </thead>
        <tbody>
          <MetricRow label="引擎延遲" metric={stats.engineLate} />
          <MetricRow label="語音排隊延遲" metric={stats.ttsQueueDelay} />
          <MetricRow label="估計實際延遲" metric={stats.approxAudibleLate} />
        </tbody>
      </table>
    </div>
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
        偵錯 / 延遲統計{' '}
        <span className="muted small">
          （{records.length} 筆記錄，{pulls.length} 場）
        </span>
      </summary>

      <div className="col" style={{ marginTop: '0.75rem' }}>
        <div className="row">
          <label className="field">
            場次
            <select
              value={String(pullFilter)}
              onChange={(event) =>
                setPullFilter(event.target.value === 'all' ? 'all' : Number(event.target.value))
              }
            >
              <option value="all">全部場次</option>
              {pulls.map((pull) => (
                <option key={pull} value={pull}>
                  第 {pull} 場
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
            匯出 CSV
          </button>
          <button type="button" className="ghost" disabled={records.length === 0} onClick={onClear}>
            清除記錄
          </button>
        </div>

        <div className="debug-grid">
          <div className="stat">
            <div className="label">記錄筆數</div>
            <div className="value">{stats.totalRecords}</div>
          </div>
          <div className="stat">
            <div className="label">已播放</div>
            <div className="value">{stats.played}</div>
          </div>
          <div className="stat">
            <div className="label">已略過</div>
            <div className={`value ${stats.skipped > 0 ? 'text-warn' : ''}`}>{stats.skipped}</div>
          </div>
          <div className="stat">
            <div className="label">錯誤</div>
            <div className={`value ${stats.errors > 0 ? 'text-error' : ''}`}>{stats.errors}</div>
          </div>
          <div className="stat">
            <div className="label">估計實際延遲 P95</div>
            <div className="value">{formatMetric(stats.approxAudibleLate.p95)}</div>
          </div>
        </div>

        <p className="small">
          評估結果：<strong>{TIMING_VERDICT_LABEL[verdict]}</strong>
        </p>

        <h3>統計</h3>
        <StatisticsTable stats={stats} />

        <h3>前景 vs 背景</h3>
        <div className="table-scroll debug-table" role="region" aria-label="前景與背景延遲比較" tabIndex={0}>
          <table>
          <thead>
            <tr>
              <th>分頁狀態</th>
              <th>記錄筆數</th>
              <th>已略過</th>
              <th>引擎延遲 P95</th>
              <th>估計實際延遲 P95</th>
              <th>估計實際延遲 最大</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{VISIBILITY_LABEL.visible}</td>
              <td className="mono">{byVisibility.visible.totalRecords}</td>
              <td className="mono">{byVisibility.visible.skipped}</td>
              <td className="mono">{formatMetric(byVisibility.visible.engineLate.p95)}</td>
              <td className="mono">{formatMetric(byVisibility.visible.approxAudibleLate.p95)}</td>
              <td className="mono">{formatMetric(byVisibility.visible.approxAudibleLate.max)}</td>
            </tr>
            <tr>
              <td>{VISIBILITY_LABEL.hidden}</td>
              <td className="mono">{byVisibility.hidden.totalRecords}</td>
              <td className="mono">{byVisibility.hidden.skipped}</td>
              <td className="mono">{formatMetric(byVisibility.hidden.engineLate.p95)}</td>
              <td className="mono">{formatMetric(byVisibility.hidden.approxAudibleLate.p95)}</td>
              <td className="mono">{formatMetric(byVisibility.hidden.approxAudibleLate.max)}</td>
            </tr>
          </tbody>
          </table>
        </div>

        <h3>逐筆記錄</h3>
        <div className="table-scroll scroll-y debug-records" role="region" aria-label="逐筆延遲記錄" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>場次</th>
                <th>事件</th>
                <th>內容</th>
                <th>觸發時間</th>
                <th>引擎延遲</th>
                <th>語音排隊</th>
                <th>估計實際</th>
                <th>觸發時分頁</th>
                <th>發聲時分頁</th>
                <th>狀態</th>
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
                  <td>{VISIBILITY_LABEL[record.visibilityTrigger]}</td>
                  <td>
                    {record.visibilityAudioStart
                      ? VISIBILITY_LABEL[record.visibilityAudioStart]
                      : '--'}
                  </td>
                  <td
                    className={
                      record.status === 'skipped'
                        ? 'text-warn'
                        : record.status === 'error'
                          ? 'text-error'
                          : ''
                    }
                  >
                    {DEBUG_STATUS_LABEL[record.status]}
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
