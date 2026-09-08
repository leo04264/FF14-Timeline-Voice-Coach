import { insertEventSorted, updateTrack } from './edits';
import { createId } from './ids';
import { buildMechanicIndex, resolveEventTiming } from './resolveEventTiming';
import { JOB_NAME_LABEL } from '../i18n/labels';
import {
  isAbsoluteTiming,
  mechanicTiming,
  type PartyPosition,
  type PlayerProfile,
  type TimelineEvent,
  type TimelinePackage,
  type TimelineTrack,
  type JobCode,
} from './types';

/**
 * The player's own quick reminders (spec §5.2).
 *
 * One system-managed track per timeline per exact position/job. The track target
 * is what limits the audience, so a new reminder can never inherit the boss
 * track's "everybody" target or another job's target.
 */

export const PERSONAL_TRACK_PURPOSE = 'personal-reminders' as const;

export function personalTrackName(profile: PlayerProfile): string {
  return `我的自訂提醒（${profile.position}／${JOB_NAME_LABEL[profile.job]}）`;
}

function targetsExactly(
  track: TimelineTrack,
  position: PartyPosition,
  job: JobCode,
): boolean {
  const positions = track.target?.positions;
  const jobs = track.target?.jobs;
  return (
    positions?.length === 1 &&
    positions[0] === position &&
    jobs?.length === 1 &&
    jobs[0] === job
  );
}

/** The system personal track for this profile, when it already exists. */
export function findPersonalTrack(
  timeline: TimelinePackage,
  profile: PlayerProfile,
): TimelineTrack | undefined {
  return timeline.tracks.find(
    (track) =>
      track.purpose === PERSONAL_TRACK_PURPOSE &&
      targetsExactly(track, profile.position, profile.job),
  );
}

export function makePersonalTrack(profile: PlayerProfile): TimelineTrack {
  return {
    id: createId(),
    type: 'custom',
    name: personalTrackName(profile),
    enabledByDefault: true,
    target: { positions: [profile.position], jobs: [profile.job] },
    purpose: PERSONAL_TRACK_PURPOSE,
    events: [],
  };
}

/**
 * Get-or-create the personal track.
 *
 * Idempotent: repeated calls (including double clicks) reuse the same track, so
 * the "at most one per profile" invariant holds (spec §5.2.2).
 */
export function ensurePersonalTrack(
  timeline: TimelinePackage,
  profile: PlayerProfile,
): { timeline: TimelinePackage; track: TimelineTrack; created: boolean } {
  const existing = findPersonalTrack(timeline, profile);
  if (existing) return { timeline, track: existing, created: false };
  const track = makePersonalTrack(profile);
  return { timeline: { ...timeline, tracks: [...timeline.tracks, track] }, track, created: true };
}

// ------------------------------------------------------------------ add a cue

export type ReminderWhen = 'before' | 'at' | 'after';

export interface QuickReminderDraft {
  /** Encounter mechanic this reminder hangs off. */
  sourceTrackId: string;
  sourceEventId: string;
  text: string;
  when: ReminderWhen;
  /** Seconds, non-negative. Ignored (treated as 0) when `when` is `'at'`. */
  seconds: number;
}

export interface QuickReminderValidation {
  ok: boolean;
  /** Signed cue offset in ms; `-N*1000` before, `+N*1000` after, `0` at. */
  offsetMs?: number;
  sourceAtMs?: number;
  triggerMs?: number;
  /** Field-scoped problems, so the form can show them next to the input. */
  errors: { field: 'text' | 'seconds' | 'source' | 'time'; message: string }[];
}

/** Convert the form's when/seconds pair into a single signed cue offset. */
export function reminderOffsetMs(when: ReminderWhen, seconds: number): number {
  if (when === 'at') return 0;
  const magnitude = Math.round(seconds * 1000);
  return when === 'before' ? -magnitude : magnitude;
}

/**
 * Validate a draft against the live document.
 *
 * The trigger time comes from the shared resolver, so the number shown in the
 * form is exactly the number the compiler will use.
 */
export function validateQuickReminder(
  timeline: TimelinePackage,
  draft: QuickReminderDraft,
): QuickReminderValidation {
  const errors: QuickReminderValidation['errors'] = [];

  if (draft.text.trim() === '') {
    errors.push({ field: 'text', message: '提醒內容不能空白' });
  }

  const secondsUsed = draft.when === 'at' ? 0 : draft.seconds;
  if (!Number.isFinite(secondsUsed) || secondsUsed < 0) {
    errors.push({ field: 'seconds', message: '秒數必須是 0 或正數' });
  }

  const sourceTrack = timeline.tracks.find((track) => track.id === draft.sourceTrackId);
  const sourceEvent = sourceTrack?.events.find((event) => event.id === draft.sourceEventId);
  if (!sourceTrack || !sourceEvent) {
    errors.push({ field: 'source', message: '找不到這個王機制' });
    return { ok: false, errors };
  }
  if (sourceTrack.type !== 'encounter') {
    errors.push({ field: 'source', message: '只能對戰鬥軌道的機制加提醒' });
    return { ok: false, errors };
  }
  if (!isAbsoluteTiming(sourceEvent.timing)) {
    errors.push({ field: 'source', message: '這個機制本身是連動事件，不能當錨點' });
    return { ok: false, errors };
  }

  const sourceAtMs = resolveEventTiming(
    sourceEvent,
    sourceTrack.id,
    buildMechanicIndex(timeline),
  ).atMs;
  if (sourceAtMs === undefined) {
    errors.push({ field: 'source', message: '這個機制的時間無法解析' });
    return { ok: false, errors };
  }

  // The trigger time is shown live, so it must be computed even while the text
  // is still empty (spec §5.1). Only an unusable seconds value can hide it.
  const secondsUsable = Number.isFinite(secondsUsed) && secondsUsed >= 0;
  if (!secondsUsable) return { ok: false, sourceAtMs, errors };

  const offsetMs = reminderOffsetMs(draft.when, secondsUsed);
  const triggerMs = sourceAtMs + offsetMs;
  const minMs = -timeline.encounter.countdownMs;

  if (triggerMs < minMs) {
    errors.push({
      field: 'time',
      message: `提醒會落在 ${triggerMs} 毫秒，早於倒數開始（${minMs} 毫秒）`,
    });
  }
  if (triggerMs > timeline.encounter.durationMs) {
    errors.push({
      field: 'time',
      message: `提醒會落在 ${triggerMs} 毫秒，超過戰鬥全長（${timeline.encounter.durationMs} 毫秒）`,
    });
  }

  return { ok: errors.length === 0, offsetMs, sourceAtMs, triggerMs, errors };
}

export interface AddQuickReminderResult {
  ok: boolean;
  timeline: TimelinePackage;
  trackId?: string;
  eventId?: string;
  cueId?: string;
  createdTrack?: boolean;
  trackEnabledByDefault?: boolean;
  errors: QuickReminderValidation['errors'];
}

/**
 * Add one quick reminder.
 *
 * Creating the personal track (when needed) and appending the cue is a single
 * document change, so one undo removes both the reminder and the empty track it
 * had to create (spec §5.2.6).
 */
export function addQuickReminder(
  timeline: TimelinePackage,
  profile: PlayerProfile,
  draft: QuickReminderDraft,
): AddQuickReminderResult {
  const validation = validateQuickReminder(timeline, draft);
  if (!validation.ok || validation.offsetMs === undefined) {
    return { ok: false, timeline, errors: validation.errors };
  }

  const ensured = ensurePersonalTrack(timeline, profile);
  const eventId = createId();
  const cueId = createId();

  const event: TimelineEvent = {
    id: eventId,
    // A live reference, never a copied time (spec §5.1).
    timing: mechanicTiming(draft.sourceTrackId, draft.sourceEventId),
    name: draft.text.trim(),
    category: 'custom',
    cues: [
      {
        id: cueId,
        offsetMs: validation.offsetMs,
        text: draft.text.trim(),
        priority: 'normal',
        enabled: true,
        // Audience comes from the track target; no per-cue target is needed and
        // adding one would risk drifting from the track.
      },
    ],
  };

  return {
    ok: true,
    timeline: insertEventSorted(ensured.timeline, ensured.track.id, event),
    trackId: ensured.track.id,
    eventId,
    cueId,
    createdTrack: ensured.created,
    trackEnabledByDefault: ensured.track.enabledByDefault,
    errors: [],
  };
}

/** Enable/disable the personal track itself (used by the "同時啟用" affordance). */
export function setTrackEnabledByDefault(
  timeline: TimelinePackage,
  trackId: string,
  enabledByDefault: boolean,
): TimelinePackage {
  return updateTrack(timeline, trackId, (track) => ({ ...track, enabledByDefault }));
}

// ---------------------------------------------------------------- inspection

export interface PersonalReminderRow {
  trackId: string;
  trackName: string;
  eventId: string;
  cueId: string;
  text: string;
  offsetMs: number;
  enabled: boolean;
  triggerMs?: number;
  /** True when this cue also applies to somebody other than the current player. */
  shared: boolean;
}

/** Reminders that reference `sourceEventId` and apply to this profile. */
export function remindersForMechanic(
  timeline: TimelinePackage,
  sourceEventId: string,
  matches: (track: TimelineTrack, cueTargetOwner: TimelineEvent) => boolean,
): PersonalReminderRow[] {
  const index = buildMechanicIndex(timeline);
  const rows: PersonalReminderRow[] = [];

  for (const track of timeline.tracks) {
    for (const event of track.events) {
      if (event.timing.kind !== 'mechanic') continue;
      if (event.timing.sourceEventId !== sourceEventId) continue;
      if (!matches(track, event)) continue;
      const resolved = resolveEventTiming(event, track.id, index);
      for (const cue of event.cues) {
        rows.push({
          trackId: track.id,
          trackName: track.name,
          eventId: event.id,
          cueId: cue.id,
          text: cue.text,
          offsetMs: cue.offsetMs,
          enabled: cue.enabled !== false,
          triggerMs: resolved.atMs === undefined ? undefined : resolved.atMs + cue.offsetMs,
          shared: track.purpose !== PERSONAL_TRACK_PURPOSE,
        });
      }
    }
  }
  return rows;
}
