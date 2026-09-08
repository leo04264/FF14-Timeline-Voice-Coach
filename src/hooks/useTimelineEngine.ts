import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { audioOwnership, type AudioOwnershipManager } from '../audio/AudioOwnership';
import { BrowserTtsBackend } from '../audio/BrowserTtsBackend';
import { OwnedAudioBackend } from '../audio/OwnedAudioBackend';
import { DebugRecorder } from '../debug/DebugRecorder';
import type { DebugCueRecord } from '../debug/types';
import { PerformanceClock } from '../engine/Clock';
import { TimelineEngine, type EngineSnapshot } from '../engine/TimelineEngine';

/**
 * React binding for the engine (spec §30, §98): React only *consumes* the
 * engine, it never becomes the timing source.
 *
 * The engine speaks through an ownership gate, so an idle `load()` on this
 * screen cannot cancel an editor preview (spec §7.3).
 */

export interface UseTimelineEngineOptions {
  tickIntervalMs: number;
  maxLateMs: number;
  /** Applied once when the engine is created; survives WIPE (spec §34). */
  initialSessionOffsetMs?: number;
  /** Injectable for tests. */
  ownership?: AudioOwnershipManager;
}

export interface TimelineEngineBinding {
  engine: TimelineEngine;
  /** Raw TTS backend, for the voice-list / settings preview path. */
  backend: BrowserTtsBackend;
  /** Ownership-gated backend the engine actually uses. */
  ownedBackend: OwnedAudioBackend;
  ownership: AudioOwnershipManager;
  recorder: DebugRecorder;
  snapshot: EngineSnapshot;
  records: DebugCueRecord[];
  /** Whichever side currently holds the synthesiser, for disabling buttons. */
  audioOwner: ReturnType<AudioOwnershipManager['getSnapshot']>;
}

export function useTimelineEngine(options: UseTimelineEngineOptions): TimelineEngineBinding {
  const {
    tickIntervalMs,
    maxLateMs,
    initialSessionOffsetMs = 0,
    ownership = audioOwnership,
  } = options;

  const [clock] = useState(() => new PerformanceClock());
  const [backend] = useState(() => new BrowserTtsBackend({ clock }));
  const ownedBackend = useMemo(
    () => new OwnedAudioBackend(backend, ownership),
    [backend, ownership],
  );
  const [recorder] = useState(() => new DebugRecorder());
  // Latest persisted drift, re-applied whenever the engine is rebuilt.
  const sessionOffsetRef = useRef(initialSessionOffsetMs);
  sessionOffsetRef.current = initialSessionOffsetMs;

  // Tick interval / late tolerance are construction-time settings, so a change
  // rebuilds the engine. Runtime state is intentionally lost with it.
  const engine = useMemo(
    () => new TimelineEngine({ audio: ownedBackend, clock, tickIntervalMs, maxLateMs }),
    [ownedBackend, clock, tickIntervalMs, maxLateMs],
  );

  useEffect(() => {
    engine.setSessionOffsetMs(sessionOffsetRef.current);
    backend.setTelemetryListener(recorder.handleAudioTelemetry);
    const removeEngineListener = engine.addEventListener(recorder.handleEngineEvent);
    return () => {
      removeEngineListener();
      backend.setTelemetryListener(null);
      engine.destroy();
      // Never leave the device held by a screen that is going away.
      ownedBackend.releasePlayback();
    };
  }, [engine, backend, recorder, ownedBackend]);

  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const records = useSyncExternalStore(
    recorder.subscribe,
    recorder.getSnapshot,
    recorder.getSnapshot,
  );
  const audioOwner = useSyncExternalStore(
    ownership.subscribe,
    ownership.getSnapshot,
    ownership.getSnapshot,
  );

  // The pull is over: hand the synthesiser back so previews become possible.
  useEffect(() => {
    if (snapshot.state === 'idle' || snapshot.state === 'completed') {
      ownedBackend.releasePlayback();
    }
  }, [snapshot.state, ownedBackend]);

  return {
    engine,
    backend,
    ownedBackend,
    ownership,
    recorder,
    snapshot,
    records,
    audioOwner,
  };
}
