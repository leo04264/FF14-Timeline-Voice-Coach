import { EVENT_CATEGORY_LABEL } from '../../i18n/labels';
import type { CollisionReport } from '../../timeline/collision';
import { addCue, updateEvent } from '../../timeline/edits';
import { EVENT_CATEGORIES, type EventCategory, type TimelineEvent, type TimelinePackage } from '../../timeline/types';
import { CueEditor } from './CueEditor';
import { TimeInput } from './TimeInput';

interface EventDetailProps {
  timeline: TimelinePackage;
  trackId: string;
  event: TimelineEvent | null;
  collisions: CollisionReport;
  highlightCueId: string | null;
  onChange(next: TimelinePackage): void;
}

/** Event + cue detail column (spec §55, §58). */
export function EventDetail({
  timeline,
  trackId,
  event,
  collisions,
  highlightCueId,
  onChange,
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
    onChange(updateEvent(timeline, trackId, event.id, updater));

  return (
    <div className="col">
      <h2>事件細節</h2>

      <TimeInput
        label="時間"
        valueMs={event.atMs}
        onChange={(ms) => patch((current) => ({ ...current, atMs: ms }))}
      />

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
            value={event.phase ?? ''}
            placeholder="P1"
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

      <div className="row">
        <h3 style={{ margin: 0 }}>語音提示（{event.cues.length}）</h3>
        <span className="spacer" />
        <button
          type="button"
          className="primary"
          onClick={() => onChange(addCue(timeline, trackId, event.id).timeline)}
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
          trackId={trackId}
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
