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
          <div className="small offset-text">全域偏移</div>
          <div className="mono offset-text" data-testid="session-offset">
            {formatSecondsSigned(sessionOffsetMs)}
          </div>
        </div>
        <div>
          <div className="small offset-text">本場偏移</div>
          <div className="mono offset-text" data-testid="pull-offset">
            {formatSecondsSigned(pullOffsetMs)}
          </div>
        </div>
        <div>
          <div className="small offset-text">實際偏移</div>
          <div className="mono offset-text" data-testid="effective-offset">
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
          清除本場偏移
        </button>
      </div>

      <div className="row">
        <button type="button" className="ghost small" onClick={onPromotePullToSession}>
          把本場偏移併入全域偏移
        </button>
        <button type="button" className="ghost small" onClick={() => onSetSession(0)}>
          清除全域偏移
        </button>
      </div>
      <p className="small offset-text">
        偏移為正代表時間軸整體延後。左右方向鍵可以每次調整本場偏移 0.5
        秒。全域偏移會跨場保留，本場偏移會在重置時清除。
      </p>
    </div>
  );
}
