import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLibrary } from '../../app/LibraryContext';
import { useSettings } from '../../app/SettingsContext';
import { isSpeechSynthesisSupported } from '../../audio/BrowserTtsBackend';
import { DebugPanel } from '../debug/DebugPanel';
import { ENGINE_STATE_LABEL } from '../../i18n/labels';
import { usePlaybackStart } from '../../hooks/usePlaybackStart';
import { useShortcuts } from '../../hooks/useShortcuts';
import { useTimelineEngine } from '../../hooks/useTimelineEngine';
import {
  loadPlayerPrefs,
  PrefsWriteError,
  pruneEnabledTrackIds,
  savePlayerPrefs,
  type TimelinePlayerPrefs,
} from '../../storage/settings';
import { buildPlaybackPlan, type PlaybackPlanResult } from '../../timeline/playbackPlan';
import {
  applyOptionSelection,
  selectApplicableTracks,
} from '../../timeline/selectionGroups';
import { formatMs, formatSecondsSigned, formatTimer } from '../../timeline/time';
import type { PlayerProfile, TimelinePackage } from '../../timeline/types';
import { CountdownSelector } from './CountdownSelector';
import { CueDisplay } from './CueDisplay';
import { OffsetControls } from './OffsetControls';
import { PreflightDialog } from './PreflightDialog';
import { ProfileSelector } from './ProfileSelector';
import { SelectionGroupPicker } from './SelectionGroupPicker';
import { TrackSelector } from './TrackSelector';

/**
 * Player screen (spec §37–§46, §4).
 *
 * Everything shown here — applicability, counts, exclusivity, collisions —
 * comes from one `buildPlaybackPlan` call, and every way of starting a pull goes
 * through `usePlaybackStart`.
 */
export function PlayerView() {
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
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [voiceTestStatus, setVoiceTestStatus] = useState<string | null>(null);

  const { engine, backend, ownedBackend, snapshot, records, recorder } = useTimelineEngine({
    tickIntervalMs: settings.tickIntervalMs,
    maxLateMs: settings.maxLateMs,
    initialSessionOffsetMs: settings.sessionOffsetMs,
  });

  const speechSupported = useMemo(() => isSpeechSynthesisSupported(), []);
  const isIdle = snapshot.state === 'idle';

  // Restore per-timeline *and per-identity* selection (spec §4.2). Switching job
  // re-reads, so one identity's choice never leaks into another's.
  useEffect(() => {
    if (!timeline) return;
    const prefs = loadPlayerPrefs(timeline.id, profile);
    const existing = timeline.tracks.map((track) => track.id);
    setEnabledTrackIds(
      prefs.enabledTrackIds
        ? // A track that has since been deleted must not keep affecting playback.
          pruneEnabledTrackIds(prefs.enabledTrackIds, existing)
        : timeline.tracks.filter((track) => track.enabledByDefault).map((track) => track.id),
    );
    setCountdownMs(prefs.countdownMs ?? settings.lastCountdownMs ?? timeline.encounter.countdownMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline?.id, profile.position, profile.job]);

  const persistPrefs = useCallback(
    (patch: Partial<TimelinePlayerPrefs>) => {
      if (!timeline) return;
      try {
        const prefs = loadPlayerPrefs(timeline.id, profile);
        savePlayerPrefs(timeline.id, profile, { ...prefs, ...patch });
        setPrefsError(null);
      } catch (error) {
        // The in-memory choice stands; only persistence failed (spec §4.2).
        setPrefsError(
          error instanceof PrefsWriteError ? error.message : '儲存軌道選擇失敗，這次的設定只保留在畫面上',
        );
      }
    },
    [timeline, profile],
  );

  const plan: PlaybackPlanResult | null = useMemo(() => {
    if (!timeline) return null;
    return buildPlaybackPlan({
      timeline,
      profile,
      enabledTrackIds,
      countdownMs,
      audio: settings.audio,
      collisionWindowMs: settings.collisionWindowMs,
      maxLateMs: settings.maxLateMs,
      // A new pull resets the per-pull nudge, so only the session offset applies.
      sessionOffsetMs: snapshot.sessionOffsetMs,
      speechSupported,
    });
  }, [
    timeline,
    profile,
    enabledTrackIds,
    countdownMs,
    settings.audio,
    settings.collisionWindowMs,
    settings.maxLateMs,
    snapshot.sessionOffsetMs,
    speechSupported,
  ]);

  const planRef = useRef(plan);
  planRef.current = plan;

  /**
   * The engine is only loaded once a plan can actually start, so a blocked run
   * left the readout showing 全長 00:00 · 提示 0/0 and 「沒有後續提示了」 —
   * which reads as "this timeline is empty" rather than "fix the countdown".
   * Fall back to the plan, which is the same single source of truth the engine
   * would have been handed.
   */
  const readout = useMemo(() => {
    if (snapshot.totalCues > 0 || !plan || plan.cues.length === 0 || !timeline) {
      return {
        durationMs: snapshot.durationMs,
        totalCues: snapshot.totalCues,
        nextCues: snapshot.nextCues,
      };
    }
    return {
      durationMs: timeline.encounter.durationMs,
      totalCues: plan.cues.length,
      nextCues: plan.cues.slice(0, 3),
    };
  }, [snapshot.totalCues, snapshot.durationMs, snapshot.nextCues, plan, timeline]);

  const start = usePlaybackStart({
    engine,
    ownedBackend,
    engineState: snapshot.state,
    quickStart: settings.quickStart,
    getPlan: () => planRef.current,
  });

  // Keep the engine loaded while idle so the readouts match; the ownership gate
  // makes this harmless for a running editor preview (spec §7.3).
  useEffect(() => {
    if (!plan?.compiledTimeline) return;
    if (!isIdle) return;
    engine.load(plan.compiledTimeline);
  }, [engine, plan?.compiledTimeline, isIdle]);

  const handleWipe = useCallback(() => {
    // A wipe invalidates any pending start request (spec §4.6.8).
    start.invalidate();
    engine.wipe();
    ownedBackend.releasePlayback();
  }, [engine, ownedBackend, start]);

  // Leaving the screen must also invalidate, so nothing starts asynchronously
  // after the player is gone.
  useEffect(() => () => start.invalidate(), [start.invalidate]);

  const handleVoiceTest = useCallback(async () => {
    setVoiceTestStatus('正在準備語音…');
    if (!speechSupported) {
      setVoiceTestStatus('這個瀏覽器不支援 Web Speech API，無法播放語音。');
      return;
    }
    if (!isIdle) {
      setVoiceTestStatus('正式播放進行中，請先重置再測試語音。');
      return;
    }
    try {
      const queued = backend.speakPreview('語音測試，三秒後開始', {
        lang: settings.audio.lang,
        rate: settings.audio.rate,
        pitch: settings.audio.pitch,
        volume: settings.audio.volume,
        voiceUri: settings.audio.voiceUri,
      });
      setVoiceTestStatus(
        queued
          ? '已送出測試語音；「送出」不代表你一定聽到了，若沒有聲音請到「設定」確認語音與音量。'
          : '這個瀏覽器不支援 Web Speech API，無法播放語音。',
      );
    } catch (error) {
      setVoiceTestStatus(`測試語音失敗：${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }, [backend, isIdle, settings.audio, speechSupported]);

  useShortcuts({
    // Shortcuts stay off while a modal owns the screen (spec §4.6.4).
    enabled: Boolean(timeline) && !start.modalOpen,
    escWipe: settings.escWipe,
    handlers: {
      onTogglePlayback: start.togglePlayback,
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

  if (loading) return <p className="muted">時間軸庫載入中…</p>;

  if (!timelineId || !entry) {
    const selectable = entries.filter((candidate) => candidate.status === 'valid');
    return (
      <section className="panel">
        <h1>播放器</h1>
        <p className="muted">選擇一份要跑的時間軸。</p>
        <div className="col">
          {selectable.length === 0 ? (
            <p className="muted">
              目前沒有可用的時間軸。請到編輯器新增一份，或從時間軸庫匯入 JSON。
            </p>
          ) : null}
          {selectable.map((candidate) => (
            <div className="row timeline-picker-row" key={candidate.id}>
              <button
                type="button"
                className="primary"
                onClick={() => navigate(`/player/${candidate.id}`)}
              >
                開啟
              </button>
              <span>{candidate.status === 'valid' ? candidate.timeline.meta.name : candidate.id}</span>
              <span className="badge">{candidate.source === 'builtin' ? '內建' : '本機'}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!timeline || !plan) {
    return (
      <section className="panel">
        <h1>無法使用這份時間軸</h1>
        <p className="text-error">
          這份時間軸沒有通過驗證，因此不能播放（規格 §79）。請到時間軸庫匯出原始資料，或直接刪除。
        </p>
      </section>
    );
  }

  const running = snapshot.state === 'running' || snapshot.state === 'countdown';
  const paused = snapshot.state === 'paused';
  const blockingErrors = plan.errors;

  return (
    <section className="col">
      <div className="page-header">
        <div>
          <h1>{timeline.meta.name}</h1>
          <p className="muted small">
            {timeline.meta.encounterId}
            {timeline.meta.strategy ? ` · ${timeline.meta.strategy}` : ''}
            {timeline.meta.version ? ` · v${timeline.meta.version}` : ''} · 第 {snapshot.pullId} 場
          </p>
        </div>
        <div className="row page-actions">
          <button type="button" onClick={() => navigate(`/editor/${timeline.id}`)}>
            編輯
          </button>
          <button type="button" onClick={() => navigate('/library')}>
            時間軸庫
          </button>
        </div>
      </div>

      {blockingErrors.length > 0 ? (
        <div className="panel">
          <h2 className="text-error">這一場還不能開始（{blockingErrors.length} 項）</h2>
          <ul className="issue-list text-error">
            {blockingErrors.slice(0, 6).map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                {issue.message}
                {issue.hint ? <div className="small muted">{issue.hint}</div> : null}
              </li>
            ))}
          </ul>
          {blockingErrors.length > 6 ? (
            <p className="small muted">其餘 {blockingErrors.length - 6} 項請展開開場設定或到編輯器檢查。</p>
          ) : null}
        </div>
      ) : null}

      {prefsError ? (
        <div className="panel">
          <p className="text-warn" role="status">{prefsError}</p>
        </div>
      ) : null}

      <div className="panel">
        <div className="player-overview">
          <div className="col player-summary">
            <div className="player-state">{ENGINE_STATE_LABEL[snapshot.state]}</div>
            <div className="player-timer mono" data-testid="timer">
              {formatTimer(snapshot.timelineElapsedMs)}
            </div>
            <div className="small muted mono">
              全長 {formatMs(readout.durationMs, { millis: false })} · 提示 {snapshot.firedCount}/
              {readout.totalCues}
              {snapshot.skippedCount > 0 ? ` · 略過 ${snapshot.skippedCount}` : ''}
            </div>
            <div className="small offset-text mono">
              實際偏移 {formatSecondsSigned(snapshot.effectiveOffsetMs)}
            </div>
          </div>

          <div className="col player-cues">
            <CueDisplay
              currentCue={snapshot.currentCue}
              currentCueAtMs={snapshot.currentCueAtMs}
              nextCues={readout.nextCues}
            />
          </div>
        </div>

        <div className="player-actions">
          <button
            type="button"
            className="primary huge"
            disabled={snapshot.state === 'completed'}
            onClick={start.togglePlayback}
          >
            {running
              ? '暫停'
              : paused
                ? '繼續'
                : snapshot.state === 'completed'
                  ? '請先重置'
                  : '開始'}
          </button>
          <button type="button" className="wipe-button" onClick={handleWipe}>
            重置
          </button>
          <span className="small muted shortcut-hint">
            空白鍵 開始／暫停／繼續 · Esc 重置 · ←/→ 偏移 ±0.5 秒
          </span>
        </div>
      </div>

      <div className="panel">
        <h2>偏移校正</h2>
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
        <summary>開場設定</summary>
        <div className="col" style={{ marginTop: '0.75rem' }}>
          <h3>站位 / 職業</h3>
          <ProfileSelector
            profile={profile}
            disabled={!isIdle}
            onChange={(next) => {
              // Identity is never swapped mid-pull (spec §4.6.10).
              if (!isIdle) return;
              start.invalidate();
              setProfile(next);
              updateSettings({ lastPosition: next.position, lastJob: next.job });
            }}
          />

          {plan.selectionGroups.length > 0 ? (
            <>
              <h3>方案選擇</h3>
              <SelectionGroupPicker
                plan={plan}
                disabled={!isIdle}
                onSelect={(groupId, optionId) => {
                  const next = applyOptionSelection(
                    {
                      timeline,
                      enabledTrackIds,
                      effectiveTrackIds: plan.tracks
                        .filter((row) => row.selected && row.enabledCueCount > 0)
                        .map((row) => row.track.id),
                      applicableTrackIds: plan.tracks
                        .filter((row) => row.applicable)
                        .map((row) => row.track.id),
                    },
                    groupId,
                    optionId,
                  );
                  start.invalidate();
                  setEnabledTrackIds(next);
                  persistPrefs({ enabledTrackIds: next });
                }}
              />
            </>
          ) : null}

          <h3>軌道</h3>
          <TrackSelector
            plan={plan}
            disabled={!isIdle}
            onChange={(ids) => {
              start.invalidate();
              setEnabledTrackIds(ids);
              persistPrefs({ enabledTrackIds: ids });
            }}
            onSelectApplicable={() => {
              const result = selectApplicableTracks({
                timeline,
                enabledTrackIds,
                effectiveTrackIds: plan.tracks
                  .filter((row) => row.selected && row.enabledCueCount > 0)
                  .map((row) => row.track.id),
                applicableTrackIds: plan.tracks
                  .filter((row) => row.applicable)
                  .map((row) => row.track.id),
              });
              start.invalidate();
              setEnabledTrackIds(result.trackIds);
              persistPrefs({ enabledTrackIds: result.trackIds });
            }}
            onSelectDefaults={() => {
              const ids = timeline.tracks
                .filter((track) => track.enabledByDefault)
                .map((track) => track.id);
              start.invalidate();
              setEnabledTrackIds(ids);
              persistPrefs({ enabledTrackIds: ids });
            }}
          />

          <h3>倒數</h3>
          <CountdownSelector
            countdownMs={countdownMs}
            timelineDefaultMs={timeline.encounter.countdownMs}
            minimumMs={plan?.minimumCountdownMs ?? 0}
            disabled={!isIdle}
            onChange={(ms) => {
              start.invalidate();
              setCountdownMs(ms);
              persistPrefs({ countdownMs: ms });
              updateSettings({ lastCountdownMs: ms });
            }}
          />
          <p className="small muted">
            倒數只會顯示在畫面上，不會自動念 5、4、3、2、1。想要語音倒數的話，請在時間軸裡自己加負時間的提示（規格
            §18）。
          </p>

          <div className="row">
            <button
              type="button"
              onClick={() => void handleVoiceTest()}
              disabled={voiceTestStatus === '正在準備語音…'}
            >
              播放測試語音
            </button>
            {voiceTestStatus ? <span className="small" role="status">{voiceTestStatus}</span> : null}
          </div>
          <p className="small muted">
            這只會用目前的語言、語音、語速、音調與音量念一句測試文字，不會開始或改動時間軸。
          </p>
        </div>
      </details>

      <DebugPanel records={records} onClear={() => recorder.clear()} defaultOpen={false} />

      {start.pending ? (
        <PreflightDialog
          stage={start.pending.stage}
          stale={start.pending.stale}
          plan={start.pending.plan}
          timelineName={timeline.meta.name}
          profile={profile}
          countdownMs={countdownMs}
          effectiveOffsetMs={snapshot.effectiveOffsetMs}
          onConfirm={start.confirm}
          onCancel={start.cancel}
          onPreviewSegment={(triggerMs) => {
            start.cancel();
            navigate(`/editor/${timeline.id}?preview=${Math.round(triggerMs)}`);
          }}
          onNavigate={(trackId, eventId, cueId) => {
            start.cancel();
            navigate(
              `/editor/${timeline.id}?track=${trackId}&event=${eventId}${cueId ? `&cue=${cueId}` : ''}`,
            );
          }}
        />
      ) : null}
    </section>
  );
}
