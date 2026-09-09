import { EVENT_CATEGORY_LABEL } from '../../i18n/labels';
import type { CollisionReport } from '../../timeline/collision';
import {
  addCue,
  convertEventToFixedTime,
  setEventAbsoluteTime,
  updateEvent,
} from '../../timeline/edits';
import { buildMechanicIndex, resolveEventTiming } from '../../timeline/resolveEventTiming';
import { formatMs } from '../../timeline/time';
import {
  EVENT_CATEGORIES,
  type EventCategory,
  type TimelineEvent,
  type TimelinePackage,
  type TimelineTrack,
} from '../../timeline/types';
import { CueEditor } from './CueEditor';
import { MechanicActionPanel } from './MechanicActionPanel';
import { TimeInput } from './TimeInput';

interface EventDetailProps {
  timeline: TimelinePackage;
  track: TimelineTrack;
  event: TimelineEvent | null;
  collisions: CollisionReport;
  highlightCueId: string | null;
  onChange(next: TimelinePackage): void;
  onNavigate(trackId: string, eventId: string, cueId?: string): void;
}

/** Event + cue detail column (spec §55, §58). */
export function EventDetail({
  timeline,
  track,
  event,
  collisions,
  highlightCueId,
  onChange,
  onNavigate,
}: EventDetailProps) {
  if (!event) {
    return (
      <div className="col">
        <h2>事件細節</h2>
        <p className="muted small">選擇一個事件才能編輯。</p>
      </div>
    );
  }

  const patch = (updater: (current: TimelineEvent) => TimelineEvent) =>
    onChange(updateEvent(timeline, track.id, event.id, updater));

  // One resolver everywhere, so this panel can never disagree with the list or
  // the compiler about when the event happens (spec §3.1).
  const resolved = resolveEventTiming(event, track.id, buildMechanicIndex(timeline));
  const linked = event.timing.kind === 'mechanic';

  return (
    <div className="col">
      <h2>事件細節</h2>

      {linked ? (
        <div className="field">
          <span className="small muted">時間</span>
          <div className="row" style={{ alignItems: 'baseline', gap: '0.5rem' }}>
            <span className="badge">連動到王機制</span>
            <span className="mono">
              {resolved.atMs === undefined ? '—' : formatMs(resolved.atMs)}
            </span>
            {resolved.source ? (
              <span className="small muted">
                來源：{resolved.source.track.name}／{resolved.source.event.name || '（未命名）'}
              </span>
            ) : (
              <span className="small text-error">
                {resolved.issue?.message ?? '連動來源失效'}
              </span>
            )}
          </div>
          <div className="row">
            <button
              type="button"
              className="ghost small"
              onClick={() => {
                const result = convertEventToFixedTime(timeline, track.id, event.id);
                if (result.ok) onChange(result.timeline);
              }}
              disabled={resolved.atMs === undefined}
            >
              轉成固定時間
            </button>
          </div>
          <p className="small muted">
            時間由來源機制決定。移動來源機制時，這個事件會跟著移動，cue 的前後偏移不變。
          </p>
        </div>
      ) : (
        <TimeInput
          label="時間"
          valueMs={resolved.atMs ?? 0}
          onChange={(ms) => {
            const result = setEventAbsoluteTime(timeline, track.id, event.id, ms);
            if (result.ok) onChange(result.timeline);
          }}
        />
      )}

      <label className="field">
        名稱
        <input
          value={event.name}
          onChange={(changeEvent) =>
            patch((current) => ({ ...current, name: changeEvent.target.value }))
          }
        />
      </label>

      <div className="row">
        <label className="field">
          階段
          <input
            value={linked ? (resolved.phase ?? '') : (event.phase ?? '')}
            placeholder="P1"
            disabled={linked}
            title={linked ? '連動事件的階段由來源機制決定' : undefined}
            onChange={(changeEvent) =>
              patch((current) => ({ ...current, phase: changeEvent.target.value || undefined }))
            }
          />
        </label>
        <label className="field">
          分類
          <select
            value={event.category}
            onChange={(changeEvent) =>
              patch((current) => ({
                ...current,
                category: changeEvent.target.value as EventCategory,
              }))
            }
          >
            {EVENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {EVENT_CATEGORY_LABEL[category]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {track.type === 'encounter' ? (
        <MechanicActionPanel
          key={`${track.id}:${event.id}`}
          timeline={timeline}
          sourceTrack={track}
          sourceEvent={event}
          collisionWindowMs={collisions.windowMs}
          onChange={onChange}
          onNavigate={onNavigate}
        />
      ) : null}

      <div className="row">
        <h3 style={{ margin: 0 }}>語音提示（{event.cues.length}）</h3>
        <span className="spacer" />
        <button
          type="button"
          className="primary"
          onClick={() => onChange(addCue(timeline, track.id, event.id).timeline)}
        >
          ＋ 新增提示
        </button>
      </div>

      {event.cues.length === 0 ? (
        <p className="small text-warn">這個事件沒有任何提示，不會發出聲音。</p>
      ) : null}

      {event.cues.map((cue) => (
        <CueEditor
          key={cue.id}
          timeline={timeline}
          trackId={track.id}
          event={event}
          cue={cue}
          collisions={collisions}
          onChange={onChange}
          highlight={cue.id === highlightCueId}
        />
      ))}
    </div>
  );
}
