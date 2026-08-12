import { describe, expect, it } from 'vitest';
import { analyzeCollisions, DEFAULT_COLLISION_WINDOW_MS } from './collision';
import type { TimelinePackage } from './types';

function timeline(partial: Partial<TimelinePackage> = {}): TimelinePackage {
  return {
    schemaVersion: 1,
    id: 'collision-test',
    meta: { name: 'Collision', encounterId: 'test' },
    encounter: { durationMs: 60_000, countdownMs: 0 },
    tracks: [],
    ...partial,
  };
}

function trackWithCues(
  id: string,
  cues: { id: string; atMs: number; text?: string; priority?: 'low' | 'normal' | 'high'; target?: unknown; enabled?: boolean }[],
  trackTarget?: unknown,
): TimelinePackage['tracks'][number] {
  return {
    id,
    type: 'custom',
    name: id,
    enabledByDefault: true,
    target: trackTarget as never,
    events: cues.map((cue) => ({
      id: `${cue.id}-event`,
      atMs: cue.atMs,
      name: cue.id,
      category: 'custom' as const,
      cues: [
        {
          id: cue.id,
          offsetMs: 0,
          text: cue.text ?? cue.id,
          priority: cue.priority,
          target: cue.target as never,
          enabled: cue.enabled,
        },
      ],
    })),
  };
}

describe('collision detection', () => {
  it('flags cues inside the window', () => {
    const report = analyzeCollisions(
      timeline({
        tracks: [
          trackWithCues('t1', [
            { id: 'a', atMs: 10_000 },
            { id: 'b', atMs: 11_000 },
          ]),
        ],
      }),
    );
    expect(report.windowMs).toBe(DEFAULT_COLLISION_WINDOW_MS);
    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0].gapMs).toBe(1000);
    expect(report.byCueId.get('a')).toHaveLength(1);
  });

  it('ignores cues outside the window', () => {
    const report = analyzeCollisions(
      timeline({
        tracks: [
          trackWithCues('t1', [
            { id: 'a', atMs: 10_000 },
            { id: 'b', atMs: 13_000 },
          ]),
        ],
      }),
      2000,
    );
    expect(report.pairs).toHaveLength(0);
  });

  it('respects a custom window', () => {
    const source = timeline({
      tracks: [
        trackWithCues('t1', [
          { id: 'a', atMs: 10_000 },
          { id: 'b', atMs: 12_500 },
        ]),
      ],
    });
    expect(analyzeCollisions(source, 2000).pairs).toHaveLength(0);
    expect(analyzeCollisions(source, 3000).pairs).toHaveLength(1);
  });

  it('does not flag mutually exclusive targets', () => {
    const report = analyzeCollisions(
      timeline({
        tracks: [
          trackWithCues('t1', [
            { id: 'mt', atMs: 10_000, target: { positions: ['MT'] } },
            { id: 'd3', atMs: 10_500, target: { positions: ['D3'] } },
          ]),
        ],
      }),
    );
    expect(report.pairs).toHaveLength(0);
  });

  it('intersects the track target when deciding overlap', () => {
    const report = analyzeCollisions(
      timeline({
        tracks: [
          trackWithCues('healer', [{ id: 'h1', atMs: 10_000, target: { positions: ['H1'] } }], {
            positions: ['H1', 'H2'],
          }),
          trackWithCues('boss', [{ id: 'all', atMs: 10_400 }]),
        ],
      }),
    );
    expect(report.pairs).toHaveLength(1);
  });

  it('marks same-priority collisions as more severe', () => {
    const same = analyzeCollisions(
      timeline({
        tracks: [
          trackWithCues('t1', [
            { id: 'a', atMs: 10_000, priority: 'high' },
            { id: 'b', atMs: 10_500, priority: 'high' },
          ]),
        ],
      }),
    );
    expect(same.pairs[0].severity).toBe('severe');

    const mixed = analyzeCollisions(
      timeline({
        tracks: [
          trackWithCues('t1', [
            { id: 'a', atMs: 10_000, priority: 'high' },
            { id: 'b', atMs: 10_500, priority: 'low' },
          ]),
        ],
      }),
    );
    expect(mixed.pairs[0].severity).toBe('warning');
  });

  it('ignores disabled cues', () => {
    const report = analyzeCollisions(
      timeline({
        tracks: [
          trackWithCues('t1', [
            { id: 'a', atMs: 10_000 },
            { id: 'b', atMs: 10_500, enabled: false },
          ]),
        ],
      }),
    );
    expect(report.pairs).toHaveLength(0);
  });

  it('never mutates or removes cues', () => {
    const source = timeline({
      tracks: [
        trackWithCues('t1', [
          { id: 'a', atMs: 10_000 },
          { id: 'b', atMs: 10_100 },
        ]),
      ],
    });
    analyzeCollisions(source);
    expect(source.tracks[0].events).toHaveLength(2);
  });
});
