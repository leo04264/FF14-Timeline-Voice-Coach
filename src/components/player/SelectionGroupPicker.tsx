import type { PlaybackPlanResult } from '../../timeline/playbackPlan';

interface SelectionGroupPickerProps {
  plan: PlaybackPlanResult;
  onSelect(groupId: string, optionId: string | null): void;
  disabled?: boolean;
}

/**
 * Mutually exclusive alternative picker (spec §4.4).
 *
 * Single-choice per group, and "不使用" is always allowed. When a stored
 * preference or an import left two options active, the conflict is shown and
 * start is blocked — the app never picks one silently.
 */
export function SelectionGroupPicker({ plan, onSelect, disabled }: SelectionGroupPickerProps) {
  if (plan.selectionGroups.length === 0) return null;

  return (
    <div className="col">
      {plan.selectionGroups.map((state) => {
        const conflict = state.conflictingOptionIds.length > 1;
        const name = `selection-group-${state.group.id}`;
        return (
          <fieldset className="selection-group" key={state.group.id}>
            <legend>
              {state.group.name}
              {conflict ? <span className="badge warn">選擇衝突</span> : null}
              {state.unused && !conflict ? <span className="badge">未使用</span> : null}
            </legend>

            {conflict ? (
              <p className="small text-error">
                目前同時啟用了多個互斥方案，這一場不能開始。請在下面選定一種。
              </p>
            ) : null}

            <label className="check">
              <input
                type="radio"
                name={name}
                checked={state.chosenOptionId === null && !conflict}
                disabled={disabled}
                onChange={() => onSelect(state.group.id, null)}
              />
              <span>不使用這個方案</span>
            </label>

            {state.options.map((option) => {
              const usable = option.applicableTrackIds.length > 0;
              return (
                <label className="check" key={option.option.id}>
                  <input
                    type="radio"
                    name={name}
                    checked={state.chosenOptionId === option.option.id}
                    disabled={disabled || !usable}
                    onChange={() => onSelect(state.group.id, option.option.id)}
                  />
                  <span>{option.option.name}</span>
                  <span className="muted small">
                    {usable
                      ? `${option.applicableTrackIds.length} 條適用軌道`
                      : '這個方案沒有適用於目前身分的軌道'}
                  </span>
                </label>
              );
            })}
          </fieldset>
        );
      })}
      <p className="small muted">
        同一個方案群組一次只能用一種。沒有標記方案的軌道（例如奶軸、輸出軸、我的自訂提醒）不受此限，可以並用。
      </p>
    </div>
  );
}
