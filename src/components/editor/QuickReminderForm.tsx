import { useMemo, useState } from 'react';
import { JOB_NAME_LABEL } from '../../i18n/labels';
import {
  reminderOffsetMs,
  validateQuickReminder,
  type QuickReminderDraft,
  type ReminderWhen,
} from '../../timeline/personalReminders';
import { formatMs } from '../../timeline/time';
import type { PlayerProfile, TimelineEvent, TimelinePackage } from '../../timeline/types';

interface QuickReminderFormProps {
  timeline: TimelinePackage;
  profile: PlayerProfile;
  sourceTrackId: string;
  sourceEvent: TimelineEvent;
  /** Name of the track the reminder will land in, for the "儲存位置" line. */
  destinationName: string;
  /** False when that track exists but is currently switched off. */
  destinationEnabled: boolean;
  audioBusyReason: string | null;
  onSave(draft: QuickReminderDraft, alsoEnableTrack: boolean): void;
  onPreviewCue(draft: QuickReminderDraft): void;
  onPreviewSegment(draft: QuickReminderDraft): void;
  onCancel(): void;
  onOpenAdvanced(): void;
  saveError?: string | null;
}

const SHORTCUTS: { label: string; when: ReminderWhen; seconds: number }[] = [
  { label: '前1秒', when: 'before', seconds: 1 },
  { label: '前3秒', when: 'before', seconds: 3 },
  { label: '前5秒', when: 'before', seconds: 5 },
  { label: '當下', when: 'at', seconds: 0 },
];

/**
 * "＋我的提醒" for one mechanic (spec §5.1).
 *
 * The default screen asks for two things only — what to say and how many
 * seconds before/after. Target, storage location, category, priority and the
 * cross-track link are all filled in by the system; there is no job matrix and
 * no "pick a track" step.
 */
export function QuickReminderForm({
  timeline,
  profile,
  sourceTrackId,
  sourceEvent,
  destinationName,
  destinationEnabled,
  audioBusyReason,
  onSave,
  onPreviewCue,
  onPreviewSegment,
  onCancel,
  onOpenAdvanced,
  saveError,
}: QuickReminderFormProps) {
  const [text, setText] = useState('');
  const [when, setWhen] = useState<ReminderWhen>('before');
  // Kept as a string so a half-typed "1." never reaches the domain model.
  const [secondsInput, setSecondsInput] = useState('3');
  const [alsoEnableTrack, setAlsoEnableTrack] = useState(true);

  const seconds = Number(secondsInput);
  const secondsValid = secondsInput.trim() !== '' && Number.isFinite(seconds) && seconds >= 0;

  const draft: QuickReminderDraft = {
    sourceTrackId,
    sourceEventId: sourceEvent.id,
    text,
    when,
    seconds: secondsValid ? seconds : Number.NaN,
  };

  const validation = useMemo(
    () => validateQuickReminder(timeline, draft),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timeline, sourceTrackId, sourceEvent.id, text, when, secondsInput],
  );

  const errorFor = (field: 'text' | 'seconds' | 'source' | 'time') =>
    validation.errors.find((issue) => issue.field === field)?.message ?? null;

  const offsetMs = secondsValid ? reminderOffsetMs(when, seconds) : Number.NaN;
  const canSubmit = validation.ok && secondsValid;

  return (
    <section className="quick-reminder col" aria-labelledby="quick-reminder-title">
      <h3 id="quick-reminder-title" style={{ margin: 0 }}>
        替「{sourceEvent.name || '未命名機制'}」加提醒
      </h3>
      <p className="small muted">
        我的身分：{profile.position}／{JOB_NAME_LABEL[profile.job]}
      </p>

      <label className="field">
        提醒內容
        <input
          value={text}
          autoFocus
          placeholder="下野戰，準備集合"
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      {errorFor('text') ? <p className="small text-error">{errorFor('text')}</p> : null}

      <div className="row">
        <label className="field">
          提醒時機
          <select value={when} onChange={(event) => setWhen(event.target.value as ReminderWhen)}>
            <option value="before">機制前</option>
            <option value="at">當下</option>
            <option value="after">機制後</option>
          </select>
        </label>
        <label className="field">
          秒數
          <input
            type="number"
            min={0}
            step={0.5}
            inputMode="decimal"
            value={when === 'at' ? '0' : secondsInput}
            disabled={when === 'at'}
            onChange={(event) => setSecondsInput(event.target.value)}
          />
        </label>
      </div>
      {errorFor('seconds') ? <p className="small text-error">{errorFor('seconds')}</p> : null}

      <div className="row">
        <span className="small muted">快捷選項</span>
        {SHORTCUTS.map((shortcut) => (
          <button
            key={shortcut.label}
            type="button"
            className="ghost small"
            onClick={() => {
              setWhen(shortcut.when);
              setSecondsInput(String(shortcut.seconds));
            }}
          >
            {shortcut.label}
          </button>
        ))}
      </div>

      <dl className="col quick-reminder-facts" style={{ margin: 0 }}>
        <div className="row">
          <strong className="small">適用對象</strong>
          <span className="small">
            {profile.position}／{JOB_NAME_LABEL[profile.job]}（自動）
          </span>
        </div>
        <div className="row">
          <strong className="small">儲存位置</strong>
          <span className="small">{destinationName}（自動）</span>
        </div>
        <div className="row">
          <strong className="small">實際觸發時間</strong>
          <span className="small mono" data-testid="quick-reminder-trigger">
            {validation.triggerMs === undefined ? '—' : formatMs(validation.triggerMs)}
          </span>
          <span className="small muted">
            {Number.isFinite(offsetMs)
              ? `機制 ${
                  validation.sourceAtMs === undefined ? '—' : formatMs(validation.sourceAtMs)
                } ${offsetMs === 0 ? '當下' : `${offsetMs > 0 ? '＋' : '－'}${Math.abs(offsetMs) / 1000} 秒`}`
              : ''}
          </span>
        </div>
      </dl>

      {errorFor('source') ? <p className="small text-error">{errorFor('source')}</p> : null}
      {errorFor('time') ? <p className="small text-error">{errorFor('time')}</p> : null}

      {!destinationEnabled ? (
        <label className="check small">
          <input
            type="checkbox"
            checked={alsoEnableTrack}
            onChange={(event) => setAlsoEnableTrack(event.target.checked)}
          />
          同時啟用「{destinationName}」（目前是關閉的，關閉時儲存了也不會播）
        </label>
      ) : null}

      {audioBusyReason ? <p className="small text-warn">{audioBusyReason}</p> : null}
      {saveError ? <p className="small text-error">{saveError}</p> : null}

      <div className="row">
        <button
          type="button"
          className="ghost"
          disabled={!canSubmit || audioBusyReason !== null}
          onClick={() => onPreviewCue(draft)}
        >
          試聽這句
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!canSubmit || audioBusyReason !== null}
          onClick={() => onPreviewSegment(draft)}
        >
          試播前後片段
        </button>
        <span className="spacer" />
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="primary"
          disabled={!canSubmit}
          onClick={() => onSave(draft, alsoEnableTrack)}
        >
          儲存
        </button>
      </div>

      <details>
        <summary className="small">進階設定</summary>
        <p className="small muted">
          需要指定其他職業對象、優先度、分類，或改用「固定時間」而不是連動到機制時，請用進階面板。
        </p>
        <button type="button" className="ghost small" onClick={onOpenAdvanced}>
          開啟進階面板
        </button>
      </details>
    </section>
  );
}
