import type { CollisionReport } from '../../timeline/collision';
import { addEvent, duplicateEvent, removeEvent, sortTrackEvents, updateEvent } from '../../timeline/edits';
import { formatMs } from '../../timeline/time';
import type { TimelinePackage, TimelineTrack } from '../../timeline/types';

interface EventTableProps {
  timeline: TimelinePackage;
  track: TimelineTrack;
  selectedEventId: string | null;
  collisions: CollisionReport;
  onSelectEvent(eventId: string): void;
  onChange(next: TimelinePackage): void;
}

/** Event table (spec §56). */
export function EventTable({
  timeline,
  track,
  selectedEventId,
  collisions,
  onSelectEvent,
  onChange,
}: EventTableProps) {
  const collisionCount = (eventId: string) => {
    const event = track.events.find((candidate) => candidate.id === eventId);
    if (!event) return 0;
    return event.cues.reduce(
      (sum, cue) => sum + (collisions.byCueId.get(cue.id)?.length ?? 0),
      0,
    );
  };

  return (
    <div className="col">
      <div className="row">
        <h2 style={{ margin: 0 }}>Events — {track.name}</h2>
        <span className="spacer" />
        <button type="button" onClick={() => onChange(sortTrackEvents(timeline, track.id))}>
          Sort by time
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            const result = addEvent(timeline, track.id, 0);
            onChange(result.timeline);
            onSelectEvent(result.eventId);
          }}
        >
          + Event
        </button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Phase</th>
            <th>Event Name</th>
            <th>Category</th>
            <th>Cues</th>
            <th>Collision</th>
            <th>Enabled</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {track.events.length === 0 ? (
            <tr>
              <td colSpan={8} className="muted">
                No events yet.
              </td>
            </tr>
          ) : null}
          {track.events.map((event) => {
            const enabledCues = event.cues.filter((cue) => cue.enabled !== false).length;
            const collisionsHere = collisionCount(event.id);
            return (
              <tr
                key={event.id}
                className={event.id === selectedEventId ? 'selected' : ''}
                onClick={() => onSelectEvent(event.id)}
              >
                <td className="mono">{formatMs(event.atMs)}</td>
                <td>{event.phase ?? ''}</td>
                <td>{event.name || <span className="muted">(unnamed)</span>}</td>
                <td>
                  <span className="badge">{event.category}</span>
                </td>
                <td className="mono">
                  {enabledCues}/{event.cues.length}
                </td>
                <td>
                  {collisionsHere > 0 ? (
                    <span className="badge warn">{collisionsHere}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Enable all cues of ${event.name}`}
                    checked={event.cues.length > 0 && enabledCues === event.cues.length}
                    disabled={event.cues.length === 0}
                    onClick={(clickEvent) => clickEvent.stopPropagation()}
                    onChange={(changeEvent) => {
                      const enabled = changeEvent.target.checked;
                      onChange(
                        updateEvent(timeline, track.id, event.id, (current) => ({
                          ...current,
                          cues: current.cues.map((cue) => ({ ...cue, enabled })),
                        })),
                      );
                    }}
                  />
                </td>
                <td>
                  <div className="row" style={{ gap: '0.25rem' }}>
                    <button
                      type="button"
                      className="ghost small"
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        const result = duplicateEvent(timeline, track.id, event.id);
                        onChange(result.timeline);
                        onSelectEvent(result.eventId);
                      }}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="ghost small"
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        onChange(removeEvent(timeline, track.id, event.id));
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small muted">
        The Enabled column toggles every cue of the event; individual cues are toggled in the detail
        panel (spec §21).
      </p>
    </div>
  );
}
