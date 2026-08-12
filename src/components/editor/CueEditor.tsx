import { CUE_PRIORITY_LABEL } from '../../i18n/labels';
import type { CollisionReport } from '../../timeline/collision';
import { describeCollision } from '../../timeline/collision';
import { removeCue, duplicateCue, updateCue } from '../../timeline/edits';
import { formatMs } from '../../timeline/time';
import { CUE_PRIORITIES, type CuePriority, type TimelineCue, type TimelineEvent, type TimelinePackage } from '../../timeline/types';
import { cueTextLengthLevel, measureCueText } from '../../timeline/validator';
import { TargetEditor } from './TargetEditor';
import { TimeInput } from './TimeInput';

interface CueEditorProps {
  timeline: TimelinePackage;
  trackId: string;
  event: TimelineEvent;
  cue: TimelineCue;
  collisions: CollisionReport;
  onChange(next: TimelinePackage): void;
  highlight?: boolean;
}

/** Cue editing (spec §57). */
export function CueEditor({
  timeline,
  trackId,
  event,
  cue,
  collisions,
  onChange,
  highlight,
}: CueEditorProps) {
  const patch = (updater: (current: TimelineCue) => TimelineCue) =>
    onChange(updateCue(timeline, trackId, event.id, cue.id, updater));

  const lengthLevel = cueTextLengthLevel(cue.text);
  const pairs = collisions.byCueId.get(cue.id) ?? [];
  const audio = cue.audio ?? {};

  return (
    <div
      className={`cue-card ${cue.enabled === false ? 'disabled' : ''}`}
      style={highlight ? { outline: '1px solid var(--accent)' } : undefined}
      data-cue-id={cue.id}
    >
      <div className="row">
        <strong className="small">語音提示</strong>
        <span className="mono small muted">觸發於 {formatMs(event.atMs + cue.offsetMs)}</span>
        <span className="spacer" />
        <label className="check small">
          <input
            type="checkbox"
            checked={cue.enabled !== false}
            onChange={(changeEvent) =>
              patch((current) => ({ ...current, enabled: changeEvent.target.checked }))
            }
          />
          啟用
        </label>
        <button
          type="button"
          className="ghost small"
          onClick={() => onChange(duplicateCue(timeline, trackId, event.id, cue.id))}
        >
          複製
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={() => onChange(removeCue(timeline, trackId, event.id, cue.id))}
        >
          刪除
        </button>
      </div>

      <TimeInput
        label="offset（負數代表事件之前）"
        valueMs={cue.offsetMs}
        onChange={(ms) => patch((current) => ({ ...current, offsetMs: ms }))}
      />

      <label className="field">
        語音內容
        <textarea
          rows={2}
          value={cue.text}
          onChange={(changeEvent) =>
            patch((current) => ({ ...current, text: changeEvent.target.value }))
          }
        />
      </label>
      <div className="row small">
        <span className={lengthLevel === 'severe' ? 'text-error' : lengthLevel === 'warning' ? 'text-warn' : 'muted'}>
          約 {measureCueText(cue.text)} 字
          {lengthLevel === 'severe'
            ? '：太長，可能來不及在下一句之前念完'
            : lengthLevel === 'warning'
              ? '：偏長'
              : ''}
        </span>
        {cue.text.trim() === '' ? <span className="text-error">語音內容不能空白</span> : null}
      </div>

      <label className="field" style={{ maxWidth: 160 }}>
        優先度
        <select
          value={cue.priority ?? 'normal'}
          onChange={(changeEvent) =>
            patch((current) => ({ ...current, priority: changeEvent.target.value as CuePriority }))
          }
        >
          {CUE_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {CUE_PRIORITY_LABEL[priority]}
            </option>
          ))}
        </select>
      </label>

      <TargetEditor
        label="提示對象"
        target={cue.target}
        onChange={(target) => patch((current) => ({ ...current, target }))}
      />

      <details>
        <summary className="small">語音設定（覆寫預設值）</summary>
        <div className="row" style={{ marginTop: '0.4rem' }}>
          <label className="field">
            語言
            <input
              value={audio.lang ?? ''}
              placeholder="沿用預設"
              onChange={(changeEvent) =>
                patch((current) => ({
                  ...current,
                  audio: { ...audio, lang: changeEvent.target.value || undefined },
                }))
              }
            />
          </label>
          <label className="field">
            語速
            <input
              type="number"
              step={0.05}
              min={0.5}
              max={2}
              value={audio.rate ?? ''}
              placeholder="沿用預設"
              onChange={(changeEvent) => {
                const value = changeEvent.target.value;
                patch((current) => ({
                  ...current,
                  audio: { ...audio, rate: value === '' ? undefined : Number(value) },
                }));
              }}
            />
          </label>
          <label className="field">
            音量
            <input
              type="number"
              step={0.05}
              min={0}
              max={1}
              value={audio.volume ?? ''}
              placeholder="沿用預設"
              onChange={(changeEvent) => {
                const value = changeEvent.target.value;
                patch((current) => ({
                  ...current,
                  audio: { ...audio, volume: value === '' ? undefined : Number(value) },
                }));
              }}
            />
          </label>
        </div>
      </details>

      {pairs.length > 0 ? (
        <div className="col" style={{ marginTop: '0.4rem', gap: '0.2rem' }}>
          {pairs.map((pair, index) => (
            <span
              key={index}
              className={`small ${pair.severity === 'severe' ? 'text-error' : 'text-warn'}`}
            >
              衝突：{describeCollision(pair)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
