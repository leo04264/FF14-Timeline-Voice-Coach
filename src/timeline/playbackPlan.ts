import {
  analyzeCueRefCollisions,
  type CollisionCueRef,
  type CollisionReport,
} from './collision';
import { compileTimeline, DEFAULT_CUE_PRIORITY, TimelineCompileError } from './compiler';
import { buildMechanicIndex, resolveEventTiming } from './resolveEventTiming';
import { analyzeSelectionGroups, type SelectionGroupState } from './selectionGroups';
import { combineTargets, describeTarget, isEmptyTarget, matchesTarget } from './target';
import { validateTimeline, type ValidationIssue } from './validator';
import {
  JOB_CODES,
  PARTY_POSITIONS,
  type CompiledCue,
  type CompiledTimeline,
  type PlayerProfile,
  type ResolvedAudioConfig,
  type TimelinePackage,
  type TimelineTrack,
  type TrackPurpose,
  type TrackSelectionRef,
} from './types';

/**
 * The one shared playback plan (spec §4.1).
 *
 * Job filtering, time resolution, per-track counting, exclusivity checks and
 * collision analysis all happen here exactly once, so the player summary, the
 * track list, the confirmation dialog and the engine can never disagree about
 * what this run contains.
 *
 * Pure: no React, no storage, no audio.
 */

export type PlanIssueCode =
  | 'profile.invalid-position'
  | 'profile.invalid-job'
  | 'timeline.blocking-error'
  | 'selection.conflict'
  | 'selection.unchosen'
  | 'plan.no-cues'
  | 'plan.cue-before-countdown'
  | 'plan.cue-after-duration'
  | 'plan.invalid-countdown'
  | 'plan.invalid-offset'
  | 'plan.offset-skips-cues'
  | 'audio.unsupported'
  | 'plan.collisions'
  | 'plan.job-track-unrestricted'
  | 'plan.only-shared-cues';

export interface PlanIssue {
  level: 'error' | 'warning';
  code: PlanIssueCode;
  message: string;
  /** Warnings with this flag must be acknowledged, even in Quick Start. */
  requiresConfirmation?: boolean;
  /** Suggested way out, shown next to the message. */
  hint?: string;
  trackId?: string;
  eventId?: string;
  cueId?: string;
}

export type TrackApplicability =
  | { applicable: true; reason: string }
  | { applicable: false; reason: string };

export interface TrackPlan {
  track: TimelineTrack;
  /** Does anything in this track address the current profile at all? */
  applicable: boolean;
  /** Human-readable reason, shown in the "不適用的軌道" list. */
  reason: string;
  selected: boolean;
  /** Cues that match the profile *and* are enabled. */
  enabledCueCount: number;
  /** Cues that match the profile, regardless of the enabled flag. */
  matchingCueCount: number;
  totalCueCount: number;
  /** Target matches but every matching cue is switched off (spec §4.3.5). */
  allMatchingDisabled: boolean;
  /** Set when this track cannot take part in this run. */
  blockedReason?: string;
  selection?: TrackSelectionRef;
  purpose?: TrackPurpose;
  /** This track has at least one unresolvable mechanic reference. */
  hasTimingError: boolean;
}

export interface PlaybackPlanInput {
  timeline: TimelinePackage;
  profile: PlayerProfile;
  enabledTrackIds: readonly string[];
  /** Countdown chosen for *this* run, not necessarily the timeline default. */
  countdownMs: number;
  audio: ResolvedAudioConfig;
  collisionWindowMs: number;
  maxLateMs: number;
  /**
   * Offset that will be in force when this run starts. The engine clears the
   * per-pull nudge on every new pull, so only the session offset carries over.
   */
  sessionOffsetMs: number;
  /** Whether the browser can speak at all. */
  speechSupported: boolean;
}

export interface PlaybackPlanResult {
  /** Present only when the run could be compiled safely. */
  compiledTimeline: CompiledTimeline | null;
  cues: CompiledCue[];
  totalCueCount: number;
  tracks: TrackPlan[];
  selectionGroups: SelectionGroupState[];
  errors: PlanIssue[];
  warnings: PlanIssue[];
  /** Collisions among the cues that will really play this run. */
  actualCollisions: CollisionReport;
  /** Earliest trigger among this run's cues; null when nothing compiled. */
  earliestCueMs: number | null;
  /**
   * Shortest countdown that still covers every cue of this run. 0 when nothing
   * starts before the pull. The player uses this to grey out the countdown
   * presets that cannot work, instead of letting the run be blocked later.
   */
  minimumCountdownMs: number;
  /**
   * Changes whenever anything that shapes this run changes. Used to invalidate a
   * warning acknowledgement — not a security token and never a way to skip
   * checks permanently (spec §4.1).
   */
  fingerprint: string;
  canStart: boolean;
  /** At least one warning needs an explicit "了解風險，仍開始". */
  requiresConfirmation: boolean;
}

/** Stable 32-bit FNV-1a, rendered hex. Enough to detect "something changed". */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
}

export function isValidProfile(profile: PlayerProfile | null | undefined): boolean {
  if (!profile) return false;
  return (
    PARTY_POSITIONS.includes(profile.position) && JOB_CODES.includes(profile.job)
  );
}

/** Per-track applicability and counts, using track target ∩ each cue target. */
function planTrack(
  timeline: TimelinePackage,
  track: TimelineTrack,
  profile: PlayerProfile,
  selected: boolean,
): TrackPlan {
  const index = buildMechanicIndex(timeline);
  let matchingCueCount = 0;
  let enabledCueCount = 0;
  let totalCueCount = 0;
  let hasTimingError = false;

  for (const event of track.events) {
    if (resolveEventTiming(event, track.id, index).issue) hasTimingError = true;
    for (const cue of event.cues) {
      totalCueCount += 1;
      const target = combineTargets(track.target, cue.target);
      if (isEmptyTarget(target)) continue;
      if (!matchesTarget(target, profile)) continue;
      matchingCueCount += 1;
      if (cue.enabled !== false) enabledCueCount += 1;
    }
  }

  const applicable = matchingCueCount > 0;
  const allMatchingDisabled = matchingCueCount > 0 && enabledCueCount === 0;

  let reason: string;
  if (applicable) {
    reason = allMatchingDisabled
      ? '對象相符，但這條軌道裡符合你的提示全部被停用了'
      : `對象相符（${describeTarget(track.target)}）`;
  } else if (totalCueCount === 0) {
    reason = '這條軌道沒有任何提示';
  } else {
    // Never phrase this as "wrong job" when it is really a position mismatch.
    reason = `這條軌道的對象是 ${describeTarget(track.target)}，和目前身分不符`;
  }

  const plan: TrackPlan = {
    track,
    applicable,
    reason,
    selected,
    enabledCueCount,
    matchingCueCount,
    totalCueCount,
    allMatchingDisabled,
    hasTimingError,
  };
  if (track.selection) plan.selection = track.selection;
  if (track.purpose) plan.purpose = track.purpose;
  if (hasTimingError) plan.blockedReason = '這條軌道有連動失效的事件，尚不可播放';
  return plan;
}

export function buildPlaybackPlan(input: PlaybackPlanInput): PlaybackPlanResult {
  const {
    timeline,
    profile,
    enabledTrackIds,
    countdownMs,
    audio,
    collisionWindowMs,
    maxLateMs,
    sessionOffsetMs,
    speechSupported,
  } = input;

  const errors: PlanIssue[] = [];
  const warnings: PlanIssue[] = [];
  const enabled = new Set(enabledTrackIds);

  // ---- 1. profile ---------------------------------------------------------
  // Validated as data, not merely trusted from a TypeScript cast.
  if (!PARTY_POSITIONS.includes(profile?.position)) {
    errors.push({
      level: 'error',
      code: 'profile.invalid-position',
      message: `站位「${String(profile?.position)}」不是合法的站位`,
    });
  }
  if (!JOB_CODES.includes(profile?.job)) {
    errors.push({
      level: 'error',
      code: 'profile.invalid-job',
      message: `職業「${String(profile?.job)}」不是合法的職業代號`,
    });
  }

  // ---- 2. document: schema/domain/reference -------------------------------
  const report = validateTimeline(timeline);
  for (const issue of report.errors) {
    errors.push({
      level: 'error',
      code: 'timeline.blocking-error',
      message: issue.message,
      trackId: issue.trackId,
      eventId: issue.eventId,
      cueId: issue.cueId,
    });
  }

  // ---- 3. per-track applicability and counts ------------------------------
  const tracks = timeline.tracks.map((track) =>
    planTrack(timeline, track, profile, enabled.has(track.id)),
  );

  const applicableTrackIds = tracks.filter((plan) => plan.applicable).map((plan) => plan.track.id);
  const effectiveTrackIds = tracks
    .filter((plan) => plan.selected && plan.enabledCueCount > 0 && !plan.hasTimingError)
    .map((plan) => plan.track.id);

  // ---- 4. selection groups (exclusivity) ----------------------------------
  const selectionGroups = analyzeSelectionGroups({
    timeline,
    enabledTrackIds,
    effectiveTrackIds,
    applicableTrackIds,
  });

  for (const state of selectionGroups) {
    if (state.conflictingOptionIds.length > 1) {
      const names = state.conflictingOptionIds
        .map(
          (id) => state.group.options.find((option) => option.id === id)?.name ?? id,
        )
        .join('、');
      errors.push({
        level: 'error',
        code: 'selection.conflict',
        message: `方案「${state.group.name}」同時啟用了多個互斥選項：${names}`,
        hint: '請在方案選擇裡挑一種，系統不會替你猜。',
      });
      for (const optionId of state.conflictingOptionIds) {
        for (const plan of tracks) {
          if (
            plan.selection?.groupId === state.group.id &&
            plan.selection.optionId === optionId
          ) {
            plan.blockedReason ??= `方案「${state.group.name}」有選擇衝突`;
          }
        }
      }
    }
  }

  // ---- 5. timing checks for this run --------------------------------------
  if (!Number.isFinite(countdownMs) || countdownMs < 0) {
    errors.push({
      level: 'error',
      code: 'plan.invalid-countdown',
      message: `倒數秒數不合法：${String(countdownMs)}`,
    });
  }
  if (!Number.isFinite(sessionOffsetMs)) {
    errors.push({
      level: 'error',
      code: 'plan.invalid-offset',
      message: `校時數值不合法：${String(sessionOffsetMs)}`,
    });
  }
  if (!speechSupported) {
    errors.push({
      level: 'error',
      code: 'audio.unsupported',
      message: '這個瀏覽器不支援 Web Speech API，無法播放語音提示',
      hint: '請改用支援 Web Speech 的瀏覽器；現在開始也不會有聲音。',
    });
  }

  // ---- 6. deterministic compilation ---------------------------------------
  let compiledTimeline: CompiledTimeline | null = null;
  if (errors.length === 0) {
    try {
      compiledTimeline = compileTimeline(timeline, {
        profile,
        enabledTrackIds: [...enabledTrackIds],
        countdownMs,
        audioDefaults: audio,
      });
    } catch (error) {
      const message =
        error instanceof TimelineCompileError
          ? error.report.errors.map((issue) => issue.message).join('；')
          : error instanceof Error
            ? error.message
            : '時間軸編譯失敗';
      errors.push({ level: 'error', code: 'timeline.blocking-error', message });
    }
  }

  const cues = compiledTimeline?.cues ?? [];
  const minTimeMs = -countdownMs;

  let earliestCueMs: number | null = null;
  for (const cue of cues) {
    if (earliestCueMs === null || cue.triggerMs < earliestCueMs) earliestCueMs = cue.triggerMs;
  }
  const minimumCountdownMs = earliestCueMs !== null && earliestCueMs < 0 ? -earliestCueMs : 0;

  for (const cue of cues) {
    if (cue.triggerMs < minTimeMs) {
      errors.push({
        level: 'error',
        code: 'plan.cue-before-countdown',
        message: `提示「${cue.text}」在 ${cue.triggerMs} 毫秒觸發，比這次的倒數（${countdownMs} 毫秒）還早`,
        hint:
          `改用足夠長的倒數：這一場至少需要 ${minimumCountdownMs / 1000} 秒` +
          `（時間軸預設是 ${timeline.encounter.countdownMs / 1000} 秒）。` +
          '也可以回去修改這句的時間；系統不會偷偷略過開場提示。',
        trackId: cue.trackId,
        eventId: cue.eventId,
        cueId: cue.id,
      });
    }
    if (cue.triggerMs > timeline.encounter.durationMs) {
      errors.push({
        level: 'error',
        code: 'plan.cue-after-duration',
        message: `提示「${cue.text}」在 ${cue.triggerMs} 毫秒觸發，超過戰鬥全長（${timeline.encounter.durationMs} 毫秒）`,
        trackId: cue.trackId,
        eventId: cue.eventId,
        cueId: cue.id,
      });
    }
  }

  // Offset sign follows the engine: elapsed = wall - countdown - offset, so a
  // *negative* session offset starts the timeline already advanced and can put
  // early cues beyond the late tolerance before the first tick.
  if (Number.isFinite(sessionOffsetMs) && cues.length > 0) {
    const initialElapsedMs = -countdownMs - sessionOffsetMs;
    // Cues that start before the countdown are already reported by
    // plan.cue-before-countdown. Counting them here blamed the offset for a
    // countdown problem — it fired even when the offset was exactly 0.
    const skipped = cues.filter(
      (cue) => cue.triggerMs >= minTimeMs && initialElapsedMs - cue.triggerMs > maxLateMs,
    );
    if (skipped.length > 0) {
      errors.push({
        level: 'error',
        code: 'plan.offset-skips-cues',
        message: `目前的校時（${sessionOffsetMs} 毫秒）會讓開場 ${skipped.length} 句提示一開始就被判定過期而略過`,
        hint: '把校時調回接近 0，或改用足夠長的倒數。',
        cueId: skipped[0].id,
      });
    }
  }

  if (errors.length === 0 && cues.length === 0) {
    errors.push({
      level: 'error',
      code: 'plan.no-cues',
      message: '這次沒有任何會播放的提示',
      hint: '確認站位／職業與軌道選擇；停用的提示不會計入。',
    });
  }

  // ---- 7. collisions among the cues that will really play -----------------
  const refs: CollisionCueRef[] = cues.map((cue) => ({
    trackId: cue.trackId,
    trackName: timeline.tracks.find((track) => track.id === cue.trackId)?.name ?? cue.trackId,
    eventId: cue.eventId,
    eventName: cue.eventName,
    cueId: cue.id,
    text: cue.text,
    triggerMs: cue.triggerMs,
    priority: cue.priority ?? DEFAULT_CUE_PRIORITY,
    // Already filtered to this profile, so everything here shares one audience.
    target: undefined,
  }));
  const actualCollisions = analyzeCueRefCollisions(refs, collisionWindowMs);

  if (actualCollisions.pairs.length > 0) {
    warnings.push({
      level: 'warning',
      code: 'plan.collisions',
      message: `這次有 ${actualCollisions.pairs.length} 組提示間隔在 ${collisionWindowMs} 毫秒內，可能來不及唸完`,
      requiresConfirmation: true,
      hint: '可以先試播那一段確認，或回去調整時間；系統不會自動刪除、合併或插隊。',
    });
  }

  // A job track with an unrestricted job dimension: probably a missing target,
  // but shared content is legitimate, so this is only ever a warning.
  for (const plan of tracks) {
    if (!plan.selected || plan.track.type !== 'job') continue;
    const unrestricted = plan.track.events.some((event) =>
      event.cues.some((cue) => {
        if (cue.enabled === false) return false;
        const target = combineTargets(plan.track.target, cue.target);
        return target?.jobs === undefined;
      }),
    );
    if (unrestricted) {
      warnings.push({
        level: 'warning',
        code: 'plan.job-track-unrestricted',
        message: `職業軌道「${plan.track.name}」裡有沒有限定職業的提示`,
        requiresConfirmation: true,
        hint: '可能是作者漏填對象。如果本來就是共用內容，確認後照常開始。',
        trackId: plan.track.id,
      });
    }
  }

  // Shared-only run: say so plainly instead of implying a full personal plan.
  if (cues.length > 0) {
    const encounterTrackIds = new Set(
      timeline.tracks.filter((track) => track.type === 'encounter').map((track) => track.id),
    );
    const hasShared = cues.some((cue) => encounterTrackIds.has(cue.trackId));
    const hasPersonal = cues.some((cue) => !encounterTrackIds.has(cue.trackId));
    if (hasShared && !hasPersonal) {
      warnings.push({
        level: 'warning',
        code: 'plan.only-shared-cues',
        message: '這次只有共通提醒，沒有任何適用於你的個人／職業提醒',
        requiresConfirmation: true,
        hint: '這不等於套用了完整奶軸。可以在編輯器用「＋我的提醒」補上自己的提示。',
      });
    }
  }

  const fingerprint = hash(
    JSON.stringify({
      timeline,
      profile,
      enabledTrackIds: [...enabledTrackIds].slice().sort(),
      countdownMs,
      audio,
      collisionWindowMs,
      maxLateMs,
      sessionOffsetMs,
      speechSupported,
    }),
  );

  const canStart = errors.length === 0 && compiledTimeline !== null && cues.length > 0;

  return {
    compiledTimeline: canStart ? compiledTimeline : null,
    cues,
    totalCueCount: cues.length,
    tracks,
    selectionGroups,
    errors,
    warnings,
    actualCollisions,
    earliestCueMs,
    minimumCountdownMs,
    fingerprint,
    canStart,
    requiresConfirmation: warnings.some((warning) => warning.requiresConfirmation === true),
  };
}

/** Convenience for the editor's problem list, which still wants raw issues. */
export function planIssueFromValidation(issue: ValidationIssue): PlanIssue {
  return {
    level: issue.level,
    code: 'timeline.blocking-error',
    message: issue.message,
    trackId: issue.trackId,
    eventId: issue.eventId,
    cueId: issue.cueId,
  };
}
