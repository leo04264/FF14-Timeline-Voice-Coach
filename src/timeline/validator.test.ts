import { describe, expect, it } from 'vitest';
import { EXAMPLE_TIMELINE } from './exampleTimeline';
import { parseTimelinePackage } from './schema';
import { cueTextLengthLevel, parseAndValidateTimeline, validateTimeline } from './validator';
import type { TimelinePackage } from './types';

function clone(): TimelinePackage {
  return structuredClone(EXAMPLE_TIMELINE);
}

describe('zod schema', () => {
  it('accepts the example timeline', () => {
    const result = parseTimelinePackage(EXAMPLE_TIMELINE);
    expect(result.ok).toBe(true);
  });

  it('rejects NaN and Infinity times', () => {
    const timeline = clone() as unknown as Record<string, unknown>;
    const bad = clone();
    bad.tracks[0].events[0].atMs = Number.NaN;
    expect(parseTimelinePackage(bad).ok).toBe(false);

    const infinite = clone();
    infinite.tracks[0].events[0].cues[0].offsetMs = Number.POSITIVE_INFINITY;
    expect(parseTimelinePackage(infinite).ok).toBe(false);

    expect(timeline).toBeDefined();
  });

  it('rejects unknown schema versions', () => {
    const bad = { ...clone(), schemaVersion: 2 };
    expect(parseTimelinePackage(bad).ok).toBe(false);
  });

  it('rejects unknown enum values', () => {
    const bad = clone() as unknown as {
      tracks: { events: { category: string }[] }[];
    };
    bad.tracks[0].events[0].category = 'nonsense';
    expect(parseTimelinePackage(bad).ok).toBe(false);
  });
});

describe('domain validation', () => {
  it('reports no blocking errors for the example timeline', () => {
    const report = validateTimeline(EXAMPLE_TIMELINE);
    expect(report.hasBlockingError).toBe(false);
  });

  it('flags duplicate ids at every level as blocking', () => {
    const duplicateTrack = clone();
    duplicateTrack.tracks.push({ ...duplicateTrack.tracks[0] });
    expect(validateTimeline(duplicateTrack).errors.some((i) => i.code === 'track.duplicate-id')).toBe(
      true,
    );

    const duplicateEvent = clone();
    duplicateEvent.tracks[1].events[0].id = duplicateEvent.tracks[0].events[0].id;
    expect(validateTimeline(duplicateEvent).errors.some((i) => i.code === 'event.duplicate-id')).toBe(
      true,
    );

    const duplicateCue = clone();
    duplicateCue.tracks[1].events[0].cues[0].id = duplicateCue.tracks[0].events[0].cues[0].id;
    expect(validateTimeline(duplicateCue).errors.some((i) => i.code === 'cue.duplicate-id')).toBe(
      true,
    );
  });

  it('flags an event after the encounter duration', () => {
    const timeline = clone();
    timeline.tracks[0].events[0].atMs = timeline.encounter.durationMs + 1;
    const report = validateTimeline(timeline);
    expect(report.errors.some((issue) => issue.code === 'event.after-duration')).toBe(true);
    expect(report.hasBlockingError).toBe(true);
  });

  it('flags a cue triggering before the countdown', () => {
    const timeline = clone();
    timeline.tracks[0].events[0].cues[0].offsetMs = -(timeline.encounter.countdownMs + 1000);
    const report = validateTimeline(timeline);
    expect(report.errors.some((issue) => issue.code === 'cue.before-countdown')).toBe(true);
  });

  it('never auto-fixes invalid times', () => {
    const timeline = clone();
    timeline.tracks[0].events[0].atMs = 999_999;
    validateTimeline(timeline);
    expect(timeline.tracks[0].events[0].atMs).toBe(999_999);
  });

  it('treats empty cue text as blocking', () => {
    const timeline = clone();
    timeline.tracks[0].events[0].cues[0].text = '  ';
    expect(validateTimeline(timeline).errors.some((i) => i.code === 'cue.empty-text')).toBe(true);
  });

  it('treats empty tracks and events as warnings only', () => {
    const timeline = clone();
    timeline.tracks.push({
      id: 'empty-track',
      type: 'custom',
      name: 'Empty',
      enabledByDefault: false,
      events: [],
    });
    timeline.tracks[0].events.push({
      id: 'empty-event',
      atMs: 1000,
      name: 'Empty',
      category: 'custom',
      cues: [],
    });
    const report = validateTimeline(timeline);
    expect(report.hasBlockingError).toBe(false);
    expect(report.warnings.some((i) => i.code === 'track.no-events')).toBe(true);
    expect(report.warnings.some((i) => i.code === 'event.no-cues')).toBe(true);
  });

  it('warns on long cue text without blocking', () => {
    expect(cueTextLengthLevel('三秒後坦克死刑')).toBe('ok');
    expect(cueTextLengthLevel('一'.repeat(16))).toBe('warning');
    expect(cueTextLengthLevel('一'.repeat(26))).toBe('severe');

    const timeline = clone();
    timeline.tracks[0].events[0].cues[0].text = '一'.repeat(30);
    const report = validateTimeline(timeline);
    expect(report.hasBlockingError).toBe(false);
    expect(report.warnings.some((i) => i.code === 'cue.text-very-long')).toBe(true);
  });

  it('carries a location so the editor can jump to the issue', () => {
    const timeline = clone();
    timeline.tracks[0].events[0].cues[0].text = '';
    const issue = validateTimeline(timeline).errors[0];
    expect(issue.trackId).toBe(timeline.tracks[0].id);
    expect(issue.eventId).toBe(timeline.tracks[0].events[0].id);
    expect(issue.cueId).toBe(timeline.tracks[0].events[0].cues[0].id);
    expect(issue.field).toBe('text');
  });
});

describe('parseAndValidateTimeline', () => {
  it('surfaces schema failures as errors', () => {
    const result = parseAndValidateTimeline({ schemaVersion: 1 });
    expect(result.ok).toBe(false);
    expect(result.report.hasBlockingError).toBe(true);
  });

  it('returns the parsed timeline with its report', () => {
    const result = parseAndValidateTimeline(EXAMPLE_TIMELINE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.timeline.id).toBe(EXAMPLE_TIMELINE.id);
  });
});
