import { useEffect, useState } from 'react';
import { formatMs } from '../../timeline/time';
import type { CompiledCue } from '../../timeline/types';

/** How long a fired cue stays highlighted (spec §45). */
export const CUE_HIGHLIGHT_MS = 3000;

interface CueDisplayProps {
  currentCue: CompiledCue | null;
  currentCueAtMs: number | null;
  nextCues: CompiledCue[];
}

export function CueDisplay({ currentCue, currentCueAtMs, nextCues }: CueDisplayProps) {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!currentCue || currentCueAtMs === null) return;
    setStale(false);
    const elapsed = performance.now() - currentCueAtMs;
    const remaining = CUE_HIGHLIGHT_MS - elapsed;
    if (remaining <= 0) {
      setStale(true);
      return;
    }
    const handle = setTimeout(() => setStale(true), remaining);
    return () => clearTimeout(handle);
    // A new cue within the 3s window replaces the old one immediately.
  }, [currentCue, currentCueAtMs]);

  const highPriority = currentCue?.priority === 'high';

  return (
    <div className="col">
      <div
        className={[
          'cue-current',
          currentCue ? (stale ? 'stale' : 'fresh') : 'stale',
          highPriority ? 'high' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="status"
        aria-live="polite"
        data-testid="current-cue"
      >
        {currentCue ? currentCue.text : <span className="muted">—</span>}
      </div>

      {currentCue ? (
        <div className="row small muted">
          <span>{currentCue.eventName}</span>
          {currentCue.phase ? <span className="badge">{currentCue.phase}</span> : null}
          <span className="badge">{currentCue.category}</span>
          <span className={`badge ${highPriority ? 'high' : ''}`}>{currentCue.priority}</span>
          <span className="mono">{formatMs(currentCue.triggerMs)}</span>
        </div>
      ) : null}

      <h3 style={{ marginTop: '0.5rem' }}>Next 3</h3>
      <div className="next-cues" data-testid="next-cues">
        {nextCues.length === 0 ? <span className="muted small">No more cues</span> : null}
        {nextCues.map((cue) => (
          <div
            key={`${cue.id}-${cue.triggerMs}`}
            className={`next-cue ${cue.priority === 'high' ? 'high' : ''}`}
          >
            <span className="mono muted">{formatMs(cue.triggerMs, { millis: false })}</span>
            <span>{cue.text}</span>
            <span className="spacer" />
            <span className="muted small">{cue.eventName}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
