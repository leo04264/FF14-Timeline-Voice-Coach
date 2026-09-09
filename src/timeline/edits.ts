import { createId } from './ids';
import {
  buildMechanicIndex,
  findDependentEvents,
  findDependentsOfTrack,
  resolveEventTiming,
  type ResolvedEventRow,
} from './resolveEventTiming';
import {
  absoluteTiming,
  isAbsoluteTiming,
  mechanicTiming,
  type CuePriority,
  type EventCategory,
  type EventTiming,
  type TimelineCue,
  type TimelineEvent,
  type TimelinePackage,
  type TimelineTrack,
} from './types';

/**
 * Pure immutable edit helpers for the editor. Keeping them out of components
 * means undo/redo just swaps whole documents.
 *
 * Everything that can break a `mechanic` timing reference lives here too, so
 * both the new day-to-day views and the older advanced editor go through the
 * same reference-safe paths (spec §6.2).
 */

export function updateTrack(
  timeline: TimelinePackage,
  trackId: string,
  updater: (track: TimelineTrack) => TimelineTrack,
): TimelinePackage {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => (track.id === trackId ? updater(track) : track)),
  };
}

export function updateEvent(
  timeline: TimelinePackage,
  trackId: string,
  eventId: string,
  updater: (event: TimelineEvent) => TimelineEvent,
): TimelinePackage {
  return updateTrack(timeline, trackId, (track) => ({
    ...track,
    events: track.events.map((event) => (event.id === eventId ? updater(event) : event)),
  }));
}

export function updateCue(
  timeline: TimelinePackage,
  trackId: string,
  eventId: string,
  cueId: string,
  updater: (cue: TimelineCue) => TimelineCue,
): TimelinePackage {
  return updateEvent(timeline, trackId, eventId, (event) => ({
    ...event,
    cues: event.cues.map((cue) => (cue.id === cueId ? updater(cue) : cue)),
  }));
}

export function addTrack(timeline: TimelinePackage, name = '新軌道'): TimelinePackage {
  const track: TimelineTrack = {
    id: createId(),
    type: 'custom',
    name,
    enabledByDefault: true,
    events: [],
  };
  return { ...timeline, tracks: [...timeline.tracks, track] };
}

// --------------------------------------------------------------- id remapping

/**
 * Rewrite `mechanic` references through an id map, in a second pass.
 *
 * Sources inside the copied scope are re-pointed at their copies; sources
 * outside it keep pointing at the original event in the same document, which is
 * what "copy a track" should mean (spec §6.2 複製規則).
 */
function remapTimings(
  events: TimelineEvent[],
  trackIdMap: ReadonlyMap<string, string>,
  eventIdMap: ReadonlyMap<string, string>,
): TimelineEvent[] {
  return events.map((event) => {
    if (isAbsoluteTiming(event.timing)) return event;
    const nextEventId = eventIdMap.get(event.timing.sourceEventId);
    if (nextEventId === undefined) return event; // source outside the copied scope
    const nextTrackId = trackIdMap.get(event.timing.sourceTrackId) ?? event.timing.sourceTrackId;
    return { ...event, timing: mechanicTiming(nextTrackId, nextEventId) };
  });
}

function cloneEventsWithNewIds(
  events: TimelineEvent[],
  eventIdMap: Map<string, string>,
): TimelineEvent[] {
  return events.map((event) => {
    const id = createId();
    eventIdMap.set(event.id, id);
    return {
      ...event,
      id,
      cues: event.cues.map((cue) => ({ ...cue, id: createId() })),
    };
  });
}

export function removeTrack(timeline: PackageOrDraft, trackId: string): TimelinePackage {
  return { ...timeline, tracks: timeline.tracks.filter((track) => track.id !== trackId) };
}

type PackageOrDraft = TimelinePackage;

/**
 * Duplicate a track.
 *
 * The copy is always a plain custom track: a system `personal-reminders`
 * purpose is dropped so the "one personal track per profile" invariant cannot be
 * broken by copying (spec §6.2).
 */
export function duplicateTrack(timeline: TimelinePackage, trackId: string): TimelinePackage {
  const source = timeline.tracks.find((track) => track.id === trackId);
  if (!source) return timeline;

  const newTrackId = createId();
  const eventIdMap = new Map<string, string>();
  const clonedEvents = cloneEventsWithNewIds(source.events, eventIdMap);
  const trackIdMap = new Map([[source.id, newTrackId]]);

  const copy: TimelineTrack = {
    ...source,
    id: newTrackId,
    name: `${source.name}（複本）`,
    events: remapTimings(clonedEvents, trackIdMap, eventIdMap),
  };
  delete copy.purpose;

  const index = timeline.tracks.findIndex((track) => track.id === trackId);
  const tracks = [...timeline.tracks];
  tracks.splice(index + 1, 0, copy);
  return { ...timeline, tracks };
}

/**
 * Copy a whole document (Fork / Duplicate / Import-as-Copy).
 *
 * Two passes: mint every new id first, then rewrite every internal reference,
 * so a fork can never point back at the original document (spec §6.2).
 */
export function forkTimeline(
  timeline: TimelinePackage,
  overrides: { id?: string; name?: string } = {},
): { timeline: TimelinePackage; trackIdMap: Map<string, string>; eventIdMap: Map<string, string> } {
  const trackIdMap = new Map<string, string>();
  const eventIdMap = new Map<string, string>();

  const staged = timeline.tracks.map((track) => {
    const id = createId();
    trackIdMap.set(track.id, id);
    return { ...track, id, events: cloneEventsWithNewIds(track.events, eventIdMap) };
  });

  const tracks = staged.map((track) => ({
    ...track,
    events: remapTimings(track.events, trackIdMap, eventIdMap),
  }));

  return {
    timeline: {
      ...timeline,
      id: overrides.id ?? createId(),
      meta: { ...timeline.meta, name: overrides.name ?? timeline.meta.name },
      selectionGroups: timeline.selectionGroups?.map((group) => ({
        ...group,
        options: group.options.map((option) => ({ ...option })),
      })),
      tracks,
    },
    trackIdMap,
    eventIdMap,
  };
}

export function moveTrack(
  timeline: TimelinePackage,
  trackId: string,
  delta: number,
): TimelinePackage {
  const index = timeline.tracks.findIndex((track) => track.id === trackId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= timeline.tracks.length) return timeline;
  const tracks = [...timeline.tracks];
  const [moved] = tracks.splice(index, 1);
  tracks.splice(target, 0, moved);
  return { ...timeline, tracks };
}

export function addEvent(
  timeline: TimelinePackage,
  trackId: string,
  atMs = 0,
): { timeline: TimelinePackage; eventId: string } {
  const event: TimelineEvent = {
    id: createId(),
    timing: absoluteTiming(atMs),
    name: '新事件',
    category: 'mechanic',
    cues: [],
  };
  return {
    timeline: updateTrack(timeline, trackId, (track) => ({
      ...track,
      events: [...track.events, event],
    })),
    eventId: event.id,
  };
}

// --------------------------------------------------------- mechanic reminders

export type MechanicActionMode = 'linked' | 'fixed';

export interface AppendMechanicActionInput {
  eventName: string;
  category: EventCategory;
  cueText: string;
  cueOffsetMs: number;
  priority: CuePriority;
  /**
   * `linked` stores a live reference to the source mechanic — moving the boss
   * mechanic moves this reminder. `fixed` snapshots the current source time as
   * a plain absolute event that will *not* follow the source afterwards.
   */
  mode?: MechanicActionMode;
}

export type AppendMechanicActionResult =
  | { ok: true; timeline: TimelinePackage; eventId: string; cueId: string }
  | { ok: false; timeline: TimelinePackage; error: string };

/**
 * Create a target-track event from an encounter mechanic.
 *
 * Unlike the V0.1 helper this can produce a real cross-track reference; the UI
 * must say which of the two it is doing (spec §5.2).
 */
export function appendMechanicAction(
  timeline: TimelinePackage,
  sourceTrackId: string,
  sourceEventId: string,
  targetTrackId: string,
  input: AppendMechanicActionInput,
): AppendMechanicActionResult {
  const sourceTrack = timeline.tracks.find((track) => track.id === sourceTrackId);
  const sourceEvent = sourceTrack?.events.find((event) => event.id === sourceEventId);
  const targetTrack = timeline.tracks.find((track) => track.id === targetTrackId);

  if (!sourceTrack || sourceTrack.type !== 'encounter' || !sourceEvent) {
    return { ok: false, timeline, error: '找不到可作為錨點的王機制事件' };
  }
  if (!isAbsoluteTiming(sourceEvent.timing)) {
    return { ok: false, timeline, error: '來源機制本身是連動事件，不支援連鎖連動' };
  }
  if (!targetTrack || targetTrack.id === sourceTrack.id) {
    return { ok: false, timeline, error: '請選擇另一條有效軌道' };
  }
  if (input.eventName.trim() === '') {
    return { ok: false, timeline, error: '動作名稱不能空白' };
  }
  if (input.cueText.trim() === '') {
    return { ok: false, timeline, error: '語音內容不能空白' };
  }
  if (!Number.isFinite(input.cueOffsetMs)) {
    return { ok: false, timeline, error: '提示時間必須是有效數值' };
  }

  const sourceAtMs = sourceEvent.timing.atMs;
  const triggerMs = sourceAtMs + input.cueOffsetMs;
  if (triggerMs < -timeline.encounter.countdownMs) {
    return { ok: false, timeline, error: '提示時間早於倒數開始' };
  }
  if (triggerMs > timeline.encounter.durationMs) {
    return { ok: false, timeline, error: '提示時間超過戰鬥全長' };
  }

  const mode: MechanicActionMode = input.mode ?? 'linked';
  const cueId = createId();
  const eventId = createId();
  const timing: EventTiming =
    mode === 'linked' ? mechanicTiming(sourceTrack.id, sourceEvent.id) : absoluteTiming(sourceAtMs);

  const actionEvent: TimelineEvent = {
    id: eventId,
    timing,
    name: input.eventName.trim(),
    category: input.category,
    cues: [
      {
        id: cueId,
        offsetMs: input.cueOffsetMs,
        text: input.cueText.trim(),
        priority: input.priority,
        enabled: true,
      },
    ],
  };
  // A linked event inherits the live source phase; only a fixed snapshot copies
  // it, and even then the resolver reports the event's own phase.
  if (mode === 'fixed' && sourceEvent.phase !== undefined) actionEvent.phase = sourceEvent.phase;

  return {
    ok: true,
    timeline: insertEventSorted(timeline, targetTrack.id, actionEvent),
    eventId,
    cueId,
  };
}

/** Insert an event into a track, keeping the track roughly time-ordered. */
export function insertEventSorted(
  timeline: TimelinePackage,
  trackId: string,
  event: TimelineEvent,
): TimelinePackage {
  const withEvent = updateTrack(timeline, trackId, (track) => ({
    ...track,
    events: [...track.events, event],
  }));
  const index = buildMechanicIndex(withEvent);
  const at = (candidate: TimelineEvent) =>
    resolveEventTiming(candidate, trackId, index).atMs ?? Number.POSITIVE_INFINITY;

  return updateTrack(withEvent, trackId, (track) => {
    const events = track.events.filter((candidate) => candidate.id !== event.id);
    const insertAt = events.findIndex((candidate) => at(candidate) > at(event));
    events.splice(insertAt < 0 ? events.length : insertAt, 0, event);
    return { ...track, events };
  });
}

// ------------------------------------------------------- reference-safe delete

export type DeleteDependentsStrategy = 'cancel' | 'delete-dependents' | 'convert-to-fixed';

export interface DependentSummary {
  trackId: string;
  trackName: string;
  eventId: string;
  eventName: string;
  atMs?: number;
  cueTexts: string[];
  target?: TimelineTrack['target'];
}

function summarise(rows: ResolvedEventRow[]): DependentSummary[] {
  return rows.map((row) => ({
    trackId: row.track.id,
    trackName: row.track.name,
    eventId: row.event.id,
    eventName: row.event.name,
    atMs: row.resolved.atMs,
    cueTexts: row.event.cues.map((cue) => cue.text),
    target: row.track.target,
  }));
}

/**
 * Everything that would break if this event were deleted.
 *
 * Deliberately profile-independent: a reminder belonging to another job must
 * still be listed, otherwise deleting a mechanic silently breaks a track the
 * current player cannot see (spec §6.2).
 */
export function describeEventDependents(
  timeline: TimelinePackage,
  eventId: string,
): DependentSummary[] {
  return summarise(findDependentEvents(timeline, eventId));
}

export function describeTrackDependents(
  timeline: TimelinePackage,
  trackId: string,
): DependentSummary[] {
  return summarise(findDependentsOfTrack(timeline, trackId));
}

/**
 * Rewrite the given dependent events to a fixed absolute time that preserves
 * their current trigger instant, resolved against the *old* document.
 */
function pinDependentsToFixedTime(
  timeline: TimelinePackage,
  dependents: ResolvedEventRow[],
): TimelinePackage {
  let next = timeline;
  for (const row of dependents) {
    const atMs = row.resolved.atMs;
    if (atMs === undefined) continue; // already broken; leave it for the editor
    const phase = row.resolved.phase;
    next = updateEvent(next, row.track.id, row.event.id, (event) => {
      const converted: TimelineEvent = { ...event, timing: absoluteTiming(atMs) };
      // Freeze the phase that was being displayed, so the row does not go blank.
      if (phase !== undefined) converted.phase = phase;
      return converted;
    });
  }
  return next;
}

export type RemoveEventResult =
  | { ok: true; timeline: TimelinePackage; convertedEventIds: string[]; deletedEventIds: string[] }
  | { ok: false; timeline: TimelinePackage; dependents: DependentSummary[] };

/**
 * Delete an event, handling anything that references it.
 *
 * `cancel` (the default) refuses and hands back the dependents so the UI can
 * show them; the other two strategies are one atomic document change each, so a
 * single undo restores everything (spec §6.2).
 */
export function removeEventSafely(
  timeline: TimelinePackage,
  trackId: string,
  eventId: string,
  strategy: DeleteDependentsStrategy = 'cancel',
): RemoveEventResult {
  const dependents = findDependentEvents(timeline, eventId);

  if (dependents.length > 0 && strategy === 'cancel') {
    return { ok: false, timeline, dependents: summarise(dependents) };
  }

  let next = timeline;
  const convertedEventIds: string[] = [];
  const deletedEventIds: string[] = [];

  if (strategy === 'convert-to-fixed') {
    // Resolve against the old document *before* the source disappears.
    next = pinDependentsToFixedTime(next, dependents);
    convertedEventIds.push(...dependents.map((row) => row.event.id));
  } else if (strategy === 'delete-dependents') {
    for (const row of dependents) {
      next = removeEventRaw(next, row.track.id, row.event.id);
      deletedEventIds.push(row.event.id);
    }
  }

  next = removeEventRaw(next, trackId, eventId);
  return { ok: true, timeline: next, convertedEventIds, deletedEventIds };
}

export type RemoveTrackResult =
  | { ok: true; timeline: TimelinePackage; convertedEventIds: string[]; deletedEventIds: string[] }
  | { ok: false; timeline: TimelinePackage; dependents: DependentSummary[] };

export function removeTrackSafely(
  timeline: TimelinePackage,
  trackId: string,
  strategy: DeleteDependentsStrategy = 'cancel',
): RemoveTrackResult {
  const dependents = findDependentsOfTrack(timeline, trackId);

  if (dependents.length > 0 && strategy === 'cancel') {
    return { ok: false, timeline, dependents: summarise(dependents) };
  }

  let next = timeline;
  const convertedEventIds: string[] = [];
  const deletedEventIds: string[] = [];

  if (strategy === 'convert-to-fixed') {
    next = pinDependentsToFixedTime(next, dependents);
    convertedEventIds.push(...dependents.map((row) => row.event.id));
  } else if (strategy === 'delete-dependents') {
    for (const row of dependents) {
      next = removeEventRaw(next, row.track.id, row.event.id);
      deletedEventIds.push(row.event.id);
    }
  }

  return { ok: true, timeline: removeTrack(next, trackId), convertedEventIds, deletedEventIds };
}

/** Unconditional removal. Callers must have already handled dependents. */
function removeEventRaw(
  timeline: TimelinePackage,
  trackId: string,
  eventId: string,
): TimelinePackage {
  return updateTrack(timeline, trackId, (track) => ({
    ...track,
    events: track.events.filter((event) => event.id !== eventId),
  }));
}

/**
 * Legacy signature kept for callers that already checked dependents.
 * Prefer {@link removeEventSafely}.
 */
export function removeEvent(
  timeline: TimelinePackage,
  trackId: string,
  eventId: string,
): TimelinePackage {
  const result = removeEventSafely(timeline, trackId, eventId, 'convert-to-fixed');
  return result.ok ? result.timeline : timeline;
}

// ------------------------------------------------- link / unlink an event time

export type ConvertTimingResult =
  | { ok: true; timeline: TimelinePackage }
  | { ok: false; timeline: TimelinePackage; error: string };

/** Turn a linked event into a plain absolute one, keeping its trigger instant. */
export function convertEventToFixedTime(
  timeline: TimelinePackage,
  trackId: string,
  eventId: string,
): ConvertTimingResult {
  const track = timeline.tracks.find((candidate) => candidate.id === trackId);
  const event = track?.events.find((candidate) => candidate.id === eventId);
  if (!track || !event) return { ok: false, timeline, error: '找不到這個事件' };
  if (isAbsoluteTiming(event.timing)) return { ok: true, timeline };

  const resolved = resolveEventTiming(event, track.id, buildMechanicIndex(timeline));
  if (resolved.atMs === undefined) {
    return { ok: false, timeline, error: '連動來源已失效，無法換算固定時間' };
  }
  return { ok: true, timeline: pinDependentsToFixedTime(timeline, [{ track, event, resolved }]) };
}

/**
 * Link an event to a mechanic while keeping the *current* trigger instant.
 *
 * The offset of every cue is shifted by (oldEventAtMs - newSourceAtMs), so
 * confirming this never moves what the player actually hears (spec §6.1).
 */
export function linkEventToMechanic(
  timeline: TimelinePackage,
  trackId: string,
  eventId: string,
  sourceTrackId: string,
  sourceEventId: string,
  options: { preserveTriggerMs?: boolean } = {},
): ConvertTimingResult {
  const { preserveTriggerMs = true } = options;
  const track = timeline.tracks.find((candidate) => candidate.id === trackId);
  const event = track?.events.find((candidate) => candidate.id === eventId);
  if (!track || !event) return { ok: false, timeline, error: '找不到這個事件' };
  if (eventId === sourceEventId) return { ok: false, timeline, error: '事件不能連動到自己' };

  const sourceTrack = timeline.tracks.find((candidate) => candidate.id === sourceTrackId);
  const sourceEvent = sourceTrack?.events.find((candidate) => candidate.id === sourceEventId);
  if (!sourceTrack || !sourceEvent) return { ok: false, timeline, error: '找不到來源機制' };
  if (sourceTrack.type !== 'encounter') {
    return { ok: false, timeline, error: '只能連動到戰鬥軌道的機制' };
  }
  if (!isAbsoluteTiming(sourceEvent.timing)) {
    return { ok: false, timeline, error: '來源機制本身是連動事件，不支援連鎖連動' };
  }

  const index = buildMechanicIndex(timeline);
  const currentAtMs = resolveEventTiming(event, track.id, index).atMs;
  const sourceAtMs = sourceEvent.timing.atMs;
  const shift = preserveTriggerMs && currentAtMs !== undefined ? currentAtMs - sourceAtMs : 0;

  const next = updateEvent(timeline, trackId, eventId, (current) => {
    const linked: TimelineEvent = {
      ...current,
      timing: mechanicTiming(sourceTrackId, sourceEventId),
      cues: current.cues.map((cue) => ({ ...cue, offsetMs: cue.offsetMs + shift })),
    };
    // Phase now comes from the source; drop the frozen copy.
    delete linked.phase;
    return linked;
  });
  return { ok: true, timeline: next };
}

/** Move an absolute event. Linked events follow automatically via the resolver. */
export function setEventAbsoluteTime(
  timeline: TimelinePackage,
  trackId: string,
  eventId: string,
  atMs: number,
): ConvertTimingResult {
  if (!Number.isFinite(atMs)) return { ok: false, timeline, error: '時間必須是有限數值' };
  const track = timeline.tracks.find((candidate) => candidate.id === trackId);
  const event = track?.events.find((candidate) => candidate.id === eventId);
  if (!track || !event) return { ok: false, timeline, error: '找不到這個事件' };
  if (!isAbsoluteTiming(event.timing)) {
    return { ok: false, timeline, error: '這是連動事件，時間由來源機制決定' };
  }
  return {
    ok: true,
    timeline: updateEvent(timeline, trackId, eventId, (current) => ({
      ...current,
      timing: absoluteTiming(atMs),
    })),
  };
}

// ------------------------------------------------------------------ duplicates

/**
 * Duplicate one event.
 *
 * A copy of a *source* mechanic does not steal its dependents: existing
 * reminders keep pointing at the original. A copy of a *reminder* keeps
 * referencing the same source mechanic (spec §6.2).
 */
export function duplicateEvent(
  timeline: TimelinePackage,
  trackId: string,
  eventId: string,
): { timeline: TimelinePackage; eventId: string } {
  const track = timeline.tracks.find((candidate) => candidate.id === trackId);
  const source = track?.events.find((event) => event.id === eventId);
  if (!track || !source) return { timeline, eventId };

  const copy: TimelineEvent = {
    ...source,
    id: createId(),
    name: `${source.name}（複本）`,
    cues: source.cues.map((cue) => ({ ...cue, id: createId() })),
  };
  const index = track.events.findIndex((event) => event.id === eventId);
  const events = [...track.events];
  events.splice(index + 1, 0, copy);

  return {
    timeline: updateTrack(timeline, trackId, (candidate) => ({ ...candidate, events })),
    eventId: copy.id,
  };
}

export function addCue(
  timeline: TimelinePackage,
  trackId: string,
  eventId: string,
): { timeline: TimelinePackage; cueId: string } {
  const cue: TimelineCue = {
    id: createId(),
    offsetMs: -3000,
    text: '',
    priority: 'normal',
  };
  return {
    timeline: updateEvent(timeline, trackId, eventId, (event) => ({
      ...event,
      cues: [...event.cues, cue],
    })),
    cueId: cue.id,
  };
}

export function removeCue(
  timeline: TimelinePackage,
  trackId: string,
  eventId: string,
  cueId: string,
): TimelinePackage {
  return updateEvent(timeline, trackId, eventId, (event) => ({
    ...event,
    cues: event.cues.filter((cue) => cue.id !== cueId),
  }));
}

export function duplicateCue(
  timeline: TimelinePackage,
  trackId: string,
  eventId: string,
  cueId: string,
): TimelinePackage {
  return updateEvent(timeline, trackId, eventId, (event) => {
    const index = event.cues.findIndex((cue) => cue.id === cueId);
    if (index < 0) return event;
    const cues = [...event.cues];
    cues.splice(index + 1, 0, { ...event.cues[index], id: createId() });
    return { ...event, cues };
  });
}

/** Sort a track's events by resolved time — display order only, ids untouched. */
export function sortTrackEvents(timeline: TimelinePackage, trackId: string): TimelinePackage {
  const index = buildMechanicIndex(timeline);
  return updateTrack(timeline, trackId, (track) => {
    const at = (event: TimelineEvent) =>
      resolveEventTiming(event, track.id, index).atMs ?? Number.POSITIVE_INFINITY;
    return { ...track, events: [...track.events].sort((a, b) => at(a) - at(b)) };
  });
}
