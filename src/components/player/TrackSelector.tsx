import { TRACK_TYPE_LABEL } from '../../i18n/labels';
import type { PlaybackPlanResult, TrackPlan } from '../../timeline/playbackPlan';
import { describeTarget } from '../../timeline/target';

interface TrackSelectorProps {
  plan: PlaybackPlanResult;
  onChange(trackIds: string[]): void;
  /** Safe replacement for the old blanket 全選 (spec §4.3.8). */
  onSelectApplicable(): void;
  onSelectDefaults(): void;
  disabled?: boolean;
}

/**
 * Track selection before START (spec §4.3).
 *
 * Counts come from the shared playback plan, so "本次播放 X 句" always equals
 * `compiled.cues.length`. Tracks that cannot address the current identity are
 * folded away with a readable reason instead of being silently listed as
 * checkable.
 */
export function TrackSelector({
  plan,
  onChange,
  onSelectApplicable,
  onSelectDefaults,
  disabled,
}: TrackSelectorProps) {
  const enabled = plan.tracks.filter((row) => row.selected).map((row) => row.track.id);
  const applicable = plan.tracks.filter((row) => row.applicable);
  const notApplicable = plan.tracks.filter((row) => !row.applicable);

  const toggle = (trackId: string) => {
    onChange(
      enabled.includes(trackId)
        ? enabled.filter((id) => id !== trackId)
        : [...enabled, trackId],
    );
  };

  const groupNameFor = (row: TrackPlan): string | null => {
    if (!row.selection) return null;
    const state = plan.selectionGroups.find((item) => item.group.id === row.selection!.groupId);
    if (!state) return null;
    const option = state.group.options.find((item) => item.id === row.selection!.optionId);
    return `${state.group.name}／${option?.name ?? row.selection.optionId}`;
  };

  return (
    <div className="col">
      {plan.tracks.length === 0 ? <p className="muted small">這份時間軸沒有任何軌道。</p> : null}

      {applicable.map((row) => {
        const groupName = groupNameFor(row);
        return (
          <label className="check" key={row.track.id}>
            <input
              type="checkbox"
              checked={row.selected}
              disabled={disabled}
              onChange={() => toggle(row.track.id)}
            />
            <span>{row.track.name}</span>
            <span className="badge">{TRACK_TYPE_LABEL[row.track.type]}</span>
            {row.track.target ? (
              <span className="badge">{describeTarget(row.track.target)}</span>
            ) : null}
            {row.purpose === 'personal-reminders' ? (
              <span className="badge">我的自訂提醒</span>
            ) : null}
            {groupName ? <span className="badge">{groupName}</span> : null}
            <span className="muted small">
              {row.allMatchingDisabled
                ? `0 句已啟用（共 ${row.matchingCueCount} 句符合身分，全部停用）`
                : row.selected
                  ? `本次播放 ${row.enabledCueCount} 句`
                  : `啟用後符合目前身分 ${row.enabledCueCount} 句`}
            </span>
            {row.blockedReason ? (
              <span className="badge warn">{row.blockedReason}</span>
            ) : null}
          </label>
        );
      })}

      {notApplicable.length > 0 ? (
        <details className="track-not-applicable">
          <summary className="small muted">
            不適用的軌道（{notApplicable.length}）
          </summary>
          <div className="col" style={{ marginTop: '0.5rem' }}>
            {notApplicable.map((row) => (
              <div className="row small muted" key={row.track.id}>
                <input type="checkbox" checked={false} disabled aria-label={`${row.track.name}（不可選）`} />
                <span>{row.track.name}</span>
                <span className="badge">{TRACK_TYPE_LABEL[row.track.type]}</span>
                <span>{row.reason}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <div className="row">
        <button type="button" className="ghost small" disabled={disabled} onClick={onSelectApplicable}>
          選取適用軌道
        </button>
        <button type="button" className="ghost small" disabled={disabled} onClick={() => onChange([])}>
          全不選
        </button>
        <button type="button" className="ghost small" disabled={disabled} onClick={onSelectDefaults}>
          預設值
        </button>
        <span className="spacer" />
        <span className="small mono" data-testid="plan-total">
          本次播放共 {plan.totalCueCount} 句
        </span>
      </div>
      <p className="small muted">
        「勾選」只代表這條軌道參與這一場；實際會出聲的句數是上面顯示的數字。停用的提示不計入。
      </p>
    </div>
  );
}
