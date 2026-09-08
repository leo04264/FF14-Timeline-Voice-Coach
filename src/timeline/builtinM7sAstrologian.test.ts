import { describe, expect, it } from 'vitest';
import payload from '../../public/timelines/m7s-h1-astrologian.json';
import manifest from '../../public/timelines/index.json';
import { analyzeCollisions } from './collision';
import { migrateTimeline } from './migration';
import { absoluteAtMs } from './resolveEventTiming';

/**
 * The shipped JSON is still schemaVersion 1 (spec §3.3.6 — no mass rewrite of
 * timelines just to bump the version); the loader migrates it, so these tests
 * read it exactly the way the app does.
 */
const migrated = (payload: unknown): unknown => {
  const result = migrateTimeline(payload);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
import { compileTimeline } from './compiler';
import { parseAndValidateTimeline } from './validator';

const result = parseAndValidateTimeline(migrated(payload));
if (!result.ok) throw new Error('M7S H1 範例格式錯誤');
const timeline = result.timeline;
const healing = timeline.tracks.find(track => track.id === 'h1-astrologian')!;
const events = healing.events;
const matching = (pattern: RegExp) => events.filter(event => pattern.test(event.name));
const event = (key: string) => {
  const found = events.find(item => item.id === `m7s-ast-${key}`);
  if (!found) throw new Error(`缺少事件 ${key}`);
  return found;
};

describe('M7S H1 影片奶軸', () => {
  it('keeps the existing built-in identity and passes structural/domain validation', () => {
    expect(manifest).toContain('m7s-h1-astrologian.json');
    expect(timeline.id).toBe('builtin-m7s-h1-astrologian');
    expect(timeline.meta.version).toBe('0.2.0');
    expect(timeline.meta.description).toContain('BV1XZ5FzCEdb?p=3');
    expect(result.report.issues).toEqual([]);
    expect(healing.target).toEqual({ positions: ['H1'], jobs: ['AST'] });
  });

  it('preserves all 40 boss damage/mechanic timings', () => {
    const boss = timeline.tracks.find(track => track.id === 'boss-mechanics')!;
    expect(boss.events.map(item => absoluteAtMs(item))).toEqual([
      10500, 34100, 48400, 60800, 65400, 93400, 105400, 110600,
      119600, 127300, 148000, 189200, 195200, 206300, 222500, 231600,
      251600, 257600, 266700, 281100, 319100, 334000, 340000, 352100,
      381500, 409000, 426300, 432300, 441500, 476500, 495700, 512700,
      541700, 550000, 579600, 595400, 611200, 628400, 637400, 669500,
    ]);
    const warnings = boss.events.map(item => absoluteAtMs(item) + item.cues[0].offsetMs);
    expect(warnings).toEqual([...warnings].sort((a, b) => a - b));
  });

  it('has no enabled voice collisions at the default 2000 ms window', () => {
    for (const track of timeline.tracks) {
      expect(track.enabledByDefault).toBe(true);
      for (const item of track.events) {
        expect(item.cues.length).toBeGreaterThan(0);
        for (const cue of item.cues) expect(cue.enabled).toBe(true);
      }
    }
    expect(analyzeCollisions(timeline).pairs.map(pair => ({
      a: pair.a.eventId,
      b: pair.b.eventId,
      gap: pair.gapMs,
    }))).toEqual([]);
  });

  it.each([
    ['地星', /放置地星/, 60000],
    ['命運之輪', /命運之輪/, 60000],
    ['沖日', /沖日/, 60000],
    ['天宮圖', /開啟天宮圖/, 60000],
    ['擢升', /擢升/, 60000],
    ['中間學派', /中間學派/, 120000],
    ['占卜', /占卜/, 120000],
    ['大宇宙', /大宇宙/, 180000],
  ] as const)('%s is never requested before its cooldown recovers', (_name, pattern, recast) => {
    const casts = matching(pattern);
    expect(casts.length).toBeGreaterThan(1);
    for (let index = 1; index < casts.length; index += 1) {
      expect(absoluteAtMs(casts[index]) - absoluteAtMs(casts[index - 1]),
        `${casts[index - 1].id} → ${casts[index].id}`).toBeGreaterThanOrEqual(recast);
    }
  });

  it.each([
    ['光速', /光速/, 60000, 2],
    ['天星交錯', /天星交錯/, 30000, 2],
    ['先天卜卦', /先天卜卦/, 40000, 3],
  ] as const)('%s respects sequential charge recovery', (_name, pattern, recast, maximum) => {
    let charges: number = maximum;
    let nextRecharge: number | undefined;
    const casts = matching(pattern);
    expect(casts.length).toBeGreaterThan(0);
    for (const cast of casts) {
      while (nextRecharge !== undefined && nextRecharge <= absoluteAtMs(cast)) {
        charges += 1;
        nextRecharge = charges < maximum ? nextRecharge + recast : undefined;
      }
      expect(charges, cast.id).toBeGreaterThan(0);
      charges -= 1;
      nextRecharge ??= absoluteAtMs(cast) + recast;
    }
  });

  it('pairs each mature Earthly Star with one detonation before expiry', () => {
    const places = matching(/放置地星/);
    const detonations = matching(/引爆地星|地星自爆/);
    expect(places).toHaveLength(11);
    expect(detonations).toHaveLength(places.length);
    places.forEach((place, index) => {
      const detonation = detonations[index];
      const delay = absoluteAtMs(detonation) - absoluteAtMs(place);
      if (detonation.name.includes('地星自爆')) {
        expect(delay, detonation.id).toBe(20000);
      } else {
        expect(delay, detonation.id).toBeGreaterThanOrEqual(10000);
        expect(delay, detonation.id).toBeLessThan(20000);
      }
      if (places[index + 1]) expect(absoluteAtMs(detonation)).toBeLessThan(absoluteAtMs(places[index + 1]));
    });
  });

  it('upgrades each Horoscope with Helios Conjunction and triggers it inside 30 seconds', () => {
    const starts = matching(/開啟天宮圖/);
    const pops = matching(/引爆天宮圖/);
    expect(starts).toHaveLength(8);
    expect(pops).toHaveLength(starts.length);
    starts.forEach((start, index) => {
      expect(start.name).toContain('陽星合相');
      // The instruction means Horoscope, then a 1.5 s Helios Conjunction cast.
      const upgradeAt = absoluteAtMs(start) + 1500;
      expect(absoluteAtMs(pops[index]) - upgradeAt, pops[index].id).toBeGreaterThan(0);
      expect(absoluteAtMs(pops[index]) - upgradeAt, pops[index].id).toBeLessThan(30000);
    });
  });

  it('resolves all Macrocosmos casts within 15 seconds', () => {
    const starts = matching(/大宇宙/);
    const pops = matching(/小宇宙/);
    expect(starts).toHaveLength(3);
    expect(pops).toHaveLength(starts.length);
    starts.forEach((start, index) => {
      expect(absoluteAtMs(pops[index]) - absoluteAtMs(start)).toBeGreaterThan(0);
      expect(absoluteAtMs(pops[index]) - absoluteAtMs(start)).toBeLessThan(15000);
    });
  });

  it('pairs Sun Sign with Neutral Sect and covers the intended damage windows', () => {
    const neutral = matching(/中間學派/);
    const sun = matching(/太陽星座/);
    const damageWindows = [[105400, 110600], [299000, 309000], [441500, 448500], [637400, 644400]];
    expect(neutral).toHaveLength(4);
    expect(sun).toHaveLength(neutral.length);
    neutral.forEach((start, index) => {
      expect(absoluteAtMs(sun[index]) - absoluteAtMs(start)).toBeGreaterThanOrEqual(0);
      expect(absoluteAtMs(sun[index]) - absoluteAtMs(start)).toBeLessThan(30000);
      expect(absoluteAtMs(sun[index])).toBeLessThan(damageWindows[index][0]);
      expect(absoluteAtMs(sun[index]) + 15000).toBeGreaterThan(damageWindows[index][1]);
      const shields = matching(/陽星合相/).filter(item =>
        absoluteAtMs(item) >= absoluteAtMs(start) && absoluteAtMs(item) + 1500 < absoluteAtMs(start) + 20000);
      expect(shields.length, start.id).toBeGreaterThan(0);
    });
  });

  it('uses the video opener and reserves Macrocosmos for the video mechanic groups', () => {
    expect(absoluteAtMs(event('pre-horo'))).toBe(-10000);
    expect(absoluteAtMs(event('pre-star'))).toBe(-5000);
    expect(absoluteAtMs(event('macro1'))).toBeGreaterThan(65000);
    expect(absoluteAtMs(event('macro1-pop'))).toBeLessThan(93400);
    expect(absoluteAtMs(event('neutral1'))).toBeLessThan(105400);
    expect(absoluteAtMs(event('macro2'))).toBeLessThan(409000);
    expect(absoluteAtMs(event('macro2-pop'))).toBeGreaterThan(409000);
    expect(absoluteAtMs(event('macro3'))).toBeLessThan(637400);
    expect(absoluteAtMs(event('macro3-pop'))).toBeGreaterThan(644400);
    expect(matching(/大宇宙/).filter(item => item.phase === 'P2')).toEqual([]);
    for (const lady of matching(/王冠之淑女/)) {
      expect(lady.name).toContain('無牌改陽星合相');
      expect(lady.cues[0].text).toContain('有貴婦');
    }
  });

  it('keeps a legal 120 second Divination rhythm outside forced downtime', () => {
    expect(matching(/占卜/).map(item => absoluteAtMs(item))).toEqual([
      11500, 131500, 251500, 371500, 491500, 611500,
    ]);
    const offensive = matching(/占卜|焚灼/);
    for (const cast of offensive) {
      expect(absoluteAtMs(cast) >= 148000 && absoluteAtMs(cast) < 163500, cast.id).toBe(false);
      expect(absoluteAtMs(cast) >= 352100 && absoluteAtMs(cast) < 369500, cast.id).toBe(false);
    }
  });

  it('compiles every boss and H1 cue for an H1 astrologian', () => {
    const compiled = compileTimeline(timeline, {
      profile: { position: 'H1', job: 'AST' },
      enabledTrackIds: timeline.tracks.map(track => track.id),
    });
    expect(compiled.cues).toHaveLength(timeline.tracks.reduce((count, track) =>
      count + track.events.reduce((total, item) => total + item.cues.length, 0), 0));
  });
});
