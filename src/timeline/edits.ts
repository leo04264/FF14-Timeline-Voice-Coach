import { createId } from './ids';
import type {
  CuePriority,
  EventCategory,
  TimelineCue,
  TimelineEvent,
  TimelinePackage,
  TimelineTrack,
} from './types';

/**
 * Pure immutable edit helpers for the editor. Keeping them out of components
 * means undo/redo just swaps whole documents.
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

export function removeTrack(timeline: TimelinePackage, trackId: string): TimelinePackage {
  return { ...timeline, tracks: timeline.tracks.filter((track) => track.id !== trackId) };
}

export function duplicateTrack(timeline: TimelinePackage, trackId: string): TimelinePackage {
  const source = timeline.tracks.find((track) => track.id === trackId);
  if (!source) return timeline;
  const copy: TimelineTrack = {
    ...source,
    id: createId(),
    name: `${source.name}（複本）`,
    events: source.events.map((event) => ({
      ...event,
      id: createId(),
      cues: event.cues.map((cue) => ({ ...cue, id: createId() })),
    })),
  };
  const index = timeline.tracks.findIndex((track) => track.id === trackId);
  const tracks = [...timeline.tracks];
  tracks.splice(index + 1, 0, copy);
  return { ...timeline, tracks };
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
    atMs,
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

export interface AppendMechanicActionInput {
  eventName: string;
  category: EventCategory;
  cueText: string;
  cueOffsetMs: number;
  priority: CuePriority;
}

export type AppendMechanicActionResult =
  | { ok: true; timeline: TimelinePackage; eventId: string; cueId: string }
  | { ok: false; timeline: TimelinePackage; error: string };

/**
 * Create a regular target-track event anchored to an encounter event's time.
 *
 * This is deliberately a materialised copy, not a persistent cross-track link:
 * changing the encounter event later does not move the new event. Keeping the
 * stored shape unchanged preserves schema v1 import/export and the compiler.
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

  const triggerMs = sourceEvent.atMs + input.cueOffsetMs;
  if (triggerMs < -timeline.encounter.countdownMs) {
    return { ok: false, timeline, error: '提示時間早於倒數開始' };
  }
  if (triggerMs > timeline.encounter.durationMs) {
    return { ok: false, timeline, error: '提示時間超過戰鬥全長' };
  }

  const cueId = createId();
  const eventId = createId();
  const actionEvent: TimelineEvent = {
    id: eventId,
    atMs: sourceEvent.atMs,
    name: input.eventName.trim(),
    phase: sourceEvent.phase,
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

  const events = [...targetTrack.events];
  const insertAt = events.findIndex((event) => event.atMs > actionEvent.atMs);
  events.splice(insertAt < 0 ? events.length : insertAt, 0, actionEvent);

  return {
    ok: true,
    timeline: updateTrack(timeline, targetTrack.id, (track) => ({ ...track, events })),
    eventId,
    cueId,
  };
}

export function removeEvent(
  timeline: TimelinePackage,
  trackId: string,
  eventId: string,
): TimelinePackage {
  return updateTrack(timeline, trackId, (track) => ({
    ...track,
    events: track.events.filter((event) => event.id !== eventId),
  }));
}

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

/** Sort a track's events by time — display order only, ids are untouched. */
export function sortTrackEvents(timeline: TimelinePackage, trackId: string): TimelinePackage {
  return updateTrack(timeline, trackId, (track) => ({
    ...track,
    events: [...track.events].sort((a, b) => a.atMs - b.atMs),
  }));
}
