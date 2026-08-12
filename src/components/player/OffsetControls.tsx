import { formatSecondsSigned } from '../../timeline/time';

interface OffsetControlsProps {
  sessionOffsetMs: number;
  pullOffsetMs: number;
  onNudgePull(deltaMs: number): void;
  onSetSession(ms: number): void;
  onPromotePullToSession(): void;
}

const NUDGES = [-1000, -500, 500, 1000];

/**
 * Session vs Pull offset (spec §34–§36).
 * Session survives pulls; Pull is cleared by WIPE / START.
 */
export function OffsetControls({
  sessionOffsetMs,
  pullOffsetMs,
  onNudgePull,
  onSetSession,
  onPromotePullToSession,
}: OffsetControlsProps) {
  const effective = sessionOffsetMs + pullOffsetMs;

  return (
    <div className="col">
      <div className="offset-display">
        <div>
          <div className="small muted">Session Offset</div>
          <div className="mono" data-testid="session-offset">
            {formatSecondsSigned(sessionOffsetMs)}
          </div>
        </div>
        <div>
          <div className="small muted">Pull Offset</div>
          <div className="mono" data-testid="pull-offset">
            {formatSecondsSigned(pullOffsetMs)}
          </div>
        </div>
        <div>
          <div className="small muted">Effective Offset</div>
          <div className="mono" data-testid="effective-offset">
            {formatSecondsSigned(effective)}
          </div>
        </div>
      </div>

      <div className="row">
        {NUDGES.map((delta) => (
          <button type="button" key={delta} onClick={() => onNudgePull(delta)}>
            {formatSecondsSigned(delta)}
          </button>
        ))}
        <button type="button" className="ghost" onClick={() => onNudgePull(-pullOffsetMs)}>
          Reset pull
        </button>
      </div>

      <div className="row">
        <button type="button" className="ghost small" onClick={onPromotePullToSession}>
          Move pull offset into session
        </button>
        <button type="button" className="ghost small" onClick={() => onSetSession(0)}>
          Clear session offset
        </button>
      </div>
      <p className="small muted">
        A positive offset delays the timeline. Left / Right arrows nudge the pull offset by 0.5s.
      </p>
    </div>
  );
}
