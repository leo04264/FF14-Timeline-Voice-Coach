import { describe, expect, it } from 'vitest';
import fullPayload from '../../public/timelines/m6s-h1-astrologian.json';
import corePayload from '../../public/timelines/m6s-h1-astrologian-core.json';
import manifest from '../../public/timelines/index.json';
import { analyzeCollisions } from './collision';
import { compileTimeline } from './compiler';
import { parseAndValidateTimeline } from './validator';
import type { TimelineEvent } from './types';

const variants = [
  { payload: fullPayload, file: 'm6s-h1-astrologian.json', id: 'builtin-m6s-h1-astrologian', version: '0.4.0', full: true },
  { payload: corePayload, file: 'm6s-h1-astrologian-core.json', id: 'builtin-m6s-h1-astrologian-core', version: '0.2.0', full: false },
];

for (const variant of variants) {
  const result = parseAndValidateTimeline(variant.payload);
  if (!result.ok) throw new Error(JSON.stringify(result.report.issues));
  const timeline = result.timeline;
  const healing = timeline.tracks.find(track => track.id === 'h1-astrologian')!;
  const matching = (pattern: RegExp) => healing.events.filter(event => pattern.test(event.name));
  const at = (key: string) => {
    const event = healing.events.find(item => item.id === `m6s-ast-${key}`);
    if (!event) throw new Error(`Missing ${key}`);
    return event.atMs;
  };

  describe(`M6S H1 ${variant.full ? '完整' : '核心'}影片奶軸`, () => {
    it('keeps the existing manifest identity, enables every cue and validates without warnings', () => {
      expect(manifest).toContain(variant.file);
      expect(timeline.id).toBe(variant.id);
      expect(timeline.meta.version).toBe(variant.version);
      expect(timeline.meta.description).toContain('BV1XZ5FzCEdb?p=2');
      expect(result.report.issues).toEqual([]);
      expect(healing.target).toEqual({ positions: ['H1'], jobs: ['AST'] });
      for (const track of timeline.tracks) {
        expect(track.enabledByDefault).toBe(true);
        for (const event of track.events) {
          expect(event.cues.length).toBeGreaterThan(0);
          for (const cue of event.cues) expect(cue.enabled).toBe(true);
        }
      }
    });

    it('uses the verified shared boss baseline, including the first 41.2 s stack', () => {
      const boss = timeline.tracks.find(track => track.id === 'boss-mechanics')!;
      expect(boss.events.map(event => event.atMs)).toEqual([
        11300, 22400, 35100, 41200, 62100, 76600, 81900, 91300, 121700,
        141100, 155700, 172300, 189000, 199000, 207100, 217200, 227400,
        256500, 278600, 305500, 317700, 388700, 410900, 418900, 428300,
        448400, 473000, 490300, 511500, 515900, 529900, 546000, 556000,
        564900, 569100, 591300, 596300, 606400, 613300, 618600, 631000,
        637100, 653200, 658100, 680700,
      ]);
      const warnings = boss.events.map(event => event.atMs + event.cues[0].offsetMs);
      expect(warnings).toEqual([...warnings].sort((a, b) => a - b));
      for (const event of boss.events) {
        expect(event.cues[0].offsetMs).toBeLessThan(0);
        expect(event.cues[0].offsetMs).toBeGreaterThanOrEqual(-16000);
      }
    });

    it('has no voice collisions at 2000 ms and compiles all cues for H1 AST', () => {
      expect(analyzeCollisions(timeline).pairs.map(pair => ({
        a: pair.a.cueId, b: pair.b.cueId, gap: pair.gapMs,
      }))).toEqual([]);
      const compiled = compileTimeline(timeline, {
        profile: { position: 'H1', job: 'AST' },
        enabledTrackIds: timeline.tracks.map(track => track.id),
      });
      expect(compiled.cues).toHaveLength(timeline.tracks.flatMap(track => track.events.flatMap(event => event.cues)).length);
      for (let index = 1; index < compiled.cues.length; index += 1) {
        expect(compiled.cues[index].triggerMs - compiled.cues[index - 1].triggerMs).toBeGreaterThanOrEqual(2100);
      }
    });

    it('reminds DoT exactly every 30 seconds, including conditional add-target checks', () => {
      const dots = healing.events.filter(event => /^m6s-ast-dot-\d+$/.test(event.id));
      expect(dots.map(event => event.atMs + event.cues[0].offsetMs))
        .toEqual(Array.from({ length: 23 }, (_, index) => index * 30000));
      for (const dot of dots.filter(event => event.atMs >= 210000 && event.atMs <= 390000)) {
        expect(dot.cues[0].text).toContain('有目標');
        expect(dot.cues[0].text).toContain('換怪');
      }
      expect(at('add-target-dot')).toBeGreaterThanOrEqual(227400);
      expect(at('add-target-dot')).toBeLessThan(240000);
    });

    it('uses the JP PF on-recast Divination variant with an opener and W4 burst', () => {
      const casts = matching(/占卜/);
      expect(casts.map(event => event.atMs)).toEqual([12000, 132000, 252000, 372000, 492000, 612000]);
      expect(casts.map(event => event.atMs + event.cues[0].offsetMs)).toEqual(casts.map(event => event.atMs));
      expect(casts.map(event => event.phase)).toEqual(['P1', '沙漠', '動物園', '動物園', '河流', '終盤']);
      expect(casts[0].cues[0].text).toContain('開場爆發');
      expect(casts[3].name).toContain('W4 後半');
      expect(casts[3].cues[0].text).toContain('四波爆發');
      expect(timeline.meta.strategy).toContain('日服野團轉好爆發');
      expect(timeline.meta.description).toContain('https://xivjpraids.com/7.0_dawntrail/savage_raids/m6s/');
      expect(timeline.meta.description).toContain('如採延後版須同步後續占卜');
    });

    it('puts the add-phase bursts across W1/W2 and in late W4, not at the W4 spawn', () => {
      const boss = timeline.tracks.find(track => track.id === 'boss-mechanics')!;
      const bossAt = (id: string) => boss.events.find(event => event.id === `m6s-boss-${id}`)!.atMs;
      const firstAddsBurst = at('divination-252');
      expect(firstAddsBurst).toBeGreaterThan(bossAt('wave1'));
      expect(firstAddsBurst).toBeLessThan(bossAt('wave2'));
      expect(firstAddsBurst + 20000).toBeGreaterThan(bossAt('wave2'));
      const fourthWaveBurst = at('divination-372');
      expect(fourthWaveBurst).toBeGreaterThan((bossAt('wave4') + bossAt('ready2')) / 2);
      expect(fourthWaveBurst).toBeLessThan(bossAt('ready2'));
      expect(fourthWaveBurst - firstAddsBurst).toBe(120000);
    });

    it.each([
      ['占卜', /占卜/, 120000],
      ['地星', /放置地星/, 60000],
      ['命運之輪', /命運之輪/, 60000],
      ['沖日', /沖日/, 60000],
      ['天宮圖', /開啟天宮圖/, 60000],
      ['擢升', /擢升/, 60000],
      ['中間學派', /中間學派/, 120000],
      ['大宇宙', /大宇宙/, 180000],
    ] as const)('%s never precedes cooldown recovery', (_name, pattern, recast) => {
      const casts = matching(pattern);
      expect(casts.length).toBeGreaterThan(1);
      for (let index = 1; index < casts.length; index += 1) {
        expect(casts[index].atMs - casts[index - 1].atMs,
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
      for (const cast of matching(pattern)) {
        while (nextRecharge !== undefined && nextRecharge <= cast.atMs) {
          charges += 1;
          nextRecharge = charges < maximum ? nextRecharge + recast : undefined;
        }
        expect(charges, cast.id).toBeGreaterThan(0);
        charges -= 1;
        nextRecharge ??= cast.atMs + recast;
      }
    });

    it('matures and resolves all 11 Earthly Stars before they expire', () => {
      const placements = matching(/放置地星/);
      const detonations = matching(/引爆地星|地星自爆/);
      expect(placements).toHaveLength(11);
      expect(detonations).toHaveLength(placements.length);
      placements.forEach((place, index) => {
        const detonation = detonations[index];
        const elapsed = detonation.atMs - place.atMs;
        if (detonation.name.includes('地星自爆')) expect(elapsed, detonation.id).toBe(20000);
        else {
          expect(elapsed, detonation.id).toBeGreaterThanOrEqual(10000);
          expect(elapsed, detonation.id).toBeLessThan(20000);
        }
      });
    });

    it('upgrades each Horoscope and resolves it inside the upgraded duration', () => {
      const starts = matching(/開啟天宮圖/);
      const pops = matching(/引爆天宮圖/);
      expect(starts).toHaveLength(variant.full ? 6 : 5);
      expect(pops).toHaveLength(starts.length);
      starts.forEach((start, index) => {
        expect(start.name).toContain('陽星合相');
        const elapsed = pops[index].atMs - (start.atMs + 1500);
        expect(elapsed, pops[index].id).toBeGreaterThan(0);
        expect(elapsed, pops[index].id).toBeLessThan(30000);
      });
    });

    it('uses Macrocosmos on the video mechanic groups, not the cactus or first meteor', () => {
      expect(matching(/大宇宙/).map(event => event.atMs)).toEqual([147500, 327500, 604500]);
      const starts = matching(/大宇宙/);
      const pops = matching(/小宇宙/);
      expect(pops).toHaveLength(3);
      starts.forEach((start, index) => {
        expect(pops[index].atMs - start.atMs).toBeGreaterThan(0);
        expect(pops[index].atMs - start.atMs).toBeLessThan(15000);
      });
      expect(at('macro1')).toBeLessThan(149700);
      expect(at('micro1')).toBeGreaterThan(155700);
      expect(at('macro2')).toBeGreaterThan(317700);
      expect(at('macro3')).toBeLessThan(607300);
      expect(at('micro3')).toBeGreaterThan(613300);
      expect(at('micro3')).toBeLessThan(618600);
      expect(matching(/大宇宙/).filter(event => event.name.includes('沖日'))).toHaveLength(2);
    });

    it('uses Neutral Sect on third-wave adds and carries the river shield into the next mechanic', () => {
      const neutral = matching(/中間學派/);
      const sun = matching(/太陽星座/);
      expect(neutral).toHaveLength(5);
      expect(sun).toHaveLength(neutral.length);
      neutral.forEach((cast, index) => {
        expect(sun[index].atMs - cast.atMs).toBeGreaterThanOrEqual(0);
        expect(sun[index].atMs - cast.atMs).toBeLessThan(30000);
        const shield = matching(/陽星合相/).find(event =>
          !event.name.includes('無牌') && event.atMs >= cast.atMs && event.atMs + 1500 < cast.atMs + 20000);
        expect(shield, cast.id).toBeDefined();
      });
      expect(at('neutral3')).toBeGreaterThan(278600);
      expect(at('neutral3')).toBeLessThan(305500);
      expect(at('sun3')).toBeLessThan(305500);
      expect(at('neutral4-wheel6')).toBeLessThan(515900);
      const refreshedShield = at('neutral4-refresh') + 1500;
      expect(refreshedShield).toBeLessThan(at('neutral4-wheel6') + 20000);
      expect(refreshedShield + 30000).toBeGreaterThan(557100);
      expect(at('sun4')).toBeLessThan(546000);
      expect(at('sun4') + 15000).toBeGreaterThan(557100);
    });

    it('labels Lady of Crowns as conditional, not guaranteed at every timestamp', () => {
      const ladies = matching(/王冠之淑女/);
      expect(ladies).toHaveLength(5);
      for (const lady of ladies) {
        expect(lady.name).toContain('無牌改陽星合相');
        expect(lady.cues[0].text).toContain('有貴婦');
      }
    });
  });
}

it('shares boss timings and core instructions between both M6S H1 variants', () => {
  expect(fullPayload.tracks[0]).toEqual(corePayload.tracks[0]);
  const fullEvents: TimelineEvent[] = fullPayload.tracks[1].events as TimelineEvent[];
  for (const event of corePayload.tracks[1].events) {
    expect(fullEvents.find(item => item.id === event.id), event.id).toEqual(event);
  }
  expect(fullEvents.length).toBeGreaterThan(corePayload.tracks[1].events.length);
});
