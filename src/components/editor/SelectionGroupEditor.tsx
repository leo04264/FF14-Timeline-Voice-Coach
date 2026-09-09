import {
  addSelectionGroup,
  addSelectionOption,
  removeSelectionGroup,
  removeSelectionOption,
  renameSelectionGroup,
  renameSelectionOption,
  setTrackSelection,
} from '../../timeline/selectionGroups';
import type { TimelinePackage } from '../../timeline/types';

interface SelectionGroupEditorProps {
  timeline: TimelinePackage;
  onChange(next: TimelinePackage): void;
}

/**
 * Author-side setup for mutually exclusive alternatives (spec §3.2).
 *
 * Without this the schema field would exist with no way to fill it in. Nothing
 * here infers exclusivity: a group, its options and each track's membership are
 * all stated explicitly, and unassigned tracks stay freely multi-selectable.
 */
export function SelectionGroupEditor({ timeline, onChange }: SelectionGroupEditorProps) {
  const groups = timeline.selectionGroups ?? [];

  return (
    <div className="col">
      <p className="small muted">
        方案群組用來標記「同一個群組裡只能用一種」的不同版本，例如兩套互斥的打法。
        同一個方案可以包含多條互補軌道；沒有標記方案的軌道（奶軸、輸出軸、我的自訂提醒）可以並用，不受影響。
        系統不會依軌道名稱或數量猜互斥關係。
      </p>

      <div className="row">
        <button
          type="button"
          className="primary small"
          onClick={() => onChange(addSelectionGroup(timeline).timeline)}
        >
          ＋ 新增方案群組
        </button>
      </div>

      {groups.length === 0 ? (
        <p className="small muted">目前沒有任何方案群組，所有軌道都是獨立多選。</p>
      ) : null}

      {groups.map((group) => (
        <fieldset className="col selection-group" key={group.id}>
          <legend>
            <input
              value={group.name}
              aria-label="方案群組名稱"
              onChange={(event) => onChange(renameSelectionGroup(timeline, group.id, event.target.value))}
            />
            <button
              type="button"
              className="ghost small"
              onClick={() => onChange(removeSelectionGroup(timeline, group.id))}
            >
              刪除群組
            </button>
          </legend>

          <div className="row">
            <button
              type="button"
              className="ghost small"
              onClick={() => onChange(addSelectionOption(timeline, group.id).timeline)}
            >
              ＋ 新增方案
            </button>
          </div>

          {group.options.map((option) => {
            const memberIds = timeline.tracks
              .filter(
                (track) =>
                  track.selection?.groupId === group.id && track.selection.optionId === option.id,
              )
              .map((track) => track.id);
            return (
              <div className="col selection-option" key={option.id}>
                <div className="row">
                  <input
                    value={option.name}
                    aria-label="方案名稱"
                    onChange={(event) =>
                      onChange(renameSelectionOption(timeline, group.id, option.id, event.target.value))
                    }
                  />
                  <span className="small muted">{memberIds.length} 條軌道</span>
                  <button
                    type="button"
                    className="ghost small"
                    onClick={() => onChange(removeSelectionOption(timeline, group.id, option.id))}
                  >
                    刪除方案
                  </button>
                </div>
                <div className="col" style={{ paddingLeft: '1rem' }}>
                  {timeline.tracks
                    .filter((track) => track.purpose !== 'personal-reminders')
                    .map((track) => {
                      const belongsHere =
                        track.selection?.groupId === group.id &&
                        track.selection.optionId === option.id;
                      const belongsElsewhere =
                        track.selection !== undefined && !belongsHere;
                      return (
                        <label className="check small" key={`${option.id}:${track.id}`}>
                          <input
                            type="checkbox"
                            checked={belongsHere}
                            disabled={belongsElsewhere}
                            title={
                              belongsElsewhere
                                ? '這條軌道已經屬於另一個方案，先取消那邊的指定'
                                : undefined
                            }
                            onChange={(event) =>
                              onChange(
                                setTrackSelection(
                                  timeline,
                                  track.id,
                                  event.target.checked
                                    ? { groupId: group.id, optionId: option.id }
                                    : null,
                                ),
                              )
                            }
                          />
                          <span>{track.name || '（未命名軌道）'}</span>
                        </label>
                      );
                    })}
                </div>
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
