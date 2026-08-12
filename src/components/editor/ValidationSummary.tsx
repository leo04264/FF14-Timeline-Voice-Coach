import { CUE_PRIORITY_LABEL } from '../../i18n/labels';
import type { CollisionCueRef, CollisionPair, CollisionReport } from '../../timeline/collision';
import { describeTarget } from '../../timeline/target';
import { formatMs } from '../../timeline/time';
import type { TimelinePackage } from '../../timeline/types';
import type { ValidationIssue, ValidationReport } from '../../timeline/validator';

interface ValidationSummaryProps {
  timeline: TimelinePackage;
  report: ValidationReport;
  collisions: CollisionReport;
  onSelectIssue(issue: ValidationIssue): void;
  onSelectCue(trackId: string, eventId: string, cueId: string): void;
}

const ISSUE_GUIDANCE: Readonly<Record<string, string>> = {
  'timeline.no-tracks': '新增至少一個軌道，並在軌道中建立事件與語音提示。',
  'track.duplicate-id': '讓每個軌道使用不同 ID；最安全的做法是刪除重複軌道後重新新增或複製。',
  'track.empty-name': '替軌道填入能辨識用途的名稱，例如「王機制」或「補師」。',
  'track.no-events': '在這個軌道新增事件；如果不需要這個軌道，可以將它刪除。',
  'track.empty-target': '重新選擇至少一個站位或職業；若要所有人都聽到，請選「不限」。',
  'event.duplicate-id': '讓每個事件使用不同 ID；可刪除重複事件後重新新增或複製。',
  'event.empty-name': '填入事件名稱，之後在問題清單和播放器中才容易辨識。',
  'event.after-duration': '把事件時間提前，或在「時間軸設定」增加戰鬥全長。',
  'event.before-countdown': '把事件移到倒數開始之後，或增加預設倒數時間。',
  'event.no-cues': '新增至少一句語音提示；若事件只用來註記且不需播音，也可以保留這項警告。',
  'cue.duplicate-id': '讓每句提示使用不同 ID；可刪除重複提示後重新新增或複製。',
  'cue.empty-text': '在語音內容填入實際要念的文字。',
  'cue.before-countdown': '調高提示 offset，或增加預設倒數，讓觸發時間落在倒數開始之後。',
  'cue.after-duration': '調低提示 offset、提前事件，或增加戰鬥全長。',
  'cue.text-long': '縮短句子，只保留玩家需要立即反應的關鍵詞。',
  'cue.text-very-long': '大幅縮短或拆成較早觸發的多句提示，避免後一句開始時前一句還沒念完。',
  'cue.unreachable-target': '調整軌道或提示的站位／職業條件，讓兩者至少有一個共同對象。',
  schema: '依訊息中的欄位路徑修正 JSON 格式或欄位值，再重新匯入。',
};

const FIELD_LABEL: Readonly<Record<string, string>> = {
  id: 'ID',
  name: '名稱',
  target: '對象',
  atMs: '事件時間',
  offsetMs: '提示 offset',
  text: '語音內容',
};

interface IssueContext {
  trackName?: string;
  eventName?: string;
  eventAtMs?: number;
  cueText?: string;
  cueTriggerMs?: number;
}

function findIssueContext(timeline: TimelinePackage, issue: ValidationIssue): IssueContext {
  const track = issue.trackId
    ? timeline.tracks.find((candidate) => candidate.id === issue.trackId)
    : undefined;
  const event = issue.eventId
    ? track?.events.find((candidate) => candidate.id === issue.eventId)
    : undefined;
  const cue = issue.cueId
    ? event?.cues.find((candidate) => candidate.id === issue.cueId)
    : undefined;

  return {
    trackName: track ? track.name || '（未命名軌道）' : undefined,
    eventName: event ? event.name || '（未命名事件）' : undefined,
    eventAtMs: event?.atMs,
    cueText: cue ? cue.text || '（空白提示）' : undefined,
    cueTriggerMs: cue && event ? event.atMs + cue.offsetMs : undefined,
  };
}

function issueGuidance(issue: ValidationIssue): string {
  return ISSUE_GUIDANCE[issue.code] ?? '依上方位置檢查對應欄位，修正後問題清單會立即重新計算。';
}

function ProblemContext({ issue, context }: { issue: ValidationIssue; context: IssueContext }) {
  return (
    <dl className="problem-context">
      {context.trackName ? (
        <div>
          <dt>軌道</dt>
          <dd>{context.trackName}</dd>
        </div>
      ) : null}
      {context.eventName ? (
        <div>
          <dt>事件</dt>
          <dd>
            {context.eventName}
            {context.eventAtMs === undefined ? null : (
              <span className="mono muted"> · {formatMs(context.eventAtMs)}</span>
            )}
          </dd>
        </div>
      ) : null}
      {context.cueText ? (
        <div>
          <dt>提示</dt>
          <dd>
            「{context.cueText}」
            {context.cueTriggerMs === undefined ? null : (
              <span className="mono muted"> · 觸發於 {formatMs(context.cueTriggerMs)}</span>
            )}
          </dd>
        </div>
      ) : null}
      {issue.field ? (
        <div>
          <dt>欄位</dt>
          <dd>{FIELD_LABEL[issue.field] ?? issue.field}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function CollisionCue({ label, cue }: { label: string; cue: CollisionCueRef }) {
  return (
    <div className="collision-cue">
      <div className="row">
        <strong>{label}</strong>
        <span className="badge">{CUE_PRIORITY_LABEL[cue.priority]}</span>
        <span className="mono">{formatMs(cue.triggerMs)}</span>
      </div>
      <div className="collision-text">「{cue.text || '（空白提示）'}」</div>
      <div className="small muted">
        {cue.trackName || '（未命名軌道）'} › {cue.eventName || '（未命名事件）'}
      </div>
      <div className="small muted">播放對象：{describeTarget(cue.target)}</div>
    </div>
  );
}

function collisionGuidance(pair: CollisionPair, windowMs: number): string {
  const severity =
    pair.severity === 'severe'
      ? '兩句優先度相同，重疊時較難判斷哪句更重要。'
      : '兩句優先度不同，但播放器仍會把兩句都送進語音佇列。';
  return `${severity} 可調整其中一句 offset，讓間隔超過 ${windowMs} 毫秒；也可以縮短或合併文案、拆開播放對象，或停用不需要的提示。`;
}

/** Detailed, navigable error/warning list at the top of the editor (spec §78). */
export function ValidationSummary({
  timeline,
  report,
  collisions,
  onSelectIssue,
  onSelectCue,
}: ValidationSummaryProps) {
  const severeCollisions = collisions.pairs.filter((pair) => pair.severity === 'severe').length;

  return (
    <div className="panel col validation-summary">
      <div className="row validation-overview">
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
        <details open={report.errors.length > 0}>
          <summary>
            問題清單（{report.issues.length}）
            <span className="small muted"> · 展開查看位置、影響與修正建議</span>
          </summary>
          <div className="problem-list">
            {report.issues.map((issue, index) => {
              const context = findIssueContext(timeline, issue);
              return (
                <article
                  className={`problem-card ${issue.level}`}
                  key={`${issue.code}-${issue.trackId ?? ''}-${issue.eventId ?? ''}-${issue.cueId ?? ''}-${index}`}
                >
                  <div className="problem-card-header">
                    <span className={`badge ${issue.level === 'error' ? 'error' : 'warn'}`}>
                      {issue.level === 'error' ? '錯誤' : '警告'}
                    </span>
                    <strong>{issue.message}</strong>
                  </div>
                  <ProblemContext issue={issue} context={context} />
                  <div className="problem-guidance">
                    <strong>建議處理：</strong> {issueGuidance(issue)}
                  </div>
                  {issue.trackId || issue.eventId || issue.cueId ? (
                    <div className="problem-actions">
                      <button type="button" onClick={() => onSelectIssue(issue)}>
                        定位到問題
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </details>
      ) : null}

      {collisions.pairs.length > 0 ? (
        <details>
          <summary>
            衝突清單（{collisions.pairs.length}）
            <span className="small muted"> · 兩句都會播放，不會自動捨棄低優先度提示</span>
          </summary>
          <div className="problem-list">
            {collisions.pairs.map((pair, index) => (
              <article
                className={`problem-card collision ${pair.severity}`}
                key={`${pair.a.cueId}-${pair.b.cueId}-${index}`}
              >
                <div className="problem-card-header">
                  <span className={`badge ${pair.severity === 'severe' ? 'error' : 'warn'}`}>
                    {pair.severity === 'severe' ? '較嚴重' : '提醒'}
                  </span>
                  <strong>
                    兩句相隔 {pair.gapMs} 毫秒，在 {collisions.windowMs} 毫秒衝突判定區間內
                  </strong>
                </div>
                <div className="collision-cues">
                  <CollisionCue label="第一句" cue={pair.a} />
                  <CollisionCue label="第二句" cue={pair.b} />
                </div>
                <div className="problem-guidance">
                  <strong>為什麼：</strong>兩句的有效播放對象可能重疊，因此同一位玩家可能連續聽到這兩句。
                </div>
                <div className="problem-guidance">
                  <strong>建議處理：</strong> {collisionGuidance(pair, collisions.windowMs)}
                </div>
                <div className="problem-actions">
                  <button
                    type="button"
                    onClick={() => onSelectCue(pair.a.trackId, pair.a.eventId, pair.a.cueId)}
                  >
                    定位第一句
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectCue(pair.b.trackId, pair.b.eventId, pair.b.cueId)}
                  >
                    定位第二句
                  </button>
                </div>
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
