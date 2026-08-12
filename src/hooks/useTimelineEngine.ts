import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BrowserTtsBackend } from '../audio/BrowserTtsBackend';
import { DebugRecorder } from '../debug/DebugRecorder';
import type { DebugCueRecord } from '../debug/types';
import { PerformanceClock } from '../engine/Clock';
import { TimelineEngine, type EngineSnapshot } from '../engine/TimelineEngine';

/**
 * React binding for the engine (spec §30, §98): React only *consumes* the
 * engine, it never becomes the timing source.
 */

export interface UseTimelineEngineOptions {
  tickIntervalMs: number;
  maxLateMs: number;
  /** Applied once when the engine is created; survives WIPE (spec §34). */
  initialSessionOffsetMs?: number;
}

export interface TimelineEngineBinding {
  engine: TimelineEngine;
  backend: BrowserTtsBackend;
  recorder: DebugRecorder;
  snapshot: EngineSnapshot;
  records: DebugCueRecord[];
}

export function useTimelineEngine(options: UseTimelineEngineOptions): TimelineEngineBinding {
  const { tickIntervalMs, maxLateMs, initialSessionOffsetMs = 0 } = options;

  const [clock] = useState(() => new PerformanceClock());
  const [backend] = useState(() => new BrowserTtsBackend({ clock }));
  const [recorder] = useState(() => new DebugRecorder());
  // Latest persisted drift, re-applied whenever the engine is rebuilt.
  const sessionOffsetRef = useRef(initialSessionOffsetMs);
  sessionOffsetRef.current = initialSessionOffsetMs;

  // Tick interval / late tolerance are construction-time settings, so a change
  // rebuilds the engine. Runtime state is intentionally lost with it.
  const engine = useMemo(
    () => new TimelineEngine({ audio: backend, clock, tickIntervalMs, maxLateMs }),
    [backend, clock, tickIntervalMs, maxLateMs],
  );

  useEffect(() => {
    engine.setSessionOffsetMs(sessionOffsetRef.current);
    backend.setTelemetryListener(recorder.handleAudioTelemetry);
    const removeEngineListener = engine.addEventListener(recorder.handleEngineEvent);
    return () => {
      removeEngineListener();
      backend.setTelemetryListener(null);
      engine.destroy();
    };
  }, [engine, backend, recorder]);

  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const records = useSyncExternalStore(
    recorder.subscribe,
    recorder.getSnapshot,
    recorder.getSnapshot,
  );

  return { engine, backend, recorder, snapshot, records };
}
