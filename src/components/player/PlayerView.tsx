import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLibrary } from '../../app/LibraryContext';
import { useSettings } from '../../app/SettingsContext';
import { DebugPanel } from '../debug/DebugPanel';
import { useShortcuts } from '../../hooks/useShortcuts';
import { useTimelineEngine } from '../../hooks/useTimelineEngine';
import { loadPlayerPrefs, savePlayerPrefs } from '../../storage/settings';
import { compileTimeline, TimelineCompileError } from '../../timeline/compiler';
import { formatMs, formatSecondsSigned, formatTimer } from '../../timeline/time';
import type { CompiledTimeline, PlayerProfile, TimelinePackage } from '../../timeline/types';
import { CountdownSelector } from './CountdownSelector';
import { CueDisplay } from './CueDisplay';
import { OffsetControls } from './OffsetControls';
import { ProfileSelector } from './ProfileSelector';
import { ReadySummary } from './ReadySummary';
import { TrackSelector } from './TrackSelector';

export type PlayerMode = 'live' | 'practice';

interface PlayerViewProps {
  mode: PlayerMode;
}

/**
 * Player / Practice screen (spec §37–§46).
 * Practice mode is the only place Pause is offered (spec §40).
 */
export function PlayerView({ mode }: PlayerViewProps) {
  const { timelineId } = useParams();
  const navigate = useNavigate();
  const { entries, loading } = useLibrary();
  const { settings, update: updateSettings } = useSettings();

  const entry = useMemo(
    () => entries.find((candidate) => candidate.id === timelineId),
    [entries, timelineId],
  );
  const timeline: TimelinePackage | null =
    entry && entry.status === 'valid' ? entry.timeline : null;

  const [profile, setProfile] = useState<PlayerProfile>({
    position: settings.lastPosition,
    job: settings.lastJob,
  });
  const [enabledTrackIds, setEnabledTrackIds] = useState<string[]>([]);
  const [countdownMs, setCountdownMs] = useState<number>(settings.lastCountdownMs);
  const [showReady, setShowReady] = useState(false);

  const { engine, backend, recorder, snapshot, records } = useTimelineEngine({
    tickIntervalMs: settings.tickIntervalMs,
    maxLateMs: settings.maxLateMs,
    initialSessionOffsetMs: settings.sessionOffsetMs,
  });

  // Restore per-timeline track selection / countdown (spec §17, §43).
  useEffect(() => {
    if (!timeline) return;
    const prefs = loadPlayerPrefs(timeline.id);
    setEnabledTrackIds(
      prefs.enabledTrackIds ??
        timeline.tracks.filter((track) => track.enabledByDefault).map((track) => track.id),
    );
    setCountdownMs(prefs.countdownMs ?? settings.lastCountdownMs ?? timeline.encounter.countdownMs);
    // Deliberately keyed on the timeline only: player edits below persist themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline?.id]);

  const compileResult = useMemo((): { compiled: CompiledTimeline } | { error: string } => {
    if (!timeline) return { error: 'No timeline selected' };
    try {
      return {
        compiled: compileTimeline(timeline, {
          profile,
          enabledTrackIds,
          countdownMs,
          audioDefaults: settings.audio,
        }),
      };
    } catch (error) {
      if (error instanceof TimelineCompileError) {
        return {
          error: `Timeline has ${error.report.errors.length} blocking validation error(s): ${error.report.errors
            .slice(0, 3)
            .map((issue) => issue.message)
            .join('; ')}`,
        };
      }
      return { error: error instanceof Error ? error.message : 'Failed to compile timeline' };
    }
  }, [timeline, profile, enabledTrackIds, countdownMs, settings.audio]);

  const compiled = 'compiled' in compileResult ? compileResult.compiled : null;
  const compileError = 'error' in compileResult ? compileResult.error : null;

  const isIdle = snapshot.state === 'idle' || snapshot.state === 'completed';

  // Keep the engine in sync while idle; never swap the timeline mid-pull.
  useEffect(() => {
    if (!compiled) return;
    if (!isIdle) return;
    engine.load(compiled);
  }, [engine, compiled, isIdle]);

  const persistPrefs = useCallback(
    (patch: { enabledTrackIds?: string[]; countdownMs?: number }) => {
      if (!timeline) return;
      const prefs = loadPlayerPrefs(timeline.id);
      savePlayerPrefs(timeline.id, { ...prefs, ...patch });
    },
    [timeline],
  );

  const beginPull = useCallback(() => {
    if (!compiled) return;
    engine.load(compiled);
    engine.start();
  }, [engine, compiled]);

  const handleStart = useCallback(() => {
    if (!compiled) return;
    if (settings.quickStart) {
      beginPull();
      return;
    }
    setShowReady(true);
  }, [compiled, settings.quickStart, beginPull]);

  const handleWipe = useCallback(() => {
    setShowReady(false);
    engine.wipe();
  }, [engine]);

  useShortcuts({
    enabled: Boolean(compiled) && !showReady,
    escWipe: settings.escWipe,
    handlers: {
      onStartOrRestart: () => {
        if (snapshot.state === 'idle' || snapshot.state === 'completed') handleStart();
        else beginPull();
      },
      onWipe: handleWipe,
      onNudge: (delta) => engine.adjustPullOffsetMs(delta),
    },
  });

  const setSessionOffset = useCallback(
    (ms: number) => {
      engine.setSessionOffsetMs(ms);
      updateSettings({ sessionOffsetMs: ms });
    },
    [engine, updateSettings],
  );

  if (loading) return <p className="muted">Loading library…</p>;

  if (!timelineId || !entry) {
    const selectable = entries.filter((candidate) => candidate.status === 'valid');
    return (
      <section className="panel">
        <h1>{mode === 'practice' ? 'Practice' : 'Player'}</h1>
        <p className="muted">Pick a timeline to run.</p>
        <div className="col">
          {selectable.length === 0 ? (
            <p className="muted">
              No timelines available. Create one in the Editor or import JSON from the Library.
            </p>
          ) : null}
          {selectable.map((candidate) => (
            <div className="row" key={candidate.id}>
              <button
                type="button"
                className="primary"
                onClick={() => navigate(`/${mode === 'practice' ? 'practice' : 'player'}/${candidate.id}`)}
              >
                Open
              </button>
              <span>{candidate.status === 'valid' ? candidate.timeline.meta.name : candidate.id}</span>
              <span className="badge">{candidate.source}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!timeline) {
    return (
      <section className="panel">
        <h1>Timeline unavailable</h1>
        <p className="text-error">
          This timeline failed validation and cannot be played (spec §79). Open it in the Library to
          export the raw data or delete it.
        </p>
      </section>
    );
  }

  const running = snapshot.state === 'running' || snapshot.state === 'countdown';
  const paused = snapshot.state === 'paused';

  return (
    <section className="col">
      <div className="page-header">
        <div>
          <h1>
            {timeline.meta.name}{' '}
            {mode === 'practice' ? <span className="badge">Practice</span> : null}
          </h1>
          <p className="muted small">
            {timeline.meta.encounterId}
            {timeline.meta.strategy ? ` · ${timeline.meta.strategy}` : ''}
            {timeline.meta.version ? ` · v${timeline.meta.version}` : ''} · Pull {snapshot.pullId}
          </p>
        </div>
        <div className="row">
          <button type="button" onClick={() => navigate(`/editor/${timeline.id}`)}>
            Edit
          </button>
          <button type="button" onClick={() => navigate('/library')}>
            Library
          </button>
        </div>
      </div>

      {compileError ? (
        <div className="panel">
          <p className="text-error">{compileError}</p>
        </div>
      ) : null}

      <div className="panel">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="col" style={{ minWidth: 240 }}>
            <div className="player-state">{snapshot.state}</div>
            <div className="player-timer mono" data-testid="timer">
              {formatTimer(snapshot.timelineElapsedMs)}
            </div>
            <div className="small muted mono">
              duration {formatMs(snapshot.durationMs, { millis: false })} · cue{' '}
              {snapshot.firedCount}/{snapshot.totalCues}
              {snapshot.skippedCount > 0 ? ` · skipped ${snapshot.skippedCount}` : ''}
            </div>
            <div className="small muted mono">
              effective offset {formatSecondsSigned(snapshot.effectiveOffsetMs)}
            </div>
          </div>

          <div className="col" style={{ flex: 1, minWidth: 320 }}>
            <CueDisplay
              currentCue={snapshot.currentCue}
              currentCueAtMs={snapshot.currentCueAtMs}
              nextCues={snapshot.nextCues}
            />
          </div>
        </div>

        <div className="row" style={{ marginTop: '1rem' }}>
          <button
            type="button"
            className="primary huge"
            disabled={!compiled}
            onClick={running || paused ? beginPull : handleStart}
          >
            {running || paused ? 'RESTART' : 'START'}
          </button>
          <button type="button" className="wipe-button" onClick={handleWipe}>
            WIPE
          </button>
          {mode === 'practice' ? (
            <button
              type="button"
              className="big"
              onClick={() => (paused ? engine.resume() : engine.pause())}
              disabled={!running && !paused}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
          ) : null}
          <span className="spacer" />
          <span className="small muted">Space start/restart · Esc wipe · ←/→ ±0.5s</span>
        </div>
      </div>

      <div className="panel">
        <h2>Offset</h2>
        <OffsetControls
          sessionOffsetMs={snapshot.sessionOffsetMs}
          pullOffsetMs={snapshot.pullOffsetMs}
          onNudgePull={(delta) => engine.adjustPullOffsetMs(delta)}
          onSetSession={setSessionOffset}
          onPromotePullToSession={() => {
            setSessionOffset(snapshot.sessionOffsetMs + snapshot.pullOffsetMs);
            engine.setPullOffsetMs(0);
          }}
        />
      </div>

      <details className="panel" open={isIdle}>
        <summary>Setup</summary>
        <div className="col" style={{ marginTop: '0.75rem' }}>
          <h3>Position / Job</h3>
          <ProfileSelector
            profile={profile}
            disabled={running}
            onChange={(next) => {
              setProfile(next);
              updateSettings({ lastPosition: next.position, lastJob: next.job });
            }}
          />

          <h3>Tracks</h3>
          <TrackSelector
            tracks={timeline.tracks}
            enabledTrackIds={enabledTrackIds}
            disabled={running}
            onChange={(ids) => {
              setEnabledTrackIds(ids);
              persistPrefs({ enabledTrackIds: ids });
            }}
          />

          <h3>Countdown</h3>
          <CountdownSelector
            countdownMs={countdownMs}
            timelineDefaultMs={timeline.encounter.countdownMs}
            disabled={running}
            onChange={(ms) => {
              setCountdownMs(ms);
              persistPrefs({ countdownMs: ms });
              updateSettings({ lastCountdownMs: ms });
            }}
          />
          <p className="small muted">
            The countdown is shown only — no automatic 5/4/3/2/1 voice. Add negative-time cues to
            the timeline if you want spoken countdown lines (spec §18).
          </p>

          <div className="row">
            <button
              type="button"
              onClick={() => void backend.prepare(compiled ? compiled.cues : [])}
              title="Warm up the speech engine (Chrome needs one user gesture)"
            >
              Test audio
            </button>
            <button
              type="button"
              onClick={() =>
                backend.speakPreview('語音測試', {
                  lang: settings.audio.lang,
                  rate: settings.audio.rate,
                  pitch: settings.audio.pitch,
                  volume: settings.audio.volume,
                  voiceUri: settings.audio.voiceUri,
                })
              }
            >
              Speak sample
            </button>
          </div>
        </div>
      </details>

      <DebugPanel
        records={records}
        onClear={() => recorder.clear()}
        defaultOpen={mode === 'practice'}
      />

      {showReady && compiled ? (
        <ReadySummary
          timelineName={timeline.meta.name}
          profile={profile}
          tracks={timeline.tracks}
          enabledTrackIds={enabledTrackIds}
          countdownMs={countdownMs}
          effectiveOffsetMs={snapshot.effectiveOffsetMs}
          cueCount={compiled.cues.length}
          onCancel={() => setShowReady(false)}
          onConfirm={() => {
            setShowReady(false);
            beginPull();
          }}
        />
      ) : null}
    </section>
  );
}
