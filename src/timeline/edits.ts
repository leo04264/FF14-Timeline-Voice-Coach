import { createId } from './ids';
import type {
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

export function addTrack(timeline: TimelinePackage, name = 'New Track'): TimelinePackage {
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
    name: `${source.name} (Copy)`,
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
    name: 'New Event',
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
    name: `${source.name} (Copy)`,
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
