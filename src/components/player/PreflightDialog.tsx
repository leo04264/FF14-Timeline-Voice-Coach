import { Modal } from '../common/Modal';
import { JOB_NAME_LABEL } from '../../i18n/labels';
import type { CollisionPair } from '../../timeline/collision';
import type { PlanIssue, PlaybackPlanResult } from '../../timeline/playbackPlan';
import { isConventionalAssignment } from '../../timeline/target';
import { formatMs, formatSecondsSigned } from '../../timeline/time';
import type { PlayerProfile } from '../../timeline/types';

interface PreflightDialogProps {
  stage: 'ready-summary' | 'risk-confirm' | 'blocked';
  stale: boolean;
  plan: PlaybackPlanResult;
  timelineName: string;
  profile: PlayerProfile;
  countdownMs: number;
  effectiveOffsetMs: number;
  onConfirm(): void;
  onCancel(): void;
  /** Audition the two colliding lines in context (spec §4.5). */
  onPreviewSegment(triggerMs: number): void;
  /** Jump to the offending cue in the editor. */
  onNavigate(trackId: string, eventId: string, cueId?: string): void;
}

function IssueList({ issues, tone }: { issues: PlanIssue[]; tone: 'error' | 'warn' }) {
  if (issues.length === 0) return null;
  return (
    <ul className={tone === 'error' ? 'issue-list text-error' : 'issue-list text-warn'}>
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`}>
          <span>{issue.message}</span>
          {issue.hint ? <div className="small muted">{issue.hint}</div> : null}
        </li>
      ))}
    </ul>
  );
}

function CollisionRow({
  pair,
  onPreviewSegment,
  onNavigate,
}: {
  pair: CollisionPair;
  onPreviewSegment(triggerMs: number): void;
  onNavigate(trackId: string, eventId: string, cueId?: string): void;
}) {
  return (
    <div className="collision-row col">
      <div className="row small">
        <span className="mono">{formatMs(pair.a.triggerMs)}</span>
        <span>「{pair.a.text}」</span>
        <span className="muted">（{pair.a.trackName}／{pair.a.eventName}）</span>
      </div>
      <div className="row small">
        <span className="mono">{formatMs(pair.b.triggerMs)}</span>
        <span>「{pair.b.text}」</span>
        <span className="muted">（{pair.b.trackName}／{pair.b.eventName}）</span>
      </div>
      <div className="row small">
        <span className="badge warn">相隔 {pair.gapMs} 毫秒</span>
        <button
          type="button"
          className="ghost small"
          onClick={() => onPreviewSegment(pair.a.triggerMs)}
        >
          試播這段
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={() => onNavigate(pair.a.trackId, pair.a.eventId, pair.a.cueId)}
        >
          前往調整
        </button>
      </div>
    </div>
  );
}

/**
 * The shared preflight surface (spec §4.5, §4.6).
 *
 * Three stages, one component, so no entry point can bypass a check:
 *   - `blocked`      — errors only; there is no way to start from here
 *   - `risk-confirm` — warnings that need an explicit "了解風險，仍開始"
 *   - `ready-summary`— the normal pre-countdown summary
 *
 * Nothing here rewrites the plan: no cue is deleted, merged, retimed or
 * pre-empted on the player's behalf.
 */
export function PreflightDialog({
  stage,
  stale,
  plan,
  timelineName,
  profile,
  countdownMs,
  effectiveOffsetMs,
  onConfirm,
  onCancel,
  onPreviewSegment,
  onNavigate,
}: PreflightDialogProps) {
  const conventional = isConventionalAssignment(profile.position, profile.job);
  const title =
    stage === 'blocked' ? '這一場還不能開始' : stage === 'risk-confirm' ? '有風險要確認' : '準備好了嗎？';

  const confirmLabel =
    stage === 'risk-confirm' ? '了解風險，仍開始' : '開始';

  return (
    <Modal
      title={title}
      onClose={onCancel}
      // Esc stays WIPE on the player; the dialog is dismissed with the button.
      closeOnEscape={false}
      footer={
        <>
          <button type="button" autoFocus onClick={onCancel}>
            {stage === 'blocked' ? '關閉' : '取消'}
          </button>
          {stage === 'blocked' ? null : (
            <button
              type="button"
              className={stage === 'risk-confirm' ? 'wipe-button' : 'primary'}
              disabled={stale}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          )}
        </>
      }
    >
      {stale ? (
        <p className="text-warn" role="status">
          設定在這個視窗開啟後有變動，剛才的確認已失效。請關掉後重新開始，系統會重新檢查一次。
        </p>
      ) : null}

      <dl className="col ready-summary" style={{ margin: 0 }}>
        <div className="row ready-summary-row">
          <strong>時間軸</strong>
          <span>{timelineName}</span>
        </div>
        <div className="row ready-summary-row">
          <strong>站位 / 職業</strong>
          <span>
            {profile.position} / {JOB_NAME_LABEL[profile.job]}
          </span>
          {conventional ? null : <span className="badge warn">非常見組合（僅提示，不阻擋）</span>}
        </div>
        <div className="row ready-summary-row">
          <strong>啟用軌道</strong>
          <span>
            {plan.tracks.filter((row) => row.selected && row.enabledCueCount > 0).length
              ? plan.tracks
                  .filter((row) => row.selected && row.enabledCueCount > 0)
                  .map((row) => `${row.track.name}（${row.enabledCueCount}）`)
                  .join('、')
              : '無'}
          </span>
        </div>
        <div className="row ready-summary-row">
          <strong>倒數</strong>
          <span className="mono">{(countdownMs / 1000).toFixed(1)} 秒</span>
        </div>
        <div className="row ready-summary-row">
          <strong>實際偏移</strong>
          <span className="mono offset-text">{formatSecondsSigned(effectiveOffsetMs)}</span>
        </div>
        <div className="row ready-summary-row">
          <strong>你會聽到的提示</strong>
          <span data-testid="preflight-cue-count">{plan.totalCueCount} 句</span>
        </div>
      </dl>

      {plan.errors.length > 0 ? (
        <section>
          <h3>必須先修正</h3>
          <IssueList issues={plan.errors} tone="error" />
        </section>
      ) : null}

      {plan.warnings.length > 0 ? (
        <section>
          <h3>提醒</h3>
          <IssueList issues={plan.warnings} tone="warn" />
        </section>
      ) : null}

      {plan.actualCollisions.pairs.length > 0 ? (
        <section>
          <h3>可能來不及唸完的段落（{plan.actualCollisions.pairs.length} 組）</h3>
          <div className="col">
            {plan.actualCollisions.pairs.slice(0, 8).map((pair) => (
              <CollisionRow
                key={`${pair.a.cueId}-${pair.b.cueId}`}
                pair={pair}
                onPreviewSegment={onPreviewSegment}
                onNavigate={onNavigate}
              />
            ))}
            {plan.actualCollisions.pairs.length > 8 ? (
              <p className="small muted">
                只列出前 8 組，其餘 {plan.actualCollisions.pairs.length - 8} 組請到編輯器檢查。
              </p>
            ) : null}
          </div>
          <p className="small muted">
            這個判斷只用文字長度與固定視窗估算，不代表真實語音一定會重疊；也不會自動幫你刪除、合併或改時間。
          </p>
        </section>
      ) : null}
    </Modal>
  );
}
