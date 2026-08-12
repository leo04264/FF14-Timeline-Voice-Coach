import { describe, expect, it } from 'vitest';
import { compileTimeline, DEFAULT_AUDIO_CONFIG, TimelineCompileError } from './compiler';
import { EXAMPLE_TIMELINE } from './exampleTimeline';
import { matchesTarget, combineTargets, targetsCanOverlap } from './target';
import type { CueTarget, PlayerProfile, TimelinePackage } from './types';

const MT_PLD: PlayerProfile = { position: 'MT', job: 'PLD' };
const ALL_TRACKS = EXAMPLE_TIMELINE.tracks.map((track) => track.id);

function compile(profile: PlayerProfile, trackIds: string[] = ALL_TRACKS) {
  return compileTimeline(EXAMPLE_TIMELINE, { profile, enabledTrackIds: trackIds });
}

describe('target matching', () => {
  it('treats a missing target as ALL', () => {
    expect(matchesTarget(undefined, MT_PLD)).toBe(true);
  });

  it('ORs within a dimension and ANDs across dimensions', () => {
    const target: CueTarget = { positions: ['D2', 'D3'], jobs: ['DNC'] };
    expect(matchesTarget({ ...target }, { position: 'D3', job: 'DNC' })).toBe(true);
    expect(matchesTarget({ ...target }, { position: 'D2', job: 'DNC' })).toBe(true);
    // right position, wrong job
    expect(matchesTarget({ ...target }, { position: 'D3', job: 'BRD' })).toBe(false);
    // right job, wrong position
    expect(matchesTarget({ ...target }, { position: 'D4', job: 'DNC' })).toBe(false);
  });

  it('intersects track and cue targets', () => {
    const combined = combineTargets({ positions: ['H1', 'H2'] }, { positions: ['H1'] });
    expect(combined).toEqual({ positions: ['H1'] });
    expect(matchesTarget(combined, { position: 'H2', job: 'SCH' })).toBe(false);
  });

  it('detects mutually exclusive targets for collision analysis', () => {
    expect(targetsCanOverlap({ positions: ['MT'] }, { positions: ['D3'] })).toBe(false);
    expect(targetsCanOverlap({ positions: ['MT'] }, undefined)).toBe(true);
    expect(targetsCanOverlap({ positions: ['MT'] }, { jobs: ['PLD'] })).toBe(true);
  });
});

describe('compileTimeline', () => {
  it('filters by enabled tracks', () => {
    const compiled = compile(MT_PLD, ['example-track-boss']);
    expect(compiled.cues.every((cue) => cue.trackId === 'example-track-boss')).toBe(true);
  });

  it('filters by target, honouring the track target', () => {
    const mt = compile(MT_PLD);
    expect(mt.cues.map((cue) => cue.id)).toContain('example-cue-tb-mt');
    expect(mt.cues.map((cue) => cue.id)).not.toContain('example-cue-tb-st');
    // Healer track targets H1/H2 only
    expect(mt.cues.map((cue) => cue.id)).not.toContain('example-cue-heal-h1');

    const h1 = compile({ position: 'H1', job: 'WHM' });
    expect(h1.cues.map((cue) => cue.id)).toContain('example-cue-heal-h1');
    expect(h1.cues.map((cue) => cue.id)).not.toContain('example-cue-shield-h2');
  });

  it('computes triggerMs as event.atMs + cue.offsetMs', () => {
    const compiled = compile(MT_PLD);
    const tankBuster = compiled.cues.find((cue) => cue.id === 'example-cue-tb-mt');
    expect(tankBuster?.eventAtMs).toBe(48_000);
    expect(tankBuster?.offsetMs).toBe(-3000);
    expect(tankBuster?.triggerMs).toBe(45_000);
  });

  it('keeps negative-time cues', () => {
    const compiled = compile(MT_PLD);
    expect(compiled.cues[0].triggerMs).toBe(-2000);
  });

  it('drops disabled cues but keeps them in the source timeline', () => {
    const timeline: TimelinePackage = structuredClone(EXAMPLE_TIMELINE);
    timeline.tracks[0].events[0].cues[0].enabled = false;
    const compiled = compileTimeline(timeline, {
      profile: MT_PLD,
      enabledTrackIds: ALL_TRACKS,
    });
    expect(compiled.cues.map((cue) => cue.id)).not.toContain('example-cue-pull-warn');
    expect(timeline.tracks[0].events[0].cues).toHaveLength(1);
  });

  it('resolves audio defaults, cue overrides winning', () => {
    const timeline: TimelinePackage = structuredClone(EXAMPLE_TIMELINE);
    timeline.tracks[0].events[0].cues[0].audio = { rate: 2 };
    const compiled = compileTimeline(timeline, {
      profile: MT_PLD,
      enabledTrackIds: ALL_TRACKS,
      audioDefaults: { rate: 1.5, volume: 0.5 },
    });
    const cue = compiled.cues[0];
    expect(cue.audio.rate).toBe(2);
    expect(cue.audio.volume).toBe(0.5);
    expect(cue.audio.lang).toBe(DEFAULT_AUDIO_CONFIG.lang);
  });

  it('uses the countdown override without touching the timeline', () => {
    const compiled = compileTimeline(EXAMPLE_TIMELINE, {
      profile: MT_PLD,
      enabledTrackIds: ALL_TRACKS,
      countdownMs: 5000,
    });
    expect(compiled.countdownMs).toBe(5000);
    expect(EXAMPLE_TIMELINE.encounter.countdownMs).toBe(15_000);
  });

  it('refuses to compile a timeline with blocking errors', () => {
    const timeline: TimelinePackage = structuredClone(EXAMPLE_TIMELINE);
    timeline.tracks[0].events[0].cues[0].text = '   ';
    expect(() =>
      compileTimeline(timeline, { profile: MT_PLD, enabledTrackIds: ALL_TRACKS }),
    ).toThrow(TimelineCompileError);
  });
});

describe('deterministic sort', () => {
  const base: TimelinePackage = {
    schemaVersion: 1,
    id: 'sort-test',
    meta: { name: 'Sort', encounterId: 'sort' },
    encounter: { durationMs: 60_000, countdownMs: 0 },
    tracks: [
      {
        id: 'track-a',
        type: 'custom',
        name: 'A',
        enabledByDefault: true,
        events: [
          {
            id: 'event-a',
            atMs: 10_000,
            name: 'A',
            category: 'custom',
            cues: [
              { id: 'a-low', offsetMs: 0, text: 'low', priority: 'low' },
              { id: 'a-normal', offsetMs: 0, text: 'normal', priority: 'normal' },
            ],
          },
        ],
      },
      {
        id: 'track-b',
        type: 'custom',
        name: 'B',
        enabledByDefault: true,
        events: [
          {
            id: 'event-b',
            atMs: 10_000,
            name: 'B',
            category: 'custom',
            cues: [
              { id: 'b-high', offsetMs: 0, text: 'high', priority: 'high' },
              { id: 'b-normal', offsetMs: 0, text: 'normal', priority: 'normal' },
              { id: 'b-early', offsetMs: -5000, text: 'early', priority: 'low' },
            ],
          },
        ],
      },
    ],
  };

  it('orders by triggerMs, then priority, then track/event/cue order', () => {
    const compiled = compileTimeline(base, {
      profile: { position: 'MT', job: 'PLD' },
      enabledTrackIds: ['track-a', 'track-b'],
    });
    expect(compiled.cues.map((cue) => cue.id)).toEqual([
      'b-early',
      'b-high',
      'a-normal',
      'b-normal',
      'a-low',
    ]);
  });

  it('is stable across repeated compiles', () => {
    const options = {
      profile: { position: 'MT', job: 'PLD' } as const,
      enabledTrackIds: ['track-a', 'track-b'],
    };
    const first = compileTimeline(base, options).cues.map((cue) => cue.id);
    const second = compileTimeline(base, options).cues.map((cue) => cue.id);
    expect(first).toEqual(second);
  });
});
