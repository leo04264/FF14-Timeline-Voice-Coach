import { TIMELINE_TRACK_TYPES, type TimelinePackage, type TimelineTrackType } from '../../timeline/types';
import { addTrack, duplicateTrack, moveTrack, removeTrack, updateTrack } from '../../timeline/edits';
import { TargetEditor } from './TargetEditor';

interface TrackListProps {
  timeline: TimelinePackage;
  selectedTrackId: string | null;
  onSelectTrack(trackId: string): void;
  onChange(next: TimelinePackage): void;
}

export function TrackList({ timeline, selectedTrackId, onSelectTrack, onChange }: TrackListProps) {
  const selected = timeline.tracks.find((track) => track.id === selectedTrackId) ?? null;

  return (
    <div className="col">
      <div className="row">
        <h2 style={{ margin: 0 }}>Tracks</h2>
        <span className="spacer" />
        <button
          type="button"
          onClick={() => {
            const next = addTrack(timeline);
            onChange(next);
            onSelectTrack(next.tracks[next.tracks.length - 1].id);
          }}
        >
          + Track
        </button>
      </div>

      <div className="col" style={{ gap: '0.15rem' }}>
        {timeline.tracks.map((track) => (
          <div
            key={track.id}
            className={`track-item ${track.id === selectedTrackId ? 'selected' : ''}`}
            onClick={() => onSelectTrack(track.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelectTrack(track.id);
            }}
          >
            <span style={{ flex: 1 }}>{track.name || '(unnamed)'}</span>
            <span className="badge">{track.type}</span>
            <span className="muted small">{track.events.length}</span>
          </div>
        ))}
      </div>

      {selected ? (
        <div className="col" style={{ marginTop: '0.75rem' }}>
          <h3>Track settings</h3>
          <label className="field">
            Name
            <input
              value={selected.name}
              onChange={(event) =>
                onChange(
                  updateTrack(timeline, selected.id, (track) => ({
                    ...track,
                    name: event.target.value,
                  })),
                )
              }
            />
          </label>
          <label className="field">
            Type
            <select
              value={selected.type}
              onChange={(event) =>
                onChange(
                  updateTrack(timeline, selected.id, (track) => ({
                    ...track,
                    type: event.target.value as TimelineTrackType,
                  })),
                )
              }
            >
              {TIMELINE_TRACK_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={selected.enabledByDefault}
              onChange={(event) =>
                onChange(
                  updateTrack(timeline, selected.id, (track) => ({
                    ...track,
                    enabledByDefault: event.target.checked,
                  })),
                )
              }
            />
            Enabled by default in the player
          </label>

          <TargetEditor
            label="Track target"
            target={selected.target}
            onChange={(target) =>
              onChange(updateTrack(timeline, selected.id, (track) => ({ ...track, target })))
            }
          />

          <div className="row">
            <button type="button" onClick={() => onChange(moveTrack(timeline, selected.id, -1))}>
              Move up
            </button>
            <button type="button" onClick={() => onChange(moveTrack(timeline, selected.id, 1))}>
              Move down
            </button>
            <button type="button" onClick={() => onChange(duplicateTrack(timeline, selected.id))}>
              Duplicate
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                onChange(removeTrack(timeline, selected.id));
                const remaining = timeline.tracks.filter((track) => track.id !== selected.id);
                if (remaining[0]) onSelectTrack(remaining[0].id);
              }}
            >
              Delete track
            </button>
          </div>
          <p className="small muted">Deleting is undoable while you stay on this page (spec §66).</p>
        </div>
      ) : null}
    </div>
  );
}
