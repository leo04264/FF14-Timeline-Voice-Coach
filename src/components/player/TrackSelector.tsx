import { describeTarget } from '../../timeline/target';
import type { TimelineTrack } from '../../timeline/types';

interface TrackSelectorProps {
  tracks: TimelineTrack[];
  enabledTrackIds: string[];
  onChange(trackIds: string[]): void;
  disabled?: boolean;
}

/**
 * Track selection before START (spec §43). The choice is remembered per
 * timeline in browser storage and never written back into the timeline JSON.
 */
export function TrackSelector({ tracks, enabledTrackIds, onChange, disabled }: TrackSelectorProps) {
  const toggle = (trackId: string) => {
    onChange(
      enabledTrackIds.includes(trackId)
        ? enabledTrackIds.filter((id) => id !== trackId)
        : [...enabledTrackIds, trackId],
    );
  };

  return (
    <div className="col">
      {tracks.length === 0 ? <p className="muted small">This timeline has no tracks.</p> : null}
      {tracks.map((track) => (
        <label className="check" key={track.id}>
          <input
            type="checkbox"
            checked={enabledTrackIds.includes(track.id)}
            disabled={disabled}
            onChange={() => toggle(track.id)}
          />
          <span>{track.name}</span>
          <span className="badge">{track.type}</span>
          {track.target ? <span className="badge">{describeTarget(track.target)}</span> : null}
          <span className="muted small">
            {track.events.reduce((sum, event) => sum + event.cues.length, 0)} cues
          </span>
        </label>
      ))}
      <div className="row">
        <button
          type="button"
          className="ghost small"
          disabled={disabled}
          onClick={() => onChange(tracks.map((track) => track.id))}
        >
          All
        </button>
        <button type="button" className="ghost small" disabled={disabled} onClick={() => onChange([])}>
          None
        </button>
        <button
          type="button"
          className="ghost small"
          disabled={disabled}
          onClick={() =>
            onChange(tracks.filter((track) => track.enabledByDefault).map((track) => track.id))
          }
        >
          Defaults
        </button>
      </div>
    </div>
  );
}
