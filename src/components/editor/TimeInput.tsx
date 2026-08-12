import { useEffect, useState } from 'react';
import { formatMs, formatNudge, NUDGE_STEPS_MS, parseTimeInput } from '../../timeline/time';

interface TimeInputProps {
  label: string;
  valueMs: number;
  onChange(ms: number): void;
  /** Offsets are signed; absolute times usually are not. */
  allowNegative?: boolean;
  id?: string;
}

/** `MM:SS.mmm` field with fine-adjust buttons (spec §59). */
export function TimeInput({ label, valueMs, onChange, allowNegative = true, id }: TimeInputProps) {
  const [text, setText] = useState(() => formatMs(valueMs));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(formatMs(valueMs));
    setError(null);
  }, [valueMs]);

  const commit = (raw: string) => {
    const parsed = parseTimeInput(raw);
    if (!parsed.ok || parsed.ms === undefined) {
      // Never silently clamp or auto-fix (spec §75).
      setError(parsed.error ?? 'Invalid time');
      return;
    }
    if (!allowNegative && parsed.ms < 0) {
      setError('Must be >= 0');
      return;
    }
    setError(null);
    onChange(parsed.ms);
  };

  return (
    <div className="col" style={{ gap: '0.25rem' }}>
      <label className="field" htmlFor={id}>
        {label}
        <input
          id={id}
          className={`mono ${error ? 'invalid' : ''}`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit((event.target as HTMLInputElement).value);
            }
          }}
        />
      </label>
      <div className="row" style={{ gap: '0.25rem' }}>
        {NUDGE_STEPS_MS.map((step) => (
          <button
            type="button"
            key={step}
            className="ghost small"
            onClick={() => {
              const next = valueMs + step;
              if (!allowNegative && next < 0) return;
              onChange(next);
            }}
          >
            {formatNudge(step)}
          </button>
        ))}
      </div>
      {error ? <span className="small text-error">{error}</span> : null}
    </div>
  );
}
