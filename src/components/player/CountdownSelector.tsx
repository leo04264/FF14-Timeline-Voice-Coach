import { useState } from 'react';
import { COUNTDOWN_PRESETS_MS } from '../../storage/settings';
import { parseTimeInput } from '../../timeline/time';

interface CountdownSelectorProps {
  countdownMs: number;
  timelineDefaultMs: number;
  onChange(countdownMs: number): void;
  disabled?: boolean;
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

  return (
    <div className="col">
      <div className="row">
        {COUNTDOWN_PRESETS_MS.map((preset) => (
          <button
            type="button"
            key={preset}
            disabled={disabled}
            className={countdownMs === preset ? 'active' : ''}
            onClick={() => onChange(preset)}
          >
            {preset / 1000} 秒
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          className={countdownMs === timelineDefaultMs ? 'active' : ''}
          onClick={() => onChange(timelineDefaultMs)}
        >
          時間軸預設（{timelineDefaultMs / 1000} 秒）
        </button>
      </div>
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
