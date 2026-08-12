import { EVENT_CATEGORY_LABEL } from '../../i18n/labels';
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
        <h2 style={{ margin: 0 }}>事件 — {track.name}</h2>
        <span className="spacer" />
        <button type="button" onClick={() => onChange(sortTrackEvents(timeline, track.id))}>
          依時間排序
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
          ＋ 新增事件
        </button>
      </div>

      <table>
        <thead>
          <tr>
            <th>時間</th>
            <th>階段</th>
            <th>事件名稱</th>
            <th>分類</th>
            <th>提示</th>
            <th>衝突</th>
            <th>啟用</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {track.events.length === 0 ? (
            <tr>
              <td colSpan={8} className="muted">
                還沒有任何事件。
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
                <td>{event.name || <span className="muted">（未命名）</span>}</td>
                <td>
                  <span className="badge">{EVENT_CATEGORY_LABEL[event.category]}</span>
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
                    aria-label={`啟用「${event.name}」的所有提示`}
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
                      複製
                    </button>
                    <button
                      type="button"
                      className="ghost small"
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        onChange(removeEvent(timeline, track.id, event.id));
                      }}
                    >
                      刪除
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small muted">
        「啟用」欄位會一次切換該事件底下所有提示；要單獨開關某一句請到右邊的細節面板（規格 §21）。
      </p>
    </div>
  );
}
