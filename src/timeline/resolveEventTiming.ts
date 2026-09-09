import {
  isAbsoluteTiming,
  type EventTiming,
  type TimelineEvent,
  type TimelinePackage,
  type TimelineTrack,
} from './types';

/**
 * The one and only place event times are resolved (spec §3.1).
 *
 * Compiler, validator, collision analysis, sorting, list rendering, preview and
 * the "convert to fixed time" path all go through this module, so a mechanic
 * reference can never mean two different things in two different screens.
 *
 * Rules for a `mechanic` reference in this version:
 *   - same document only
 *   - source track must be `type: 'encounter'`
 *   - source event must itself be `absolute` (no reference chains)
 *   - self-reference, cycles, missing and wrong-kind sources are hard errors
 *
 * Whether the source cue is enabled, and whether the source *track* is selected
 * for this run, is irrelevant: the anchor is a property of the document, not of
 * the current playback selection. Muting the boss callouts must not silently
 * move or drop the player's own reminders.
 */

export type TimingIssueCode =
  | 'timing.self-reference'
  | 'timing.missing-source-track'
  | 'timing.missing-source-event'
  | 'timing.source-not-encounter'
  | 'timing.source-not-absolute'
  | 'timing.non-finite';

export interface TimingIssue {
  code: TimingIssueCode;
  message: string;
  trackId: string;
  eventId: string;
  field: 'timing';
}

export interface ResolvedTiming {
  /** Absolute event time, when the reference could be resolved. */
  atMs?: number;
  /** Phase shown for this event: a mechanic event inherits the live source phase. */
  phase?: string;
  /** The referenced source, when this event is anchored to a mechanic. */
  source?: { track: TimelineTrack; event: TimelineEvent };
  issue?: TimingIssue;
}

/** Index of everything a `mechanic` timing may point at. */
export interface MechanicIndex {
  /** Every event in the document, by id, with its owning track. */
  readonly byEventId: ReadonlyMap<string, { track: TimelineTrack; event: TimelineEvent }>;
  /** Absolute encounter events only — the legal anchor set. */
  readonly anchors: ReadonlyArray<{ track: TimelineTrack; event: TimelineEvent; atMs: number }>;
}

/**
 * Build the anchor index from the *whole* document.
 *
 * Deliberately not filtered by enabled tracks or by profile (spec §4.1): an
 * anchor that exists in the file must resolve even when the boss track is
 * switched off for this run.
 */
export function buildMechanicIndex(timeline: TimelinePackage): MechanicIndex {
  const byEventId = new Map<string, { track: TimelineTrack; event: TimelineEvent }>();
  const anchors: Array<{ track: TimelineTrack; event: TimelineEvent; atMs: number }> = [];

  for (const track of timeline.tracks) {
    for (const event of track.events) {
      // First writer wins; duplicate event ids are reported by the validator.
      if (!byEventId.has(event.id)) byEventId.set(event.id, { track, event });
      if (track.type === 'encounter' && isAbsoluteTiming(event.timing)) {
        anchors.push({ track, event, atMs: event.timing.atMs });
      }
    }
  }

  return { byEventId, anchors };
}

function issue(
  code: TimingIssueCode,
  message: string,
  trackId: string,
  eventId: string,
): TimingIssue {
  return { code, message, trackId, eventId, field: 'timing' };
}

/**
 * Resolve one event's timing against an index.
 *
 * `ownerTrackId` is the track the event lives in; it is only needed so issues
 * can point at the right row.
 */
export function resolveEventTiming(
  event: TimelineEvent,
  ownerTrackId: string,
  index: MechanicIndex,
): ResolvedTiming {
  const timing: EventTiming = event.timing;

  if (isAbsoluteTiming(timing)) {
    if (!Number.isFinite(timing.atMs)) {
      return {
        issue: issue(
          'timing.non-finite',
          `事件「${event.name}」的時間不是有限數值`,
          ownerTrackId,
          event.id,
        ),
      };
    }
    return { atMs: timing.atMs, phase: event.phase };
  }

  if (timing.sourceEventId === event.id) {
    return {
      issue: issue(
        'timing.self-reference',
        `事件「${event.name}」連動到自己`,
        ownerTrackId,
        event.id,
      ),
    };
  }

  const found = index.byEventId.get(timing.sourceEventId);
  if (!found) {
    return {
      issue: issue(
        'timing.missing-source-event',
        `事件「${event.name}」連動的來源機制不存在（${timing.sourceEventId}）`,
        ownerTrackId,
        event.id,
      ),
    };
  }

  if (found.track.id !== timing.sourceTrackId) {
    return {
      issue: issue(
        'timing.missing-source-track',
        `事件「${event.name}」連動的來源軌道不符（宣告 ${timing.sourceTrackId}，實際在 ${found.track.id}）`,
        ownerTrackId,
        event.id,
      ),
    };
  }

  if (found.track.type !== 'encounter') {
    return {
      issue: issue(
        'timing.source-not-encounter',
        `事件「${event.name}」只能連動到戰鬥軌道的機制，「${found.track.name}」不是戰鬥軌道`,
        ownerTrackId,
        event.id,
      ),
    };
  }

  if (!isAbsoluteTiming(found.event.timing)) {
    // No reference chains in this version — a cycle can therefore never form.
    return {
      issue: issue(
        'timing.source-not-absolute',
        `事件「${event.name}」的來源機制「${found.event.name}」本身也是連動事件，不支援連鎖連動`,
        ownerTrackId,
        event.id,
      ),
    };
  }

  if (!Number.isFinite(found.event.timing.atMs)) {
    return {
      issue: issue(
        'timing.non-finite',
        `事件「${event.name}」的來源機制時間不是有限數值`,
        ownerTrackId,
        event.id,
      ),
    };
  }

  return {
    atMs: found.event.timing.atMs,
    // Phase comes from the live source, so a copied-then-moved mechanic can
    // never leave a stale phase behind (spec §3.1).
    phase: found.event.phase ?? event.phase,
    source: { track: found.track, event: found.event },
  };
}

export interface ResolvedEventRow {
  track: TimelineTrack;
  event: TimelineEvent;
  resolved: ResolvedTiming;
}

/** Resolve every event in the document, in declaration order. */
export function resolveAllEvents(
  timeline: TimelinePackage,
  index: MechanicIndex = buildMechanicIndex(timeline),
): ResolvedEventRow[] {
  const rows: ResolvedEventRow[] = [];
  for (const track of timeline.tracks) {
    for (const event of track.events) {
      rows.push({ track, event, resolved: resolveEventTiming(event, track.id, index) });
    }
  }
  return rows;
}

/** Every unresolvable reference in the document. */
export function collectTimingIssues(
  timeline: TimelinePackage,
  index: MechanicIndex = buildMechanicIndex(timeline),
): TimingIssue[] {
  const issues: TimingIssue[] = [];
  for (const row of resolveAllEvents(timeline, index)) {
    if (row.resolved.issue) issues.push(row.resolved.issue);
  }
  return issues;
}

/**
 * Convenience for callers that already know the document is reference-clean.
 * Returns `undefined` instead of throwing so display code can render a dash.
 */
export function eventAtMs(
  timeline: TimelinePackage,
  event: TimelineEvent,
  index: MechanicIndex = buildMechanicIndex(timeline),
): number | undefined {
  const owner = timeline.tracks.find((track) => track.events.includes(event));
  return resolveEventTiming(event, owner?.id ?? '', index).atMs;
}

/** Absolute time of an `absolute` event; throws for a mechanic reference. */
export function absoluteAtMs(event: TimelineEvent): number {
  if (!isAbsoluteTiming(event.timing)) {
    throw new Error(`事件 ${event.id} 是連動事件，沒有自己的絕對時間`);
  }
  return event.timing.atMs;
}

/** All events that reference the given source event, across every track. */
export function findDependentEvents(
  timeline: TimelinePackage,
  sourceEventId: string,
): ResolvedEventRow[] {
  const index = buildMechanicIndex(timeline);
  const rows: ResolvedEventRow[] = [];
  for (const track of timeline.tracks) {
    for (const event of track.events) {
      if (event.timing.kind === 'mechanic' && event.timing.sourceEventId === sourceEventId) {
        rows.push({ track, event, resolved: resolveEventTiming(event, track.id, index) });
      }
    }
  }
  return rows;
}

/** All events referencing any event inside the given track. */
export function findDependentsOfTrack(
  timeline: TimelinePackage,
  sourceTrackId: string,
): ResolvedEventRow[] {
  const sourceIds = new Set(
    timeline.tracks
      .filter((track) => track.id === sourceTrackId)
      .flatMap((track) => track.events.map((event) => event.id)),
  );
  const index = buildMechanicIndex(timeline);
  const rows: ResolvedEventRow[] = [];
  for (const track of timeline.tracks) {
    if (track.id === sourceTrackId) continue;
    for (const event of track.events) {
      if (event.timing.kind === 'mechanic' && sourceIds.has(event.timing.sourceEventId)) {
        rows.push({ track, event, resolved: resolveEventTiming(event, track.id, index) });
      }
    }
  }
  return rows;
}
