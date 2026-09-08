import { useState } from 'react';
import { Modal } from '../common/Modal';
import type { DeleteDependentsStrategy, DependentSummary } from '../../timeline/edits';
import { buildMechanicIndex, resolveEventTiming } from '../../timeline/resolveEventTiming';
import { describeTarget } from '../../timeline/target';
import { formatMs } from '../../timeline/time';
import { isAbsoluteTiming, type TimelinePackage } from '../../timeline/types';

interface DeleteDependentsDialogProps {
  what: string;
  dependents: DependentSummary[];
  onCancel(): void;
  onConfirm(strategy: Exclude<DeleteDependentsStrategy, 'cancel'>): void;
}

/**
 * Deleting a mechanic (or a whole track) that other reminders point at
 * (spec §6.2).
 *
 * Every affected reminder is listed, *including* ones belonging to other jobs
 * that the current player cannot see, and cancel is the default. Each of the two
 * destructive options is one atomic document change, so a single undo restores
 * everything.
 */
export function DeleteDependentsDialog({
  what,
  dependents,
  onCancel,
  onConfirm,
}: DeleteDependentsDialogProps) {
  const [strategy, setStrategy] = useState<Exclude<DeleteDependentsStrategy, 'cancel'>>(
    'convert-to-fixed',
  );

  return (
    <Modal
      title={`刪除「${what}」會影響其他提醒`}
      onClose={onCancel}
      footer={
        <>
          <button type="button" autoFocus onClick={onCancel}>
            取消（預設）
          </button>
          <button type="button" className="wipe-button" onClick={() => onConfirm(strategy)}>
            照選擇的方式刪除
          </button>
        </>
      }
    >
      <p className="small">
        有 {dependents.length} 個提醒的時間連動到這裡，其中包含目前身分看不到的內容：
      </p>
      <div className="table-scroll" style={{ maxHeight: '14rem' }}>
        <table>
          <thead>
            <tr>
              <th>時間</th>
              <th>軌道</th>
              <th>適用對象</th>
              <th>提醒</th>
            </tr>
          </thead>
          <tbody>
            {dependents.map((row) => (
              <tr key={row.eventId}>
                <td className="mono">{row.atMs === undefined ? '—' : formatMs(row.atMs)}</td>
                <td>{row.trackName}</td>
                <td className="small">{describeTarget(row.target)}</td>
                <td className="small">{row.cueTexts.join('／') || row.eventName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <fieldset className="col">
        <legend>要怎麼處理這些提醒？</legend>
        <label className="check">
          <input
            type="radio"
            name="delete-strategy"
            checked={strategy === 'convert-to-fixed'}
            onChange={() => setStrategy('convert-to-fixed')}
          />
          <span>轉成固定時間後再刪除來源（實際觸發時刻不變）</span>
        </label>
        <label className="check">
          <input
            type="radio"
            name="delete-strategy"
            checked={strategy === 'delete-dependents'}
            onChange={() => setStrategy('delete-dependents')}
          />
          <span>連相關提醒一起刪除</span>
        </label>
      </fieldset>
    </Modal>
  );
}

interface LinkToMechanicDialogProps {
  timeline: TimelinePackage;
  trackId: string;
  eventId: string;
  onCancel(): void;
  onConfirm(sourceTrackId: string, sourceEventId: string): void;
}

/**
 * Explicitly link a fixed-time reminder to a mechanic (spec §6.1.6).
 *
 * The default keeps the current trigger instant: the offset is recomputed from
 * the old trigger time, so confirming does not move what the player hears. The
 * model only changes after confirmation.
 */
export function LinkToMechanicDialog({
  timeline,
  trackId,
  eventId,
  onCancel,
  onConfirm,
}: LinkToMechanicDialogProps) {
  const index = buildMechanicIndex(timeline);
  const anchors = index.anchors.slice().sort((a, b) => a.atMs - b.atMs);
  const [selected, setSelected] = useState<string>(anchors[0]?.event.id ?? '');

  const track = timeline.tracks.find((candidate) => candidate.id === trackId);
  const event = track?.events.find((candidate) => candidate.id === eventId);
  const currentAtMs = event ? resolveEventTiming(event, trackId, index).atMs : undefined;
  const chosen = anchors.find((anchor) => anchor.event.id === selected);
  const shift =
    currentAtMs !== undefined && chosen !== undefined ? currentAtMs - chosen.atMs : undefined;

  return (
    <Modal
      title="連動至機制"
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={!chosen}
            onClick={() => chosen && onConfirm(chosen.track.id, chosen.event.id)}
          >
            確認連動
          </button>
        </>
      }
    >
      <p className="small">
        目前這個提醒是固定時間
        {currentAtMs === undefined ? '' : `（${formatMs(currentAtMs)}）`}
        。選一個王機制作為錨點後，之後移動那個機制，這個提醒會跟著移動。
      </p>
      <label className="field">
        來源機制
        <select value={selected} onChange={(changeEvent) => setSelected(changeEvent.target.value)}>
          {anchors.map((anchor) => (
            <option key={anchor.event.id} value={anchor.event.id}>
              {formatMs(anchor.atMs)} · {anchor.event.name || '（未命名）'} · {anchor.track.name}
            </option>
          ))}
        </select>
      </label>
      {anchors.length === 0 ? (
        <p className="small text-warn">這份時間軸沒有可用的王機制錨點（需要戰鬥軌道的固定時間事件）。</p>
      ) : null}
      {shift !== undefined ? (
        <p className="small muted">
          為了讓實際觸發時刻不變，每一句的前後偏移會平移 {shift > 0 ? '＋' : '－'}
          {Math.abs(shift) / 1000} 秒。
        </p>
      ) : null}
      {event && !isAbsoluteTiming(event.timing) ? (
        <p className="small text-warn">這個事件已經是連動事件了。</p>
      ) : null}
    </Modal>
  );
}
