import { TRACK_TYPE_LABEL } from '../../i18n/labels';
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
        <h2 style={{ margin: 0 }}>軌道</h2>
        <span className="spacer" />
        <button
          type="button"
          onClick={() => {
            const next = addTrack(timeline);
            onChange(next);
            onSelectTrack(next.tracks[next.tracks.length - 1].id);
          }}
        >
          ＋ 新增軌道
        </button>
      </div>

      <div className="col" style={{ gap: '0.15rem' }}>
        {timeline.tracks.map((track) => (
          <div
            key={track.id}
            data-track-id={track.id}
            className={`track-item ${track.id === selectedTrackId ? 'selected' : ''}`}
            onClick={() => onSelectTrack(track.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelectTrack(track.id);
            }}
          >
            <span style={{ flex: 1 }}>{track.name || '（未命名）'}</span>
            <span className="badge">{TRACK_TYPE_LABEL[track.type]}</span>
            <span className="muted small">{track.events.length}</span>
          </div>
        ))}
      </div>

      {selected ? (
        <div className="col" style={{ marginTop: '0.75rem' }}>
          <h3>軌道設定</h3>
          <label className="field">
            名稱
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
            類型
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
                  {TRACK_TYPE_LABEL[type]}
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
            播放器預設啟用這個軌道
          </label>

          <TargetEditor
            label="軌道對象"
            target={selected.target}
            onChange={(target) =>
              onChange(updateTrack(timeline, selected.id, (track) => ({ ...track, target })))
            }
          />

          <div className="row">
            <button type="button" onClick={() => onChange(moveTrack(timeline, selected.id, -1))}>
              上移
            </button>
            <button type="button" onClick={() => onChange(moveTrack(timeline, selected.id, 1))}>
              下移
            </button>
            <button type="button" onClick={() => onChange(duplicateTrack(timeline, selected.id))}>
              複製
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
              刪除軌道
            </button>
          </div>
          <p className="small muted">只要還停留在這個頁面，刪除都可以用「復原」救回來（規格 §66）。</p>
        </div>
      ) : null}
    </div>
  );
}
