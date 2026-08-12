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
          {report.errors.length} Errors
        </span>
        <span className={report.warnings.length ? 'badge warn' : 'badge'}>
          {report.warnings.length} Warnings
        </span>
        <span className={collisions.pairs.length ? 'badge warn' : 'badge'}>
          {collisions.pairs.length} Collisions ({severeCollisions} same-priority) within{' '}
          {collisions.windowMs}ms
        </span>
        {report.errors.length > 0 ? (
          <span className="small text-error">
            Live Player and formal Export are blocked until the errors are fixed.
          </span>
        ) : null}
      </div>

      {report.issues.length > 0 ? (
        <details>
          <summary className="small">Issues</summary>
          <div className="issue-list" style={{ marginTop: '0.4rem' }}>
            {report.issues.map((issue, index) => (
              <button
                type="button"
                className="issue"
                key={`${issue.code}-${index}`}
                onClick={() => onSelectIssue(issue)}
              >
                <span className={`badge ${issue.level === 'error' ? 'error' : 'warn'}`}>
                  {issue.level}
                </span>
                <span>{issue.message}</span>
              </button>
            ))}
          </div>
        </details>
      ) : null}

      {collisions.pairs.length > 0 ? (
        <details>
          <summary className="small">Collisions</summary>
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
                    {pair.severity}
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
