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
        <h2>Event</h2>
        <p className="muted small">Select an event to edit it.</p>
      </div>
    );
  }

  const patch = (updater: (current: TimelineEvent) => TimelineEvent) =>
    onChange(updateEvent(timeline, trackId, event.id, updater));

  return (
    <div className="col">
      <h2>Event</h2>

      <TimeInput
        label="Time"
        valueMs={event.atMs}
        onChange={(ms) => patch((current) => ({ ...current, atMs: ms }))}
      />

      <label className="field">
        Name
        <input
          value={event.name}
          onChange={(changeEvent) =>
            patch((current) => ({ ...current, name: changeEvent.target.value }))
          }
        />
      </label>

      <div className="row">
        <label className="field">
          Phase
          <input
            value={event.phase ?? ''}
            placeholder="P1"
            onChange={(changeEvent) =>
              patch((current) => ({ ...current, phase: changeEvent.target.value || undefined }))
            }
          />
        </label>
        <label className="field">
          Category
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
                {category}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="row">
        <h3 style={{ margin: 0 }}>Cues ({event.cues.length})</h3>
        <span className="spacer" />
        <button
          type="button"
          className="primary"
          onClick={() => onChange(addCue(timeline, trackId, event.id).timeline)}
        >
          + Add Cue
        </button>
      </div>

      {event.cues.length === 0 ? (
        <p className="small text-warn">This event has no cues — nothing will be spoken.</p>
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
