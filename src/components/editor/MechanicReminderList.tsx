import { Fragment, useMemo, useState } from 'react';
import { JOB_NAME_LABEL } from '../../i18n/labels';
import { PERSONAL_TRACK_PURPOSE } from '../../timeline/personalReminders';
import { buildMechanicIndex, resolveEventTiming } from '../../timeline/resolveEventTiming';
import { combineTargets, describeTarget, isEmptyTarget, matchesTarget } from '../../timeline/target';
import { formatMs } from '../../timeline/time';
import {
  isAbsoluteTiming,
  type PlayerProfile,
  type TimelineCue,
  type TimelineEvent,
  type TimelinePackage,
  type TimelineTrack,
} from '../../timeline/types';

export interface ReminderRowRef {
  trackId: string;
  eventId: string;
  cueId: string;
}

interface MechanicReminderListProps {
  timeline: TimelinePackage;
  profile: PlayerProfile;
  audioBusyReason: string | null;
  onAddReminder(sourceTrackId: string, sourceEventId: string): void;
  /** One atomic edit; the caller pushes exactly one undo step. */
  onEditReminder(ref: ReminderRowRef, patch: { text?: string; offsetMs?: number; enabled?: boolean }): void;
  onDeleteReminder(ref: ReminderRowRef): void;
  onPreviewCue(ref: ReminderRowRef): void;
  onPreviewSegment(triggerMs: number): void;
  onNavigateAdvanced(trackId: string, eventId: string, cueId?: string): void;
  /** Opens the explicit "link this fixed-time reminder to a mechanic" flow. */
  onLinkToMechanic(trackId: string, eventId: string): void;
}

interface CueRow {
  track: TimelineTrack;
  event: TimelineEvent;
  cue: TimelineCue;
  triggerMs?: number;
  /** True when the effective audience is wider than just this player. */
  shared: boolean;
  personal: boolean;
}

function audienceIsExactlyProfile(
  track: TimelineTrack,
  cue: TimelineCue,
  profile: PlayerProfile,
): boolean {
  const target = combineTargets(track.target, cue.target);
  return (
    target?.positions?.length === 1 &&
    target.positions[0] === profile.position &&
    target.jobs?.length === 1 &&
    target.jobs[0] === profile.job
  );
}

/**
 * The everyday "mechanics + my reminders" view (spec §6.1).
 *
 * The advanced track/event editor stays exactly as it was; this is a flatter
 * list for the common case. Times come from the shared resolver, and a reminder
 * only appears under a mechanic when it genuinely *references* that mechanic —
 * never because the seconds happen to match.
 */
export function MechanicReminderList({
  timeline,
  profile,
  audioBusyReason,
  onAddReminder,
  onEditReminder,
  onDeleteReminder,
  onPreviewCue,
  onPreviewSegment,
  onNavigateAdvanced,
  onLinkToMechanic,
}: MechanicReminderListProps) {
  const [phaseFilter, setPhaseFilter] = useState('');
  const [textFilter, setTextFilter] = useState('');
  const [editing, setEditing] = useState<ReminderRowRef | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftSeconds, setDraftSeconds] = useState('');

  const index = useMemo(() => buildMechanicIndex(timeline), [timeline]);

  const allCueRows = useMemo((): CueRow[] => {
    const rows: CueRow[] = [];
    for (const track of timeline.tracks) {
      for (const event of track.events) {
        const resolved = resolveEventTiming(event, track.id, index);
        for (const cue of event.cues) {
          const target = combineTargets(track.target, cue.target);
          if (isEmptyTarget(target)) continue;
          if (!matchesTarget(target, profile)) continue;
          rows.push({
            track,
            event,
            cue,
            triggerMs: resolved.atMs === undefined ? undefined : resolved.atMs + cue.offsetMs,
            shared: !audienceIsExactlyProfile(track, cue, profile),
            personal: track.purpose === PERSONAL_TRACK_PURPOSE,
          });
        }
      }
    }
    return rows;
  }, [timeline, index, profile]);

  const mechanics = useMemo(() => {
    const encounterTracks = timeline.tracks.filter((track) => track.type === 'encounter');
    const rows = encounterTracks.flatMap((track) =>
      track.events.map((event) => {
        const resolved = resolveEventTiming(event, track.id, index);
        return { track, event, atMs: resolved.atMs, phase: resolved.phase };
      }),
    );
    return rows.sort(
      (a, b) => (a.atMs ?? Number.POSITIVE_INFINITY) - (b.atMs ?? Number.POSITIVE_INFINITY),
    );
  }, [timeline, index]);

  const phases = useMemo(
    () => [...new Set(mechanics.map((row) => row.phase).filter((value): value is string => !!value))],
    [mechanics],
  );

  const remindersFor = (sourceEventId: string) =>
    allCueRows.filter(
      (row) =>
        row.event.timing.kind === 'mechanic' && row.event.timing.sourceEventId === sourceEventId,
    );

  /** Reminders that apply to me but hang off a fixed time, not a mechanic. */
  const fixedTimeRows = useMemo(
    () =>
      allCueRows
        .filter((row) => row.track.type !== 'encounter' && isAbsoluteTiming(row.event.timing))
        .sort(
          (a, b) =>
            (a.triggerMs ?? Number.POSITIVE_INFINITY) - (b.triggerMs ?? Number.POSITIVE_INFINITY),
        ),
    [allCueRows],
  );

  const matchesFilters = (mechanicName: string, phase: string | undefined, rows: CueRow[]) => {
    if (phaseFilter && phase !== phaseFilter) return false;
    if (!textFilter) return true;
    const needle = textFilter.toLowerCase();
    return (
      mechanicName.toLowerCase().includes(needle) ||
      rows.some((row) => row.cue.text.toLowerCase().includes(needle))
    );
  };

  const beginEdit = (row: CueRow) => {
    setEditing({ trackId: row.track.id, eventId: row.event.id, cueId: row.cue.id });
    setDraftText(row.cue.text);
    setDraftSeconds(String(row.cue.offsetMs / 1000));
  };

  const commitEdit = () => {
    if (!editing) return;
    const seconds = Number(draftSeconds);
    const patch: { text?: string; offsetMs?: number } = {};
    if (draftText.trim() !== '') patch.text = draftText.trim();
    // A half-typed value never reaches the domain model (spec §6.1.8).
    if (draftSeconds.trim() !== '' && Number.isFinite(seconds)) {
      patch.offsetMs = Math.round(seconds * 1000);
    }
    if (Object.keys(patch).length > 0) onEditReminder(editing, patch);
    setEditing(null);
  };

  const isEditing = (row: CueRow) =>
    editing?.trackId === row.track.id &&
    editing?.eventId === row.event.id &&
    editing?.cueId === row.cue.id;

  const renderReminderRow = (row: CueRow) => {
    const ref: ReminderRowRef = {
      trackId: row.track.id,
      eventId: row.event.id,
      cueId: row.cue.id,
    };
    const editingHere = isEditing(row);

    return (
      <tr key={row.cue.id} className={row.cue.enabled === false ? 'disabled' : ''}>
        <td className="mono">{row.triggerMs === undefined ? '—' : formatMs(row.triggerMs)}</td>
        <td>
          {row.shared ? (
            <span className="badge" title={`適用對象：${describeTarget(combineTargets(row.track.target, row.cue.target))}`}>
              共通
            </span>
          ) : (
            <span className="badge">我的</span>
          )}
          <span className="small muted"> {row.track.name}</span>
        </td>
        <td>
          {editingHere ? (
            <input
              value={draftText}
              autoFocus
              aria-label="提醒內容"
              onChange={(event) => setDraftText(event.target.value)}
              onKeyDown={(event) => {
                // Space here is typing, not a player shortcut; the player's
                // listener already ignores INPUT, and we stop propagation so no
                // other global handler sees it either (spec §6.1.8).
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitEdit();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setEditing(null);
                }
              }}
            />
          ) : (
            <span>{row.cue.text || <span className="muted">（空白）</span>}</span>
          )}
        </td>
        <td className="mono">
          {editingHere ? (
            <input
              type="number"
              step={0.5}
              value={draftSeconds}
              aria-label="前後幾秒"
              style={{ width: '5rem' }}
              onChange={(event) => setDraftSeconds(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitEdit();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setEditing(null);
                }
              }}
            />
          ) : (
            `${row.cue.offsetMs > 0 ? '+' : ''}${row.cue.offsetMs / 1000}s`
          )}
        </td>
        <td>
          <input
            type="checkbox"
            aria-label={`啟用「${row.cue.text}」`}
            checked={row.cue.enabled !== false}
            disabled={row.shared}
            title={row.shared ? '這是共通提示，請用進階編輯修改' : undefined}
            onChange={(event) => onEditReminder(ref, { enabled: event.target.checked })}
          />
        </td>
        <td>
          <div className="row" style={{ gap: '0.25rem' }}>
            <button
              type="button"
              className="ghost small"
              disabled={audioBusyReason !== null}
              onClick={() => onPreviewCue(ref)}
            >
              試聽
            </button>
            <button
              type="button"
              className="ghost small"
              disabled={audioBusyReason !== null || row.triggerMs === undefined}
              onClick={() => row.triggerMs !== undefined && onPreviewSegment(row.triggerMs)}
            >
              試播片段
            </button>
            {row.shared ? (
              <button
                type="button"
                className="ghost small"
                onClick={() => onNavigateAdvanced(ref.trackId, ref.eventId, ref.cueId)}
              >
                進階編輯
              </button>
            ) : editingHere ? (
              <>
                <button type="button" className="ghost small" onClick={commitEdit}>
                  完成
                </button>
                <button type="button" className="ghost small" onClick={() => setEditing(null)}>
                  取消
                </button>
              </>
            ) : (
              <>
                <button type="button" className="ghost small" onClick={() => beginEdit(row)}>
                  編輯
                </button>
                <button type="button" className="ghost small" onClick={() => onDeleteReminder(ref)}>
                  刪除
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <section className="col mechanic-reminder-list" aria-labelledby="mechanic-reminder-list-title">
      <div className="row">
        <h2 id="mechanic-reminder-list-title" style={{ margin: 0 }}>
          機制＋我的提醒
        </h2>
        <span className="spacer" />
        <span className="small muted">
          目前身分 {profile.position}／{JOB_NAME_LABEL[profile.job]}
        </span>
      </div>

      <div className="row">
        <label className="field">
          階段
          <select value={phaseFilter} onChange={(event) => setPhaseFilter(event.target.value)}>
            <option value="">全部</option>
            {phases.map((phase) => (
              <option key={phase} value={phase}>
                {phase}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          搜尋機制或提醒文字
          <input value={textFilter} onChange={(event) => setTextFilter(event.target.value)} />
        </label>
      </div>

      {audioBusyReason ? <p className="small text-warn">{audioBusyReason}</p> : null}

      <div className="table-scroll" role="region" aria-label="機制與我的提醒" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>時間</th>
              <th>來源</th>
              <th>我的提醒</th>
              <th>前／後幾秒</th>
              <th>啟用</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {mechanics.map((mechanic) => {
              const rows = remindersFor(mechanic.event.id);
              if (!matchesFilters(mechanic.event.name, mechanic.phase, rows)) return null;
              return (
                <Fragment key={mechanic.event.id}>
                  <tr className="mechanic-head-row">
                    <td className="mono">
                      {mechanic.atMs === undefined ? (
                        <span className="text-error">連動失效</span>
                      ) : (
                        formatMs(mechanic.atMs)
                      )}
                    </td>
                    <td colSpan={2}>
                      <strong>{mechanic.event.name || '（未命名機制）'}</strong>
                      {mechanic.phase ? <span className="badge">{mechanic.phase}</span> : null}
                    </td>
                    <td colSpan={2} className="small muted">
                      {rows.length === 0 ? '還沒有你的提醒' : `${rows.length} 句`}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="primary small"
                        onClick={() => onAddReminder(mechanic.track.id, mechanic.event.id)}
                      >
                        ＋我的提醒
                      </button>
                    </td>
                  </tr>
                  {rows.map((row) => renderReminderRow(row))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {fixedTimeRows.length > 0 ? (
        <details className="panel" open>
          <summary>固定時間／尚未連動（{fixedTimeRows.length}）</summary>
          <p className="small muted">
            這些提醒有自己的絕對時間，沒有連動到任何機制。系統不會只因為秒數相同或名稱相近就自動把它們歸到某個機制底下；
            要連動請用下面的「連動至機制」，確認後才會改變資料。
          </p>
          <div className="table-scroll" role="region" aria-label="固定時間提醒" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>時間</th>
                  <th>來源</th>
                  <th>提醒</th>
                  <th>前／後幾秒</th>
                  <th>啟用</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {fixedTimeRows.map((row) => (
                  <Fragment key={row.cue.id}>
                    {renderReminderRow(row)}
                    <tr>
                      <td />
                      <td colSpan={5}>
                        <button
                          type="button"
                          className="ghost small"
                          onClick={() => onLinkToMechanic(row.track.id, row.event.id)}
                        >
                          連動至機制…
                        </button>
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <p className="small muted">
        「適用於我」不等於「只影響我」：標成「共通」的句子也會被其他人聽到，修改它請走進階編輯。
      </p>
    </section>
  );
}
