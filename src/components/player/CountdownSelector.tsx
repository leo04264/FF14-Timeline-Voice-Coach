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
      setCustomError(parsed.error ?? 'Countdown must be >= 0');
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
            {preset / 1000}s
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          className={countdownMs === timelineDefaultMs ? 'active' : ''}
          onClick={() => onChange(timelineDefaultMs)}
        >
          Timeline default ({timelineDefaultMs / 1000}s)
        </button>
      </div>
      <div className="row">
        <label className="field">
          Custom (SS or MM:SS.mmm)
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
        <span className="mono">= {(countdownMs / 1000).toFixed(3)}s</span>
      </div>
      {customError ? <p className="small text-error">{customError}</p> : null}
    </div>
  );
}
