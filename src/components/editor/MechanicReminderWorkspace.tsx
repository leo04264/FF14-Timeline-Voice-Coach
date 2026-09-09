import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { audioOwnership } from '../../audio/AudioOwnership';
import { BrowserTtsBackend, isSpeechSynthesisSupported } from '../../audio/BrowserTtsBackend';
import { PreviewController } from '../../preview/PreviewController';
import {
  addQuickReminder,
  ensurePersonalTrack,
  findPersonalTrack,
  personalTrackName,
  reminderOffsetMs,
  setTrackEnabledByDefault,
  type QuickReminderDraft,
} from '../../timeline/personalReminders';
import {
  convertEventToFixedTime,
  describeEventDependents,
  forkTimeline,
  linkEventToMechanic,
  removeEventSafely,
  updateCue,
  type DeleteDependentsStrategy,
  type DependentSummary,
} from '../../timeline/edits';
import { buildPlaybackPlan } from '../../timeline/playbackPlan';
import { collectTimingIssues } from '../../timeline/resolveEventTiming';
import type { AppSettings } from '../../storage/settings';
import type { CompiledCue, PlayerProfile, TimelinePackage } from '../../timeline/types';
import { MechanicReminderList, type ReminderRowRef } from './MechanicReminderList';
import { ProfileSelector } from '../player/ProfileSelector';
import { QuickReminderForm } from './QuickReminderForm';
import { DeleteDependentsDialog, LinkToMechanicDialog } from './ReferenceSafetyDialogs';

interface MechanicReminderWorkspaceProps {
  timeline: TimelinePackage;
  profile: PlayerProfile;
  onProfileChange(profile: PlayerProfile): void;
  settings: AppSettings;
  /** Built-in templates are read-only: the first save forks them (spec §5.2.8). */
  readOnly: boolean;
  /** Apply an edit to the editable document (one undo step per call). */
  onChange?(next: TimelinePackage): void;
  /** Persist a forked copy and switch to it. */
  onFork?(next: TimelinePackage): Promise<void> | void;
  onNavigateAdvanced(trackId: string, eventId: string, cueId?: string): void;
}

type Dialog =
  | { kind: 'quick-add'; sourceTrackId: string; sourceEventId: string }
  | { kind: 'delete'; ref: ReminderRowRef; what: string; dependents: DependentSummary[] }
  | { kind: 'link'; trackId: string; eventId: string };

/**
 * The P1 workspace: mechanic list, quick add, reference-safe delete, explicit
 * linking, and preview — all sharing one plan and one audio owner.
 */
export function MechanicReminderWorkspace({
  timeline,
  profile,
  onProfileChange,
  settings,
  readOnly,
  onChange,
  onFork,
  onNavigateAdvanced,
}: MechanicReminderWorkspaceProps) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** True while the running preview includes an unsaved draft (spec §7.2.4). */
  const [previewIncludesDraft, setPreviewIncludesDraft] = useState(false);

  // Preview owns its own backend instance, but ownership of the shared
  // synthesiser is arbitrated by the app-level manager (spec §7.3).
  const [backend] = useState(() => new BrowserTtsBackend());
  const preview = useMemo(
    () => new PreviewController({ audio: backend, ownership: audioOwnership }),
    [backend],
  );
  useEffect(() => () => preview.dispose(), [preview]);

  const previewSnapshot = useSyncExternalStore(preview.subscribe, preview.getSnapshot, preview.getSnapshot);
  const audioOwner = useSyncExternalStore(
    audioOwnership.subscribe,
    audioOwnership.getSnapshot,
    audioOwnership.getSnapshot,
  );

  const audioBusyReason = useMemo(() => {
    if (!isSpeechSynthesisSupported()) return '這個瀏覽器不支援 Web Speech API，無法試聽。';
    if (audioOwner === 'playback') return '正式播放進行中，請先重置或等這一場結束，才能在編輯器試聽。';
    return null;
  }, [audioOwner]);

  /** The run this editor session would produce, used for previews. */
  const planFor = useCallback(
    (document: TimelinePackage) =>
      buildPlaybackPlan({
        timeline: document,
        profile,
        enabledTrackIds: document.tracks
          .filter((track) => track.enabledByDefault)
          .map((track) => track.id),
        countdownMs: document.encounter.countdownMs,
        audio: settings.audio,
        collisionWindowMs: settings.collisionWindowMs,
        maxLateMs: settings.maxLateMs,
        // Preview uses editing-timeline coordinates; no session/pull offset.
        sessionOffsetMs: 0,
        speechSupported: true,
      }),
    [profile, settings.audio, settings.collisionWindowMs, settings.maxLateMs],
  );

  const personalTrack = findPersonalTrack(timeline, profile);
  const destinationName = personalTrack?.name ?? personalTrackName(profile);
  const destinationEnabled = personalTrack?.enabledByDefault ?? true;

  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  // ---------------------------------------------------------------- previews

  const runSegmentPreview = useCallback(
    (document: TimelinePackage, centerMs: number, includesDraft = false) => {
      setPreviewIncludesDraft(includesDraft);
      const issues = collectTimingIssues(document);
      if (issues.length > 0) {
        setNotice(`預覽已停止：有 ${issues.length} 個連動失效的事件需要先修好。`);
        return;
      }
      const plan = planFor(document);
      const structural = plan.errors.filter(
        (issue) => issue.code === 'timeline.blocking-error' || issue.code.startsWith('timing.'),
      );
      if (structural.length > 0) {
        setNotice(`預覽已停止：${structural[0].message}`);
        return;
      }
      // Density warnings do NOT gate a preview — the preview is how you check
      // them (spec §7.2.8).
      const result = preview.start({
        cues: plan.cues,
        centerMs,
        minMs: -document.encounter.countdownMs,
        maxMs: document.encounter.durationMs,
      });
      setNotice(result.ok ? null : result.error);
    },
    [planFor, preview],
  );

  const runCuePreview = useCallback(
    (cue: CompiledCue) => {
      const result = preview.previewSingleCue(cue);
      setNotice(result.ok ? null : result.error);
    },
    [preview],
  );

  const findCompiledCue = useCallback(
    (document: TimelinePackage, cueId: string): CompiledCue | undefined => {
      const plan = planFor(document);
      return plan.cues.find((cue) => cue.id === cueId);
    },
    [planFor],
  );

  // ------------------------------------------------------------- quick add

  /**
   * Save a draft.
   *
   * On a read-only built-in this forks first and re-points the reminder at the
   * *fork's* copy of the mechanic, using the id map from `forkTimeline`.
   */
  const saveDraft = useCallback(
    async (draft: QuickReminderDraft, alsoEnableTrack: boolean) => {
      setSaveError(null);
      const base = timelineRef.current;

      let document = base;
      let effectiveDraft = draft;
      let forked = false;

      if (readOnly) {
        const fork = forkTimeline(base, { name: `${base.meta.name}（複本）` });
        document = fork.timeline;
        forked = true;
        const mappedTrack = fork.trackIdMap.get(draft.sourceTrackId);
        const mappedEvent = fork.eventIdMap.get(draft.sourceEventId);
        if (!mappedTrack || !mappedEvent) {
          setSaveError('建立複本時找不到對應的王機制，沒有儲存任何東西。');
          return;
        }
        effectiveDraft = { ...draft, sourceTrackId: mappedTrack, sourceEventId: mappedEvent };
      }

      const result = addQuickReminder(document, profile, effectiveDraft);
      if (!result.ok) {
        setSaveError(result.errors.map((issue) => issue.message).join('；'));
        return;
      }

      let next = result.timeline;
      if (alsoEnableTrack && result.trackId && result.trackEnabledByDefault === false) {
        next = setTrackEnabledByDefault(next, result.trackId, true);
      }

      try {
        if (forked) {
          await onFork?.(next);
        } else {
          onChange?.(next);
        }
      } catch (error) {
        // Keep the form open with the draft intact (spec §5.2.10).
        setSaveError(error instanceof Error ? error.message : '儲存失敗');
        return;
      }

      setDialog(null);
      setNotice(
        forked
          ? '已建立本機複本並加入「我的自訂提醒」。'
          : result.trackEnabledByDefault === false && !alsoEnableTrack
            ? '已加入我的自訂提醒，但這條軌道目前是關閉的，儲存不代表會播。'
            : '已加入我的自訂提醒。',
      );
    },
    [onChange, onFork, profile, readOnly],
  );

  /** Build the in-memory document that includes an unsaved draft. */
  const withDraft = useCallback(
    (draft: QuickReminderDraft): TimelinePackage | null => {
      const ensured = ensurePersonalTrack(timelineRef.current, profile);
      const result = addQuickReminder(ensured.timeline, profile, draft);
      if (!result.ok) return null;
      // A disabled personal track would filter the draft out of the plan, so
      // the preview copy switches it on. This never touches real preferences.
      return result.trackId
        ? setTrackEnabledByDefault(result.timeline, result.trackId, true)
        : result.timeline;
    },
    [profile],
  );

  // ----------------------------------------------------------------- edits

  const editReminder = useCallback(
    (ref: ReminderRowRef, patch: { text?: string; offsetMs?: number; enabled?: boolean }) => {
      if (readOnly) {
        setNotice('內建範本是唯讀的：先用「＋我的提醒」建立本機複本再編輯。');
        return;
      }
      // One call, one undo step — not one per keystroke (spec §6.1.9).
      onChange?.(
        updateCue(timelineRef.current, ref.trackId, ref.eventId, ref.cueId, (cue) => ({
          ...cue,
          ...(patch.text === undefined ? {} : { text: patch.text }),
          ...(patch.offsetMs === undefined ? {} : { offsetMs: patch.offsetMs }),
          ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
        })),
      );
    },
    [onChange, readOnly],
  );

  const requestDelete = useCallback(
    (ref: ReminderRowRef) => {
      if (readOnly) {
        setNotice('內建範本是唯讀的，不能刪除內容。');
        return;
      }
      const document = timelineRef.current;
      const event = document.tracks
        .find((track) => track.id === ref.trackId)
        ?.events.find((candidate) => candidate.id === ref.eventId);
      const dependents = describeEventDependents(document, ref.eventId);
      if (dependents.length > 0) {
        setDialog({
          kind: 'delete',
          ref,
          what: event?.name || '這個提醒',
          dependents,
        });
        return;
      }
      const result = removeEventSafely(document, ref.trackId, ref.eventId, 'delete-dependents');
      if (result.ok) onChange?.(result.timeline);
    },
    [onChange, readOnly],
  );

  const confirmDelete = useCallback(
    (strategy: Exclude<DeleteDependentsStrategy, 'cancel'>) => {
      if (dialog?.kind !== 'delete') return;
      const result = removeEventSafely(
        timelineRef.current,
        dialog.ref.trackId,
        dialog.ref.eventId,
        strategy,
      );
      if (result.ok) onChange?.(result.timeline);
      setDialog(null);
    },
    [dialog, onChange],
  );

  return (
    <div className="col">
      <div className="row">
        <h3 style={{ margin: 0 }}>我的身分</h3>
        <span className="small muted">
          切換身分只會改變畫面上顯示與新提醒的對象，不會修改任何已存提醒的 target。
        </span>
      </div>
      <ProfileSelector profile={profile} onChange={onProfileChange} />

      {notice ? (
        <div className="panel row">
          <span className="small">{notice}</span>
          <span className="spacer" />
          <button type="button" className="ghost small" onClick={() => setNotice(null)}>
            關閉
          </button>
        </div>
      ) : null}

      {previewSnapshot.state === 'playing' || previewSnapshot.state === 'draining' ? (
        <div className="panel row">
          <span className="badge">片段預覽</span>
          <span className="small mono">
            {previewSnapshot.window
              ? `${(previewSnapshot.window.startMs / 1000).toFixed(1)}s – ${(
                  previewSnapshot.window.endMs / 1000
                ).toFixed(1)}s`
              : '單句'}
          </span>
          <span className="small muted">
            預覽使用編輯時間軸座標，不套用本場校時；已播 {previewSnapshot.firedCueIds.length} 句
          </span>
          {previewIncludesDraft ? (
            <span className="badge warn">暫時包含此草稿，尚未啟用正式播放</span>
          ) : null}
          <span className="spacer" />
          <button type="button" className="wipe-button small" onClick={() => preview.stop(null)}>
            停止預覽
          </button>
        </div>
      ) : null}

      {previewSnapshot.error ? (
        <p className="small text-warn">{previewSnapshot.error}</p>
      ) : null}

      <MechanicReminderList
        timeline={timeline}
        profile={profile}
        audioBusyReason={audioBusyReason}
        onAddReminder={(sourceTrackId, sourceEventId) =>
          setDialog({ kind: 'quick-add', sourceTrackId, sourceEventId })
        }
        onEditReminder={editReminder}
        onDeleteReminder={requestDelete}
        onPreviewCue={(ref) => {
          const cue = findCompiledCue(timelineRef.current, ref.cueId);
          if (!cue) {
            setNotice('這句在目前身分／軌道選擇下不會播放，無法試聽。');
            return;
          }
          runCuePreview(cue);
        }}
        onPreviewSegment={(triggerMs) => runSegmentPreview(timelineRef.current, triggerMs)}
        onNavigateAdvanced={onNavigateAdvanced}
        onLinkToMechanic={(trackId, eventId) => setDialog({ kind: 'link', trackId, eventId })}
      />

      {dialog?.kind === 'quick-add'
        ? (() => {
            const sourceTrack = timeline.tracks.find((track) => track.id === dialog.sourceTrackId);
            const sourceEvent = sourceTrack?.events.find(
              (event) => event.id === dialog.sourceEventId,
            );
            if (!sourceTrack || !sourceEvent) return null;
            return (
              <div className="panel">
                <QuickReminderForm
                  timeline={timeline}
                  profile={profile}
                  sourceTrackId={sourceTrack.id}
                  sourceEvent={sourceEvent}
                  destinationName={destinationName}
                  destinationEnabled={destinationEnabled}
                  audioBusyReason={audioBusyReason}
                  saveError={saveError}
                  onSave={(draft, alsoEnable) => void saveDraft(draft, alsoEnable)}
                  onPreviewCue={(draft) => {
                    // Draft lives in a memory copy; nothing is written to storage
                    // just to audition it (spec §7.2.3).
                    const document = withDraft(draft);
                    if (!document) {
                      setNotice('這句還不能試聽：請先修好上面標示的問題。');
                      return;
                    }
                    const plan = planFor(document);
                    const sourceAtMs = plan.cues.find(
                      (cue) => cue.text === draft.text.trim(),
                    );
                    if (!sourceAtMs) {
                      setNotice('找不到草稿對應的提示，無法試聽。');
                      return;
                    }
                    setPreviewIncludesDraft(true);
                    runCuePreview(sourceAtMs);
                  }}
                  onPreviewSegment={(draft) => {
                    const document = withDraft(draft);
                    if (!document) {
                      setNotice('這段還不能試播：請先修好上面標示的問題。');
                      return;
                    }
                    const sourceEventAt = timeline.tracks
                      .find((track) => track.id === draft.sourceTrackId)
                      ?.events.find((event) => event.id === draft.sourceEventId);
                    const base =
                      sourceEventAt && sourceEventAt.timing.kind === 'absolute'
                        ? sourceEventAt.timing.atMs
                        : 0;
                    runSegmentPreview(
                      document,
                      base + reminderOffsetMs(draft.when, draft.when === 'at' ? 0 : draft.seconds),
                      true,
                    );
                  }}
                  onCancel={() => {
                    // Cancelling leaves nothing behind: no empty track, no
                    // half-written event (spec §5.2.9).
                    setSaveError(null);
                    setDialog(null);
                  }}
                  onOpenAdvanced={() => {
                    setDialog(null);
                    onNavigateAdvanced(dialog.sourceTrackId, dialog.sourceEventId);
                  }}
                />
                {destinationEnabled ? null : (
                  <p className="small text-warn">
                    「{destinationName}」目前是關閉的：儲存不代表這句會播。
                  </p>
                )}
              </div>
            );
          })()
        : null}

      {dialog?.kind === 'delete' ? (
        <DeleteDependentsDialog
          what={dialog.what}
          dependents={dialog.dependents}
          onCancel={() => setDialog(null)}
          onConfirm={confirmDelete}
        />
      ) : null}

      {dialog?.kind === 'link' ? (
        <LinkToMechanicDialog
          timeline={timeline}
          trackId={dialog.trackId}
          eventId={dialog.eventId}
          onCancel={() => setDialog(null)}
          onConfirm={(sourceTrackId, sourceEventId) => {
            const result = linkEventToMechanic(
              timelineRef.current,
              dialog.trackId,
              dialog.eventId,
              sourceTrackId,
              sourceEventId,
              { preserveTriggerMs: true },
            );
            if (result.ok) onChange?.(result.timeline);
            else setNotice(result.error);
            setDialog(null);
          }}
        />
      ) : null}

      <details className="panel">
        <summary className="small">把某個連動提醒改回固定時間</summary>
        <p className="small muted">
          連動提醒的時間由來源機制決定。要讓它不再跟著移動，請在進階編輯的事件細節按「轉成固定時間」，
          實際觸發時刻會保持不變。
        </p>
        <button
          type="button"
          className="ghost small"
          disabled={readOnly}
          onClick={() => {
            // Convenience: unlink everything the current profile owns.
            const personal = findPersonalTrack(timelineRef.current, profile);
            if (!personal) {
              setNotice('目前身分還沒有自訂提醒軌道。');
              return;
            }
            let next = timelineRef.current;
            for (const event of personal.events) {
              if (event.timing.kind !== 'mechanic') continue;
              const result = convertEventToFixedTime(next, personal.id, event.id);
              if (result.ok) next = result.timeline;
            }
            onChange?.(next);
            setNotice('已把我的自訂提醒全部改成固定時間，觸發時刻不變。');
          }}
        >
          全部改成固定時間
        </button>
      </details>
    </div>
  );
}
