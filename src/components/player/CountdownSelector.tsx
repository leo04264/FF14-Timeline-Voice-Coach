import { useState } from 'react';
import { COUNTDOWN_PRESETS_MS } from '../../storage/settings';
import { parseTimeInput } from '../../timeline/time';

interface CountdownSelectorProps {
  countdownMs: number;
  timelineDefaultMs: number;
  onChange(countdownMs: number): void;
  disabled?: boolean;
  /**
   * Shortest countdown that still covers every cue of this run, from the
   * playback plan. Presets below it are shown as unusable *before* the player
   * hits a blocked start, because several built-in plans open with a cue at
   * -15s and the 5s / 10s presets simply cannot fit them.
   */
  minimumMs?: number;
}

/**
 * Countdown override (spec §17). Never writes back into the timeline; the
 * chosen value is remembered per browser.
 */
export function CountdownSelector({
  countdownMs,
  timelineDefaultMs,
  onChange,
  disabled,
  minimumMs = 0,
}: CountdownSelectorProps) {
  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  const applyCustom = () => {
    const parsed = parseTimeInput(custom);
    if (!parsed.ok || parsed.ms === undefined || parsed.ms < 0) {
      setCustomError(parsed.error ?? '倒數秒數必須大於等於 0');
      return;
    }
    setCustomError(null);
    onChange(parsed.ms);
  };

  const tooShort = (ms: number) => minimumMs > 0 && ms < minimumMs;
  const shortReason = `這一場最早的提示在 -${minimumMs / 1000} 秒，這個倒數蓋不住它`;
  const anyTooShort =
    COUNTDOWN_PRESETS_MS.some(tooShort) || tooShort(timelineDefaultMs);

  return (
    <div className="col">
      <div className="row">
        {COUNTDOWN_PRESETS_MS.map((preset) => (
          <button
            type="button"
            key={preset}
            disabled={disabled || tooShort(preset)}
            title={tooShort(preset) ? shortReason : undefined}
            className={countdownMs === preset ? 'active' : ''}
            onClick={() => onChange(preset)}
          >
            {preset / 1000} 秒
          </button>
        ))}
        <button
          type="button"
          disabled={disabled || tooShort(timelineDefaultMs)}
          title={tooShort(timelineDefaultMs) ? shortReason : undefined}
          className={countdownMs === timelineDefaultMs ? 'active' : ''}
          onClick={() => onChange(timelineDefaultMs)}
        >
          時間軸預設（{timelineDefaultMs / 1000} 秒）
        </button>
      </div>
      {anyTooShort ? (
        <p className="small muted">
          這一場最早的提示在 -{minimumMs / 1000} 秒，所以倒數至少要 {minimumMs / 1000} 秒；
          比這個短的選項已停用。倒數不夠長的話那句開場提示會來不及，系統不會偷偷略過它。
        </p>
      ) : null}
      <div className="row">
        <label className="field">
          自訂（SS 或 MM:SS.mmm）
          <input
            value={custom}
            disabled={disabled}
            placeholder="00:07.000"
            className={customError ? 'invalid' : ''}
            onChange={(event) => setCustom(event.target.value)}
            onBlur={applyCustom}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyCustom();
            }}
          />
        </label>
        <span className="mono">= {(countdownMs / 1000).toFixed(3)} 秒</span>
      </div>
      {customError ? <p className="small text-error">{customError}</p> : null}
    </div>
  );
}
