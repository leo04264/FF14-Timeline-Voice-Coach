import { describe, expect, it, vi } from 'vitest';
import payload from '../../public/timelines/m8s-h2-scholar.json';
import evidence from '../../docs/m8s-h2-video-audit.json';
import manifest from '../../public/timelines/index.json';
import { migrateTimeline } from './migration';
import { parseAndValidateTimeline } from './validator';
import { buildPlaybackPlan } from './playbackPlan';
import { absoluteAtMs } from './resolveEventTiming';
import { DEFAULT_SETTINGS } from '../storage/settings';
import { loadBuiltinTimelines } from '../storage/builtinTimelines';
import type { PlayerProfile, TimelineEvent } from './types';

const migrated = migrateTimeline(payload);
if (!migrated.ok) throw new Error(migrated.error);
const validated = parseAndValidateTimeline(migrated.value);
if (!validated.ok) throw new Error('M8S H2 學者格式錯誤');
const timeline = validated.timeline;
const healing = timeline.tracks.find(t => t.id === 'h2-scholar')!;
const boss = timeline.tracks.find(t => t.id === 'boss-mechanics')!;
const byId = new Map(timeline.tracks.flatMap(t => t.events).map(e => [e.id, e]));
const at = (e: TimelineEvent) => absoluteAtMs(e) / 1000;
const video = (e: TimelineEvent) => at(e) + evidence.timebase.videoZeroSeconds;
const event = (key: string) => byId.get(`m8s-sch-${key}`)!;
// The historical video audit keeps its original 136 actions. The supplied attachment
// deliberately omits the standalone Blessing at 234s; every other audit ID still applies.
const attachmentOmittedEventId = 'm8s-sch-adds-blessing';
const actionReferences = evidence.actionReferences.filter(r => r.eventId !== attachmentOmittedEventId);
const refs = new Map(actionReferences.map(r => [r.eventId, r]));
const casts = (ability: string) => healing.events.filter(e => refs.get(e.id)!.actions.includes(ability));
const planFor = (profile: PlayerProfile = { position: 'H2', job: 'SCH' },
  selected = timeline.tracks.filter(t => t.enabledByDefault).map(t => t.id), countdownMs = 10_000) => buildPlaybackPlan({
  timeline, profile, enabledTrackIds: selected, countdownMs,
  audio: DEFAULT_SETTINGS.audio, collisionWindowMs: DEFAULT_SETTINGS.collisionWindowMs,
  maxLateMs: DEFAULT_SETTINGS.maxLateMs, sessionOffsetMs: 0, speechSupported: true,
});

describe('M8S H2 Scholar: attachment wording with preserved source timing', () => {
  it('is discoverable, valid, H2 SCH only, and honest about video precision', () => {
    expect(manifest.filter(f => f === 'm8s-h2-scholar.json')).toHaveLength(1);
    expect(timeline.id).toBe('builtin-m8s-h2-scholar');
    expect(timeline.tracks.map(t => t.id)).toEqual(['boss-mechanics', 'h2-scholar']);
    expect(timeline.meta.version).toBe('0.3.0');
    expect(timeline.meta.description).toContain('BV1Vc3Nz7Ejd');
    expect(timeline.meta.description).toContain('非逐鍵轉錄');
    expect(validated.report.issues).toEqual([]);
    expect(healing.target).toEqual({ positions: ['H2'], jobs: ['SCH'] });
    expect(evidence.timebase.videoZeroSeconds).toBe(21.5);
  });

  it('loads the updated builtin through the manifest without changing its identity', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).endsWith('timelines/index.json')
        ? ['m8s-h2-scholar.json']
        : payload,
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const entries = await loadBuiltinTimelines();
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        expect.stringMatching(/timelines\/index\.json$/),
        expect.stringMatching(/timelines\/m8s-h2-scholar\.json$/),
      ]);
      expect(entries).toHaveLength(1);
      const entry = entries[0];
      expect(entry.status).toBe('valid');
      if (entry.status !== 'valid') throw new Error(entry.error);
      expect(entry.id).toBe('builtin-m8s-h2-scholar');
      expect(entry.timeline).toEqual(timeline);
      expect(entry.report.issues).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('speaks the attachment wording at the existing trigger times', () => {
    const expected = [
      ['reign-spread-prep', 31, '風土後，做大盾，補毒'],
      ['aetherflow-1', 60.5, '超流，留治療豆，補毒'],
      ['wind-seraphism', 93.5, '附體，踩塔前群盾，補毒'],
      ['aetherflow-2', 120.5, '超流，留治療豆，補毒'],
      ['dot-opening-6', 152, '補毒'],
      ['pre-adds-union', 175.5, '主坦低血，連線'],
      ['adds-spread-prep', 190.5, '出場傷害後，幻光，擴散大盾'],
      ['adds-deployment', 195.5, '補毒'],
      ['dot-adds-2', 225.5, '補毒'],
      ['rage-shield', 281.5, '群盾，仙女放中，補毒'],
      ['dot-return-3', 311.5, '補毒'],
      ['moonlight-spread-prep', 336.5, 'ＢＯＳＳ回場中擴散盾'],
      ['moonlight-deployment', 341.5, '補毒'],
      ['moonlight-excog', 346.5, '開荒綠帽自己'],
      ['final-p1-seraphism', 370, '附體群盾，補毒'],
    ] as const;
    const plan = planFor();
    for (const [key, triggerSeconds, text] of expected) {
      const compiled = plan.cues.find(c => c.eventId === event(key).id);
      expect(compiled?.id, key).toBe(`m8s-sch-${key}-cue`);
      expect(compiled?.text, key).toBe(text);
      expect(compiled?.triggerMs, key).toBe(triggerSeconds * 1000);
    }
  });

  it('omits the standalone adds Blessing exactly as the attachment does', () => {
    expect(byId.has(attachmentOmittedEventId)).toBe(false);
    expect(boss.events).toHaveLength(56);
    expect(healing.events).toHaveLength(135);
    const plan = planFor();
    expect(plan.totalCueCount).toBe(133);
    expect(plan.cues.some(c => c.eventId === attachmentOmittedEventId)).toBe(false);
    // The earlier third-wave instruction remains; the attachment removes its later standalone repeat.
    expect(event('adds-indom-blessing').cues[0].text).toBe('第三輪後不屈，仙女回來祥光');
  });

  it.each([
    [{ position: 'H2', job: 'SCH' }, true],
    [{ position: 'H1', job: 'SCH' }, false],
    [{ position: 'H2', job: 'AST' }, false],
  ] as const)('targets the first boss raidwide to H2 SCH for %j', (profile, included) => {
    expect(byId.get('m8s-boss-pursuit-1')!.cues[0].target)
      .toEqual({ positions: ['H2'], jobs: ['SCH'] });
    const plan = planFor(profile, [boss.id]);
    expect(plan.cues.some(c => c.eventId === 'm8s-boss-pursuit-1')).toBe(included);
    expect(plan.cues).toHaveLength(included ? 56 : 55);
  });

  it('preserves stable cue IDs and chronological event and playback ordering', () => {
    for (const track of timeline.tracks) {
      const times = track.events.map(absoluteAtMs);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      for (const e of track.events) expect(e.cues[0].id).toBe(`${e.id}-cue`);
    }
    const triggers = planFor().cues.map(c => c.triggerMs);
    expect(triggers).toEqual([...triggers].sort((a, b) => a - b));
  });

  it('accounts for all 75 subtitle groups with the attachment omission explicit', () => {
    expect(evidence.captionInventory).toHaveLength(75);
    for (const c of evidence.captionInventory) {
      const shippedIds = c.eventIds.filter(id => id !== attachmentOmittedEventId);
      expect(shippedIds.length, c.id).toBeGreaterThan(0);
      for (const id of shippedIds) {
        expect(byId.has(id), `${c.id}: ${id}`).toBe(true);
        expect(refs.get(id)!.sourceCaptionIds).toContain(c.id);
      }
    }
    expect(new Set(refs.keys())).toEqual(new Set(healing.events.map(e => e.id)));
    for (const e of healing.events) expect(video(e), e.id).toBe(refs.get(e.id)!.videoSeconds);
  });

  it('keeps pre-pull Broil, three potions, fairy placement, and Sprint', () => {
    expect(at(event('pre-shield'))).toBe(-10);
    expect(at(event('precast'))).toBe(-2);
    expect(event('precast').name).toContain('極炎法');
    expect(event('opening-dissipation').name).toMatch(/轉化→蠱毒法檢查→爆發藥/);
    expect(at(event('opening-dissipation'))).toBeGreaterThanOrEqual(0);
    expect(casts('potion').map(video)).toEqual([22, 474, 772]);
    expect(event('chain-opening').name).toContain('極炎法後');
    expect(casts('fairy-position').flatMap(e => refs.get(e.id)!.sourceCaptionIds))
      .toEqual(expect.arrayContaining(['C08', 'C25', 'C33', 'C59', 'C69']));
    expect(event('circuit-sprint').name).toContain('衝刺');
    expect(planFor().minimumCountdownMs).toBe(10_000);
    expect(planFor(undefined, undefined, 5_000).errors.map(e => e.code)).toContain('plan.cue-before-countdown');
  });

  // Reviewed video windows are separate from the action schedule; these are not millisecond cast logs.
  it.each(evidence.bossObservations)('$eventId lies in its video observation window', o => {
    expect(video(byId.get(o.eventId)!)).toBeGreaterThanOrEqual(o.videoWindowSeconds[0]);
    expect(video(byId.get(o.eventId)!)).toBeLessThanOrEqual(o.videoWindowSeconds[1]);
  });
  it.each(evidence.observedSeraphChanges)('$eventId follows the visible fairy-gauge change', o => {
    expect(video(byId.get(o.eventId)!)).toBeGreaterThanOrEqual(o.videoWindowSeconds[0]);
    expect(video(byId.get(o.eventId)!)).toBeLessThanOrEqual(o.videoWindowSeconds[1]);
  });
  it.each([
    ['raidwide-dawn', 74.5], ['decay-blessing', 88.5],
    ['wind-consolation-1', 101.5], ['wind-consolation-2', 106.5],
    ['adds-spread-prep', 211.5], ['adds-dawn', 220.5],
    ['adds-consolation-1', 235.5], ['adds-indom-blessing', 250.5],
    ['saber-indom', 288.5], ['rage-blessing', 321.5],
    ['moonlight-dawn', 376.5], ['final-p1-consolation-1', 395.5],
    ['p2-fairy-heal', 477.5], ['p2-ray-consolation-1', 523.5],
    ['p2-ray-consolation-2', 534], ['purge-spread-prep', 559.5],
    ['circuit-consolation-2', 657], ['lone-wolf-excog', 722.5],
    ['lone-wolf-shield', 732.5], ['howling-pre-shield', 743.5],
  ] as const)('%s is after damage/knockback, rather than an earlier subtitle', (key, lastFrame) => {
    expect(video(event(key))).toBeGreaterThan(lastFrame);
  });

  it('preserves the two-GCD return delay and Soil covering the two early raidwides', () => {
    expect(video(event('saber-soil')) - video(event('saber-recitation'))).toBeGreaterThanOrEqual(5);
    expect(video(event('saber-recited-shield')) - video(event('saber-recitation'))).toBeLessThan(15);
    const soil = video(event('double-raidwide-soil'));
    expect(soil).toBeLessThan(74);
    expect(soil + 15).toBeGreaterThanOrEqual(88.5);
    expect(video(event('decay-pre-shield')) + 2).toBeLessThan(87.5);
  });

  it.each([
    ['soil', 30], ['indom', 30], ['excog', 45], ['dawn', 60], ['blessing', 60],
    ['protraction', 60], ['recitation', 60], ['aetherflow', 60], ['deployment', 90],
    ['illumination', 120], ['expedient', 120], ['seraph', 120], ['seraphism', 180],
    ['dissipation', 180], ['chain', 120], ['potion', 270],
  ] as const)('%s respects its cooldown, including optional healing choices', (ability, cd) => {
    const seq = casts(ability);
    expect(seq.length).toBeGreaterThan(1);
    for (let i = 1; i < seq.length; i++) expect(at(seq[i]) - at(seq[i - 1]), `${seq[i - 1].id} → ${seq[i].id}`).toBeGreaterThanOrEqual(cd);
  });

  it('binds the action inventory to skill names in the shipped timeline', () => {
    const labels: Record<string, string> = {
      soil: '野戰治療陣', indom: '不屈不撓之策', excog: '深謀遠慮之策',
      dawn: '仙光的低語', blessing: '仙光的祥光', protraction: '生命回生法',
      recitation: '秘策', aetherflow: '以太超流', deployment: '展開戰術',
      illumination: '幻光', expedient: '疾風怒濤之計', seraph: '召喚熾天使',
      seraphism: '熾天附體', dissipation: '轉化', chain: '連環計', potion: '爆發藥',
      dot: '蠱毒法檢查', union: '以太契約', adlo: '鼓舞激勵之策',
      accession: '附體群盾', manifestation: '附體單盾', lustrate: '生命活性法',
      'recited-indom': '不屈不撓之策', group: '群盾', consolation: '慰藉',
      'fairy-position': '仙女', broil: '極炎法', sprint: '衝刺',
    };
    for (const r of actionReferences) for (const a of r.actions) {
      expect(byId.get(r.eventId)!.name, `${r.eventId}: ${a}`).toContain(labels[a]);
    }
  });

  it('uses two Consolations per Seraph and waits for the fairy before Blessing/Union', () => {
    expect(casts('seraph')).toHaveLength(6);
    expect(casts('consolation')).toHaveLength(12);
    for (const summon of casts('seraph')) {
      const inside = casts('consolation').filter(e => at(e) >= at(summon) + 2 && at(e) < at(summon) + 22);
      expect(inside, summon.id).toHaveLength(2);
      expect(at(inside[1]) - at(inside[0])).toBeGreaterThanOrEqual(2.5);
      for (const e of [...casts('blessing'), ...casts('union')]) {
        expect(at(e) < at(summon) || at(e) >= at(summon) + 22, e.id).toBe(true);
      }
    }
    for (const d of casts('dissipation')) {
      for (const ability of ['illumination', 'dawn', 'blessing', 'union', 'seraph', 'seraphism', 'fairy-position']) {
        for (const e of casts(ability)) expect(at(e) < at(d) || at(e) >= at(d) + 30, e.id).toBe(true);
      }
      for (const [ability, duration] of [['seraph', 22], ['seraphism', 20]] as const) {
        for (const e of casts(ability)) expect(at(d) < at(e) || at(d) >= at(e) + duration).toBe(true);
      }
    }
    for (const e of casts('union')) expect(e.name).toContain('量譜');
  });

  it('keeps transformed shields inside Seraphism and critical Adlos outside', () => {
    const forms = casts('seraphism');
    for (const e of [...casts('accession'), ...casts('manifestation')]) {
      expect(forms.some(f => at(e) >= at(f) && at(e) < at(f) + 20), e.id).toBe(true);
    }
    for (const e of casts('adlo')) expect(forms.every(f => at(e) < at(f) || at(e) >= at(f) + 20), e.id).toBe(true);
  });
  it.each([
    ['reign', [61.5, 68.5]], ['adds', [218.5, 220.5]], ['moonlight', [374.5, 385.5]],
    ['p2', [476.5, 477.5]], ['purge', [571.5, 573.5]],
    ['lone-wolf', [720.5, 722.5]], ['final', [833.5, 844.5]],
  ] as const)('%s deploys a completed Adlo before damage and shield expiry', (key, hits) => {
    const applied = video(event(`${key}-spread-prep`)) + 3.5;
    const deploy = video(event(`${key}-deployment`));
    expect(deploy).toBeGreaterThanOrEqual(applied);
    expect(deploy).toBeLessThan(hits[0]);
    expect(applied + 30).toBeGreaterThan(hits[1]);
  });

  it('reserves healing stacks, including the final refill after two Energy Drains', () => {
    let stacks = 0;
    for (const e of healing.events) {
      const a = refs.get(e.id)!.actions;
      if (a.includes('aetherflow') || a.includes('dissipation')) stacks = 3;
      const cost = ['soil', 'indom', 'excog', 'lustrate'].filter(skill => a.includes(skill)).length;
      expect(stacks, e.id).toBeGreaterThanOrEqual(cost);
      stacks -= cost;
      if (e.id === event('howling-dissipation').id) stacks -= 2;
    }
    expect(refs.get(event('final-soil-expedient').id)!.actions).toContain('aetherflow');
    expect(event('final-p1-shield').name).toContain('普通群盾');
    expect(event('tempest-tank-heal').name).toContain('本軸選活性');
  });

  it('keeps seven audible Chains in the subtitle-supported party-buff windows', () => {
    const chains = casts('chain');
    const windows = [[26, 32], [146, 153], [270, 280], [397, 402], [524, 533], [654, 657], [768, 783]];
    expect(chains).toHaveLength(7);
    chains.forEach((e, i) => {
      expect(video(e)).toBeGreaterThanOrEqual(windows[i][0]);
      expect(video(e)).toBeLessThanOrEqual(windows[i][1]);
      expect(planFor().cues.find(c => c.eventId === e.id)?.text).toContain('連環計');
    });
    expect(chains.filter(e => video(e) > 463.5 && video(e) < 524)).toEqual([]);
  });

  it('retains all 26 audible DoT expiry checks, with no attacks during long target gaps', () => {
    expect(evidence.dotChecks).toHaveLength(26);
    expect(casts('dot')).toHaveLength(26);
    const plan = planFor();
    for (const c of evidence.dotChecks) {
      expect(Math.abs(video(byId.get(c.eventId)!) - c.nominalVideoSeconds), c.eventId).toBeLessThanOrEqual(1.5);
      expect(plan.cues.find(p => p.eventId === c.eventId)?.text, c.eventId).toMatch(/補毒|毒到期補/);
    }
    for (const segment of ['opening', 'adds', 'return', 'p2']) {
      const checks = evidence.dotChecks.filter(c => c.segment === segment);
      for (let i = 1; i < checks.length; i++) expect(checks[i].nominalVideoSeconds - checks[i - 1].nominalVideoSeconds).toBe(30);
    }
    for (const e of [...casts('dot'), ...casts('chain')]) {
      expect(video(e) < 202 || video(e) >= 211.5, e.id).toBe(true);
      expect(video(e) < 418 || video(e) >= 464, e.id).toBe(true);
    }
  });

  it('combines speech without moving actions and preserves the complete default plan', () => {
    const plan = planFor();
    expect(plan.canStart).toBe(true);
    expect(plan.errors).toEqual([]);
    expect(plan.actualCollisions.pairs).toEqual([]);
    expect(boss.enabledByDefault).toBe(false);
    expect(healing.enabledByDefault).toBe(true);
    for (const e of healing.events) {
      const r = refs.get(e.id)!;
      const parent = 'voiceIncludedInEventId' in r ? r.voiceIncludedInEventId : undefined;
      expect(plan.cues.some(c => c.eventId === (parent || e.id)), e.id).toBe(true);
    }
    const both = planFor(undefined, timeline.tracks.map(t => t.id));
    expect(both.actualCollisions.pairs.length).toBeGreaterThan(0);
    expect(both.warnings.map(w => w.code)).toContain('plan.collisions');
    for (const e of boss.events) expect(e.cues[0].offsetMs).toBeGreaterThanOrEqual(-3000);
    const warnings = boss.events.map(e => at(e) * 1000 + e.cues[0].offsetMs);
    expect(warnings).toEqual([...warnings].sort((a, b) => a - b));
    expect(planFor({ position: 'H2', job: 'AST' }).cues).toHaveLength(0);
  });

  it('uses Starcleaver cast start, never damage absent from the kill video', () => {
    const enrage = byId.get('m8s-boss-enrage')!;
    expect(enrage.name).toContain('讀條開始');
    expect(enrage.name).toContain('未出現傷害');
    expect(evidence.bossObservations.find(o => o.eventId === enrage.id)!.observationKind).toBe('cast-start');
    expect(video(enrage)).toBeLessThan(849);
    expect(video(event('enrage-dps'))).toBeLessThan(854);
  });
});
