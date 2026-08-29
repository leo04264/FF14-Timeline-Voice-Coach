import { useEffect, useMemo, useState } from 'react';
import {
  CUE_PRIORITY_LABEL,
  EVENT_CATEGORY_LABEL,
  TRACK_TYPE_LABEL,
} from '../../i18n/labels';
import {
  analyzeCueRefCollisions,
  collectCueRefs,
  type CollisionCueRef,
  type CollisionPair,
} from '../../timeline/collision';
import { appendMechanicAction } from '../../timeline/edits';
import { formatMs } from '../../timeline/time';
import {
  CUE_PRIORITIES,
  EVENT_CATEGORIES,
  type CuePriority,
  type EventCategory,
  type TimelineEvent,
  type TimelinePackage,
  type TimelineTrack,
  type TimelineTrackType,
} from '../../timeline/types';
import { TimeInput } from './TimeInput';

const DRAFT_CUE_ID = '__mechanic-action-draft-cue__';

interface MechanicActionPanelProps {
  timeline: TimelinePackage;
  sourceTrack: TimelineTrack;
  sourceEvent: TimelineEvent;
  collisionWindowMs: number;
  onChange(next: TimelinePackage): void;
  onNavigate(trackId: string, eventId: string, cueId?: string): void;
}

interface AddedActionRef {
  trackId: string;
  eventId: string;
  cueId: string;
  trackName: string;
  eventName: string;
}

function defaultCategory(type: TimelineTrackType): EventCategory {
  if (type === 'job') return 'job';
  if (type === 'role' || type === 'party') return 'mitigation';
  if (type === 'encounter') return 'mechanic';
  return 'custom';
}

function otherCollisionCue(pair: CollisionPair): CollisionCueRef {
  return pair.a.cueId === DRAFT_CUE_ID ? pair.b : pair.a;
}

/** Quick-create a target-track event from the selected encounter mechanic. */
export function MechanicActionPanel({
  timeline,
  sourceTrack,
  sourceEvent,
  collisionWindowMs,
  onChange,
  onNavigate,
}: MechanicActionPanelProps) {
  const targetTracks = timeline.tracks.filter((track) => track.id !== sourceTrack.id);
  const [targetTrackId, setTargetTrackId] = useState(targetTracks[0]?.id ?? '');
  const [eventName, setEventName] = useState(`${sourceEvent.name}：新動作`);
  const [cueText, setCueText] = useState('');
  const [cueOffsetMs, setCueOffsetMs] = useState(-3000);
  const [category, setCategory] = useState<EventCategory>(
    defaultCategory(targetTracks[0]?.type ?? 'custom'),
  );
  const [priority, setPriority] = useState<CuePriority>('normal');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<AddedActionRef | null>(null);

  const targetTrack =
    targetTracks.find((track) => track.id === targetTrackId) ?? targetTracks[0] ?? null;

  useEffect(() => {
    if (targetTrack || targetTracks.length === 0) return;
    setTargetTrackId(targetTracks[0].id);
    setCategory(defaultCategory(targetTracks[0].type));
  }, [targetTrack, targetTracks]);

  const sameTimeEvents = useMemo(
    () =>
      targetTracks.flatMap((track) =>
        track.events
          .filter((event) => event.atMs === sourceEvent.atMs)
          .map((event) => ({ track, event })),
      ),
    [sourceEvent.atMs, targetTracks],
  );

  const triggerMs = sourceEvent.atMs + cueOffsetMs;
  const inputError =
    eventName.trim() === ''
      ? '動作名稱不能空白'
      : cueText.trim() === ''
        ? '語音內容不能空白'
        : triggerMs < -timeline.encounter.countdownMs
          ? '提示時間早於倒數開始'
          : triggerMs > timeline.encounter.durationMs
            ? '提示時間超過戰鬥全長'
            : null;

  const draftCollisions = useMemo(() => {
    if (!targetTrack || cueText.trim() === '' || !Number.isFinite(triggerMs)) return [];
    const draft: CollisionCueRef = {
      trackId: targetTrack.id,
      trackName: targetTrack.name,
      eventId: '__mechanic-action-draft-event__',
      eventName: eventName.trim() || '新動作',
      cueId: DRAFT_CUE_ID,
      text: cueText.trim(),
      triggerMs,
      priority,
      target: targetTrack.target,
    };
    return analyzeCueRefCollisions(
      [...collectCueRefs(timeline), draft],
      collisionWindowMs,
    ).pairs.filter((pair) => pair.a.cueId === DRAFT_CUE_ID || pair.b.cueId === DRAFT_CUE_ID);
  }, [collisionWindowMs, cueText, eventName, priority, targetTrack, timeline, triggerMs]);

  const lastAddedStillExists =
    lastAdded &&
    timeline.tracks
      .find((track) => track.id === lastAdded.trackId)
      ?.events.some((event) => event.id === lastAdded.eventId);

  if (sourceTrack.type !== 'encounter') return null;

  return (
    <section className="mechanic-action-panel col" aria-labelledby="mechanic-action-title">
      <div className="row">
        <h3 id="mechanic-action-title" style={{ margin: 0 }}>
          其他軌道動作
        </h3>
        <span className="spacer" />
        <span className="badge mono">{formatMs(sourceEvent.atMs)}</span>
      </div>
      <p className="small muted mechanic-action-help">
        以「{sourceEvent.name || '未命名王機制'}」的時間建立一般事件；新增後會獨立編輯，不會因王機制時間變更而自動移動。
      </p>

      {sameTimeEvents.length > 0 ? (
        <details>
          <summary className="small">此時間點已有 {sameTimeEvents.length} 個其他軌道事件</summary>
          <div className="mechanic-action-existing col">
            {sameTimeEvents.map(({ track, event }) => (
              <div className="mechanic-action-existing-row" key={`${track.id}:${event.id}`}>
                <div>
                  <strong>{event.name || '（未命名事件）'}</strong>
                  <div className="small muted">
                    {track.name || '（未命名軌道）'} · {event.cues.length} 句提示
                  </div>
                </div>
                <button
                  type="button"
                  className="ghost small"
                  aria-label={`前往編輯：${event.name || '未命名事件'}`}
                  onClick={() => onNavigate(track.id, event.id, event.cues[0]?.id)}
                >
                  前往編輯
                </button>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {targetTracks.length === 0 ? (
        <p className="small text-warn">目前只有王機制軌道，請先在左側新增職責、職業、團隊或自訂軌道。</p>
      ) : (
        <div className="mechanic-action-form col">
          <label className="field">
            追加到軌道
            <select
              value={targetTrack?.id ?? ''}
              onChange={(changeEvent) => {
                const nextId = changeEvent.target.value;
                const nextTrack = targetTracks.find((track) => track.id === nextId);
                setTargetTrackId(nextId);
                if (nextTrack) setCategory(defaultCategory(nextTrack.type));
                setSubmitError(null);
              }}
            >
              {targetTracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name || '（未命名軌道）'} · {TRACK_TYPE_LABEL[track.type]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            動作名稱
            <input
              value={eventName}
              onChange={(changeEvent) => {
                setEventName(changeEvent.target.value);
                setSubmitError(null);
              }}
            />
          </label>

          <label className="field">
            語音內容
            <textarea
              rows={2}
              value={cueText}
              onChange={(changeEvent) => {
                setCueText(changeEvent.target.value);
                setSubmitError(null);
              }}
            />
          </label>

          <TimeInput
            id="mechanic-action-offset"
            label="提示相對時間（負數代表機制之前）"
            valueMs={cueOffsetMs}
            onChange={(ms) => {
              setCueOffsetMs(ms);
              setSubmitError(null);
            }}
          />
          <div className="small muted">
            實際觸發時間：<span className="mono">{formatMs(triggerMs)}</span>
          </div>

          <div className="row responsive-fields mechanic-action-options">
            <label className="field">
              分類
              <select
                value={category}
                onChange={(changeEvent) => setCategory(changeEvent.target.value as EventCategory)}
              >
                {EVENT_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {EVENT_CATEGORY_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              優先度
              <select
                value={priority}
                onChange={(changeEvent) => setPriority(changeEvent.target.value as CuePriority)}
              >
                {CUE_PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {CUE_PRIORITY_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {draftCollisions.length > 0 ? (
            <div className="mechanic-action-collisions col" role="alert">
              <strong className="small">
                新提示會在 {collisionWindowMs} 毫秒內碰到 {draftCollisions.length} 句語音
              </strong>
              {draftCollisions.map((pair) => {
                const other = otherCollisionCue(pair);
                return (
                  <div className="small" key={`${other.cueId}:${pair.gapMs}`}>
                    相隔 {pair.gapMs} 毫秒 · {other.trackName} › {other.eventName}／「{other.text}」
                  </div>
                );
              })}
              <span className="small muted">可以先調整提示時間；若仍要保留，請使用下方確認按鈕。</span>
            </div>
          ) : null}

          {inputError || submitError ? (
            <span className="small text-error">{submitError ?? inputError}</span>
          ) : null}

          {lastAdded && lastAddedStillExists ? (
            <div className="mechanic-action-success row" role="status">
              <span className="small">
                已追加至「{lastAdded.trackName}」：{lastAdded.eventName}
              </span>
              <span className="spacer" />
              <button
                type="button"
                className="ghost small"
                onClick={() =>
                  onNavigate(lastAdded.trackId, lastAdded.eventId, lastAdded.cueId)
                }
              >
                前往編輯
              </button>
            </div>
          ) : null}

          <button
            type="button"
            className={draftCollisions.length > 0 ? 'mechanic-action-confirm' : 'primary'}
            disabled={!targetTrack || Boolean(inputError)}
            onClick={() => {
              if (!targetTrack || inputError) return;
              const result = appendMechanicAction(
                timeline,
                sourceTrack.id,
                sourceEvent.id,
                targetTrack.id,
                { eventName, category, cueText, cueOffsetMs, priority },
              );
              if (!result.ok) {
                setSubmitError(result.error);
                return;
              }
              onChange(result.timeline);
              setLastAdded({
                trackId: targetTrack.id,
                eventId: result.eventId,
                cueId: result.cueId,
                trackName: targetTrack.name || '未命名軌道',
                eventName: eventName.trim(),
              });
              setCueText('');
              setSubmitError(null);
            }}
          >
            {draftCollisions.length > 0
              ? `仍要追加（${draftCollisions.length} 組衝突）`
              : '追加動作'}
          </button>
        </div>
      )}
    </section>
  );
}
