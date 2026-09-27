import { describe, expect, it } from 'vitest';
import payload from '../../public/timelines/m8s-h2-scholar.json';
import manifest from '../../public/timelines/index.json';
import { migrateTimeline } from './migration';
import { parseAndValidateTimeline } from './validator';
import { analyzeCollisions } from './collision';
import { buildPlaybackPlan } from './playbackPlan';
import { absoluteAtMs } from './resolveEventTiming';
import { DEFAULT_SETTINGS } from '../storage/settings';
import type { PlayerProfile, TimelineEvent } from './types';

const migrated = migrateTimeline(payload);
if (!migrated.ok) throw new Error(migrated.error);
const result = parseAndValidateTimeline(migrated.value);
if (!result.ok) throw new Error('M8S H2 學者格式錯誤');
const timeline = result.timeline;
const healing = timeline.tracks.find(track => track.id === 'h2-scholar')!;
const boss = timeline.tracks.find(track => track.id === 'boss-mechanics')!;
const at = (event: TimelineEvent) => absoluteAtMs(event);
// Only the action list before ： is a cast; notes may mention reserving a skill.
const actions = (event: TimelineEvent) => event.name.split('：')[0];
const casts = (pattern: RegExp) => healing.events.filter(event => pattern.test(actions(event)));
const event = (key: string) => {
  const found = healing.events.find(item => item.id === `m8s-sch-${key}`);
  if (!found) throw new Error(`缺少 ${key}`);
  return found;
};
const bossAt = (key: string) => at(boss.events.find(item => item.id === `m8s-boss-${key}`)!);
const planFor = (profile: PlayerProfile, countdownMs = 10_000) => buildPlaybackPlan({
  timeline,
  profile,
  enabledTrackIds: timeline.tracks.map(track => track.id),
  countdownMs,
  audio: DEFAULT_SETTINGS.audio,
  collisionWindowMs: DEFAULT_SETTINGS.collisionWindowMs,
  maxLateMs: DEFAULT_SETTINGS.maxLateMs,
  sessionOffsetMs: 0,
  speechSupported: true,
});

describe('M8S H2 學者影片奶軸', () => {
  it('is discoverable, valid, and explicitly scoped to H2 SCH', () => {
    expect(manifest.filter(file => file === 'm8s-h2-scholar.json')).toHaveLength(1);
    expect(timeline.id).toBe('builtin-m8s-h2-scholar');
    expect(timeline.meta.description).toContain('BV1Vc3Nz7Ejd');
    expect(timeline.meta.description).toContain('非逐鍵轉錄');
    expect(result.report.issues).toEqual([]);
    expect(healing.target).toEqual({ positions: ['H2'], jobs: ['SCH'] });
  });

  it('keeps every cue enabled without collisions in the default 2 second window', () => {
    for (const track of timeline.tracks) {
      expect(track.enabledByDefault).toBe(true);
      const times = track.events.map(at);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      for (const item of track.events) {
        expect(item.cues.length).toBeGreaterThan(0);
        for (const cue of item.cues) expect(cue.enabled).toBe(true);
      }
    }
    expect(analyzeCollisions(timeline).pairs.map(pair => [pair.a.eventId, pair.b.eventId])).toEqual([]);
    const warnings = boss.events.map(item => at(item) + item.cues[0].offsetMs);
    expect(warnings).toEqual([...warnings].sort((a, b) => a - b));
    for (const item of boss.events) expect(item.cues[0].offsetMs).toBeLessThan(0);
  });

  it.each([
    ['野戰治療陣', /野戰治療陣/, 30_000],
    ['不屈', /不屈不撓之策/, 30_000],
    ['深謀', /深謀遠慮之策/, 45_000],
    ['低語', /仙光的低語/, 60_000],
    ['祥光', /仙光的祥光/, 60_000],
    ['生命回生法', /生命回生法/, 60_000],
    ['秘策', /秘策/, 60_000],
    ['以太超流', /^以太超流/, 60_000],
    ['展開戰術', /展開戰術/, 90_000],
    ['幻光', /幻光/, 120_000],
    ['疾風怒濤', /疾風怒濤之計/, 120_000],
    ['熾天使', /召喚熾天使/, 120_000],
    ['熾天附體', /熾天附體/, 180_000],
    ['轉化', /^轉化/, 180_000],
    ['連環計', /連環計/, 120_000],
  ] as const)('%s never recurs before its level 100 cooldown', (_name, pattern, cooldown) => {
    const sequence = casts(pattern);
    expect(sequence.length).toBeGreaterThan(1);
    for (let i = 1; i < sequence.length; i += 1) {
      expect(at(sequence[i]) - at(sequence[i - 1]), `${sequence[i - 1].id} → ${sequence[i].id}`)
        .toBeGreaterThanOrEqual(cooldown);
    }
  });

  it('uses exactly two Consolations per Seraph, after summoning and before expiry', () => {
    const summons = casts(/召喚熾天使/);
    const consolations = casts(/慰藉/);
    expect(summons).toHaveLength(6);
    expect(consolations).toHaveLength(summons.length * 2);
    for (const summon of summons) {
      const inside = consolations.filter(item => at(item) >= at(summon) + 2_000 && at(item) < at(summon) + 22_000);
      expect(inside, summon.id).toHaveLength(2);
      expect(at(inside[1]) - at(inside[0])).toBeGreaterThanOrEqual(2_500);
    }
  });

  it('never requests fairy actions while Dissipation removes the fairy', () => {
    const dissipations = casts(/^轉化/);
    const seraphs = casts(/召喚熾天使/);
    const seraphisms = casts(/熾天附體/);
    const fairyActions = casts(/幻光|仙光的低語|仙光的祥光|以太契約|召喚熾天使|熾天附體/);
    for (const dissipation of dissipations) {
      expect(at(dissipation)).toBeGreaterThanOrEqual(0);
      for (const cast of fairyActions) {
        expect(at(cast) < at(dissipation) || at(cast) >= at(dissipation) + 30_000, cast.id).toBe(true);
      }
      for (const summon of seraphs) {
        expect(at(dissipation) < at(summon) || at(dissipation) >= at(summon) + 22_000).toBe(true);
      }
      for (const seraphism of seraphisms) {
        expect(at(dissipation) < at(seraphism) || at(dissipation) >= at(seraphism) + 20_000).toBe(true);
      }
    }
    for (const cast of casts(/仙光的祥光|以太契約/)) {
      for (const summon of seraphs) {
        expect(at(cast) < at(summon) || at(cast) >= at(summon) + 22_000, cast.id).toBe(true);
      }
    }
    for (const cast of casts(/以太契約/)) expect(cast.cues[0].text).toContain('量譜');
  });

  it('keeps transformed shields inside Seraphism and critical Adlo prep outside it', () => {
    const forms = casts(/熾天附體/);
    for (const cast of healing.events.filter(item => /附體群盾|附體單盾/.test(actions(item)))) {
      expect(forms.some(form => at(cast) >= at(form) && at(cast) < at(form) + 20_000), cast.id).toBe(true);
    }
    for (const cast of casts(/鼓舞激勵之策/)) {
      expect(forms.every(form => at(cast) < at(form) || at(cast) >= at(form) + 20_000), cast.id).toBe(true);
    }
  });

  it('prepares each deployed Adlo in time and covers the intended damage before its shield expires', () => {
    const windows = [
      ['reign', [39_600, 46_000]],
      ['adds', [196_900]],
      ['moonlight', [354_000, 362_400]],
      ['p2', [455_000]],
      ['purge', [550_200]],
      ['lone-wolf', [695_500]],
      ['final', [810_500, 817_600]],
    ] as const;
    for (const [key, damage] of windows) {
      const prep = event(`${key}-spread-prep`);
      const deploy = event(`${key}-deployment`);
      expect(at(deploy) - at(prep), key).toBeGreaterThanOrEqual(key === 'adds' ? 5_000 : 4_000);
      // Conservative 3.5 s for buff weaving plus Adlo (Swiftcast opener is faster).
      const shieldAppliedAt = at(prep) + 3_500;
      expect(at(deploy)).toBeGreaterThanOrEqual(shieldAppliedAt);
      for (const hit of damage) {
        expect(at(deploy), key).toBeLessThan(hit);
        expect(shieldAppliedAt + 30_000, key).toBeGreaterThan(hit);
      }
    }
    expect(at(event('saber-recited-shield')) - at(event('saber-recitation'))).toBeLessThan(15_000);
    // The final P1 shield is plain; using Recitation here would break the P2 opener.
    expect(actions(event('final-p1-shield'))).not.toContain('秘策');
  });

  it('budgets enough Aetherflow even when every conditional heal is used', () => {
    let stacks = 0;
    let spends = 0;
    for (const cast of healing.events) {
      const name = actions(cast);
      if (/^轉化|^以太超流/.test(name)) stacks = 3;
      let cost = /野戰治療陣/.test(name) ? 1 : 0;
      if (/深謀遠慮之策/.test(name)) cost += 1;
      if (/不屈不撓之策/.test(name) && !/秘策/.test(name)) cost += 1;
      if (/生命活性法/.test(name)) cost += 1;
      expect(stacks, cast.id).toBeGreaterThanOrEqual(cost);
      stacks -= cost;
      spends += cost;
    }
    expect(spends).toBeGreaterThan(20);
    // This is a healing reserve model: discretionary Energy Drain is not assumed.
  });

  it('anchors variable phases to the video reference instead of cactbot artificial timestamps', () => {
    expect(bossAt('pursuit-1')).toBe(14_700);
    expect(bossAt('return')).toBe(248_500);
    expect(bossAt('saber') - bossAt('return')).toBe(13_000);
    expect(bossAt('transition')).toBe(398_700);
    expect(bossAt('p2-targetable') - bossAt('transition')).toBe(44_300);
    expect(bossAt('quake-1') - bossAt('p2-targetable')).toBe(12_000);
    expect(bossAt('enrage') - bossAt('p2-targetable')).toBe(385_900);
    expect(timeline.encounter.durationMs).toBeGreaterThan(bossAt('enrage'));
    expect(healing.events.filter(item => at(item) > 398_700 && at(item) < 443_000)).toEqual([]);
    const soil = at(event('double-raidwide-soil'));
    expect(soil).toBeLessThan(bossAt('pursuit-2'));
    expect(soil + 15_000).toBeGreaterThan(bossAt('decay'));
  });

  it('aligns all seven Chains to the video party-buff windows, including P2 holds', () => {
    const chains = casts(/連環計/);
    expect(chains).toHaveLength(7);
    const times = chains.map(at);
    // The two-minute burst stays on cooldown; later windows follow mechanics.
    expect(times[0]).toBeGreaterThanOrEqual(5_000);
    expect(times[0]).toBeLessThanOrEqual(10_000);
    expect(times[1] - times[0]).toBe(120_000);
    const windows = [
      [bossAt('return'), bossAt('return') + 5_000],
      [bossAt('fangs-2'), bossAt('tremors-2')],
      [bossAt('ray-2'), bossAt('quake-2')],
      [bossAt('quake-3') - 5_000, bossAt('quake-3')],
      [bossAt('howling-2') - 5_000, bossAt('howling-2')],
    ];
    windows.forEach(([start, end], index) => {
      expect(times[index + 2]).toBeGreaterThanOrEqual(start);
      expect(times[index + 2]).toBeLessThanOrEqual(end);
    });
    // P2 opens before the previous Chain is ready; restarting its cycle here is invalid.
    expect(bossAt('p2-targetable') - times[3]).toBeLessThan(120_000);
    expect(chains.filter(item => at(item) >= 443_000 && at(item) < bossAt('ray-2'))).toEqual([]);
    for (const cast of chains) expect(cast.cues[0].text).toContain('連環計');
  });

  it('retains every 30 second poison check, with bounded merging and fresh-target openers', () => {
    const dots = casts(/蠱毒法檢查/);
    expect(dots).toHaveLength(26);
    const segments = [
      { start: 0, end: 179_700, first: 2_600, count: 6 },
      { start: 188_800, end: 248_500, first: 192_500, count: 2 },
      { start: 248_500, end: 398_700, first: 250_000, count: 5 },
      { start: 443_000, end: 828_900, first: 443_000, count: 13 },
    ];
    for (const segment of segments) {
      const inside = dots.filter(item => at(item) >= segment.start && at(item) < segment.end);
      expect(inside, `segment ${segment.start}`).toHaveLength(segment.count);
      expect(at(inside[0]) - segment.start).toBeLessThanOrEqual(4_000);
      expect(inside[0].cues[0].text).toContain('補毒');
      inside.forEach((item, index) => {
        expect(Math.abs(at(item) - (segment.first + index * 30_000)), item.id).toBeLessThanOrEqual(2_000);
        if (index > 0) {
          expect(item.name).toContain('將到期才補毒');
          expect(item.cues[0].text).toContain('毒到期補');
          expect(at(item) - at(inside[index - 1])).toBeLessThanOrEqual(32_000);
        }
      });
      expect(segment.end - at(inside[inside.length - 1])).toBeLessThanOrEqual(30_000);
    }
    expect(event('adds-deployment').cues[0].text).toContain('換怪重補');
    expect(event('adds-consolation-2').name).toContain('存活且可選取');
  });

  it('does not call for offensive actions during boss downtime or lose merged reminders in playback', () => {
    const offense = casts(/蠱毒法檢查|連環計/);
    for (const [start, end] of [[179_700, 188_800], [293_000, 299_900], [398_700, 443_000]]) {
      expect(offense.filter(item => at(item) >= start && at(item) < end)).toEqual([]);
      expect(offense.filter(item => item.cues.some(cue => at(item) + cue.offsetMs >= start && at(item) + cue.offsetMs < end))).toEqual([]);
    }
    const plan = planFor({ position: 'H2', job: 'SCH' });
    expect(plan.cues.filter(cue => /連環計/.test(cue.text))).toHaveLength(7);
    expect(plan.cues.filter(cue => /補毒|毒到期補/.test(cue.text))).toHaveLength(26);
    for (const item of offense) {
      expect(item.cues).toHaveLength(1);
      expect(item.cues[0].offsetMs).toBe(0);
    }
  });

  it('starts with the 10 second countdown and only speaks job cues to H2 SCH', () => {
    const plan = planFor({ position: 'H2', job: 'SCH' });
    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(plan.canStart).toBe(true);
    expect(plan.minimumCountdownMs).toBe(10_000);
    expect(plan.cues).toHaveLength(181);
    expect(planFor({ position: 'H2', job: 'SCH' }, 5_000).canStart).toBe(false);
    for (const profile of [{ position: 'H1', job: 'SCH' }, { position: 'H2', job: 'AST' }] as const) {
      const other = planFor(profile);
      expect(other.cues.every(cue => cue.trackId === 'boss-mechanics')).toBe(true);
      expect(other.cues).toHaveLength(boss.events.length);
    }
  });
});
