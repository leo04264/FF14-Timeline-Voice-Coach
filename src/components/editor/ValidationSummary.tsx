import type { ValidationIssue, ValidationReport } from '../../timeline/validator';
import type { CollisionReport } from '../../timeline/collision';
import { describeCollision } from '../../timeline/collision';

interface ValidationSummaryProps {
  report: ValidationReport;
  collisions: CollisionReport;
  onSelectIssue(issue: ValidationIssue): void;
  onSelectCue(trackId: string, eventId: string, cueId: string): void;
  /** cueId -> {trackId, eventId} lookup for collision navigation. */
  cueIndex: Map<string, { trackId: string; eventId: string }>;
}

/** Clickable error/warning list at the top of the editor (spec §78). */
export function ValidationSummary({
  report,
  collisions,
  onSelectIssue,
  onSelectCue,
  cueIndex,
}: ValidationSummaryProps) {
  const severeCollisions = collisions.pairs.filter((pair) => pair.severity === 'severe').length;

  return (
    <div className="panel col">
      <div className="row">
        <span className={report.errors.length ? 'badge error' : 'badge ok'}>
          {report.errors.length} 個錯誤
        </span>
        <span className={report.warnings.length ? 'badge warn' : 'badge'}>
          {report.warnings.length} 個警告
        </span>
        <span className={collisions.pairs.length ? 'badge warn' : 'badge'}>
          {collisions.windowMs} 毫秒內有 {collisions.pairs.length} 組衝突（其中 {severeCollisions}{' '}
          組同優先度）
        </span>
        {report.errors.length > 0 ? (
          <span className="small text-error">錯誤修正之前，無法播放也無法正式匯出。</span>
        ) : null}
      </div>

      {report.issues.length > 0 ? (
        <details>
          <summary className="small">問題清單</summary>
          <div className="issue-list" style={{ marginTop: '0.4rem' }}>
            {report.issues.map((issue, index) => (
              <button
                type="button"
                className="issue"
                key={`${issue.code}-${index}`}
                onClick={() => onSelectIssue(issue)}
              >
                <span className={`badge ${issue.level === 'error' ? 'error' : 'warn'}`}>
                  {issue.level === 'error' ? '錯誤' : '警告'}
                </span>
                <span>{issue.message}</span>
              </button>
            ))}
          </div>
        </details>
      ) : null}

      {collisions.pairs.length > 0 ? (
        <details>
          <summary className="small">衝突清單</summary>
          <div className="issue-list" style={{ marginTop: '0.4rem' }}>
            {collisions.pairs.map((pair, index) => {
              const location = cueIndex.get(pair.a.cueId);
              return (
                <button
                  type="button"
                  className="issue"
                  key={`${pair.a.cueId}-${pair.b.cueId}-${index}`}
                  onClick={() => {
                    if (location) onSelectCue(location.trackId, location.eventId, pair.a.cueId);
                  }}
                >
                  <span className={`badge ${pair.severity === 'severe' ? 'error' : 'warn'}`}>
                    {pair.severity === 'severe' ? '同優先度' : '不同優先度'}
                  </span>
                  <span>{describeCollision(pair)}</span>
                </button>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}
