import { describe, expect, it } from 'vitest';
import {
  absEvent,
  AST,
  cue,
  linkedEvent,
  mixedTimeline,
  planInput,
  PLD,
  SCH,
  timelineOf,
  track,
} from '../test/planFixtures';
import { buildPlaybackPlan } from './playbackPlan';
import { JOB_CODES, PARTY_POSITIONS } from './types';

const ALL = (ids: string[]) => ids;

describe('A. 身分、目標與計數', () => {
  const timeline = mixedTimeline();
  // 刻意不含互斥的 plan-* 軌道：那些有專屬的 B 段測試，
  // 全開會先觸發方案衝突而擋掉編譯。
  const allTrackIds = timeline.tracks
    .map((t) => t.id)
    .filter((id) => !id.startsWith('plan-'));

  it('A1. H2／學者 不會編出占星限定的提示', () => {
    const plan = buildPlaybackPlan(planInput(timeline, SCH, allTrackIds));
    expect(plan.cues.map((c) => c.trackId)).not.toContain('ast-heal');
    expect(plan.cues.map((c) => c.text)).not.toContain('命運之輪');

    const astPlan = buildPlaybackPlan(planInput(timeline, AST, allTrackIds));
    expect(astPlan.cues.map((c) => c.trackId)).not.toContain('sch-heal');
    expect(astPlan.cues.map((c) => c.text)).toContain('命運之輪');
  });

  it('A2. jobs=[SCH,SGE] 的共用句對 SCH 只產生一次，且沒有被禁止', () => {
    const plan = buildPlaybackPlan(planInput(timeline, SCH, allTrackIds));
    const shared = plan.cues.filter((c) => c.id === 'shared-1-cue');
    expect(shared).toHaveLength(1);

    // 占星不在 jobs 清單裡，所以聽不到；共用機制本身仍然可用
    const astPlan = buildPlaybackPlan(planInput(timeline, AST, allTrackIds));
    expect(astPlan.cues.filter((c) => c.id === 'shared-1-cue')).toHaveLength(0);
  });

  it('A3. track ∩ cue、空 target、undefined target、混合軌都正確', () => {
    const mixed = timelineOf([
      track('boss', [absEvent('b1', 1000, [cue('b1c', '所有人')])], { type: 'encounter' }),
      track(
        'mixed',
        [
          absEvent('m1', 2000, [
            cue('m1-any', '不限職業'),
            cue('m1-sch', '只給學者', { target: { jobs: ['SCH'] } }),
            cue('m1-ast', '只給占星', { target: { jobs: ['AST'] } }),
            // track 限 H2，cue 限 H1 → 交集為空，永遠不會播
            cue('m1-empty', '沒有人', { target: { positions: ['H1'] } }),
          ]),
        ],
        { type: 'job', target: { positions: ['H2'] } },
      ),
    ]);

    const plan = buildPlaybackPlan(planInput(mixed, SCH, ['boss', 'mixed']));
    expect(plan.cues.map((c) => c.id)).toEqual(['b1c', 'm1-any', 'm1-sch']);

    // 混合軌對占星仍保留其適用部分（不限職業那句），但 H1 站位不符 → 不適用
    const astPlan = buildPlaybackPlan(planInput(mixed, AST, ['boss', 'mixed']));
    expect(astPlan.cues.map((c) => c.id)).toEqual(['b1c']);
    const mixedRow = astPlan.tracks.find((row) => row.track.id === 'mixed')!;
    expect(mixedRow.applicable).toBe(false);
    expect(mixedRow.reason).toContain('H2');
  });

  it('A4. 停用 cue 不計數；關閉軌道不計本次總數；每軌說明與總數一致', () => {
    const withDisabled = timelineOf([
      track('boss', [absEvent('b1', 1000, [cue('b1c', '會播'), cue('b1d', '停用', { enabled: false })])], {
        type: 'encounter',
      }),
      track('off', [absEvent('o1', 2000, [cue('o1c', '沒勾選')])], { type: 'custom' }),
    ]);

    const plan = buildPlaybackPlan(planInput(withDisabled, PLD, ['boss']));
    const bossRow = plan.tracks.find((row) => row.track.id === 'boss')!;
    const offRow = plan.tracks.find((row) => row.track.id === 'off')!;

    expect(bossRow.totalCueCount).toBe(2);
    expect(bossRow.matchingCueCount).toBe(2);
    expect(bossRow.enabledCueCount).toBe(1);
    expect(offRow.selected).toBe(false);
    expect(offRow.enabledCueCount).toBe(1);

    // 總數必須等於 compiled.cues.length，也等於各已選軌道的啟用句數之和
    expect(plan.totalCueCount).toBe(plan.compiledTimeline?.cues.length);
    expect(plan.totalCueCount).toBe(
      plan.tracks.filter((row) => row.selected).reduce((n, row) => n + row.enabledCueCount, 0),
    );
  });

  it('A5a. 對象相符但全部停用時，標成 0 句已啟用，不是職業不適用', () => {
    const allOff = timelineOf([
      track('sch', [absEvent('e', 1000, [cue('c', '停用', { enabled: false })])], {
        type: 'job',
        target: { positions: ['H2'], jobs: ['SCH'] },
      }),
    ]);
    const row = buildPlaybackPlan(planInput(allOff, SCH, ['sch'])).tracks[0];
    expect(row.applicable).toBe(true);
    expect(row.allMatchingDisabled).toBe(true);
    expect(row.enabledCueCount).toBe(0);
    expect(row.reason).toContain('全部被停用');
    expect(row.reason).not.toContain('不符');
  });

  it('A5b. 同一個學者的治療、輸出、自訂軌可以同時使用', () => {
    const plan = buildPlaybackPlan(
      planInput(mixedTimeline(), SCH, ['boss', 'sch-heal', 'sch-dps']),
    );
    expect(plan.errors).toEqual([]);
    expect(plan.canStart).toBe(true);
    expect(plan.cues.map((c) => c.trackId)).toEqual(
      expect.arrayContaining(['sch-heal', 'sch-dps']),
    );
  });

  it('A5c. H1／學者這種非常見組合只提示、不阻擋', () => {
    const unconventional = timelineOf([
      track('sch-h1', [absEvent('e', 1000, [cue('c', '給 H1 的學者')])], {
        type: 'job',
        target: { positions: ['H1'], jobs: ['SCH'] },
      }),
    ]);
    const plan = buildPlaybackPlan(
      planInput(unconventional, { position: 'H1', job: 'SCH' }, ['sch-h1']),
    );
    expect(plan.errors).toEqual([]);
    expect(plan.canStart).toBe(true);
    expect(plan.totalCueCount).toBe(1);
  });

  it('每一種站位×職業組合都能建計畫且不丟例外', () => {
    for (const position of PARTY_POSITIONS) {
      for (const job of JOB_CODES) {
        expect(() =>
          buildPlaybackPlan(planInput(timeline, { position, job }, ALL(allTrackIds))),
        ).not.toThrow();
      }
    }
  });

  it('不合法的站位／職業是阻擋錯誤（不能只靠 TypeScript）', () => {
    const plan = buildPlaybackPlan(
      planInput(timeline, { position: 'H9' as never, job: 'XXX' as never }, allTrackIds),
    );
    expect(plan.errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(['profile.invalid-position', 'profile.invalid-job']),
    );
    expect(plan.canStart).toBe(false);
  });
});

describe('B. 互斥方案', () => {
  const timeline = mixedTimeline();

  it('B7a. 同群組不同方案同時有效 → 阻擋開始', () => {
    const plan = buildPlaybackPlan(
      planInput(timeline, SCH, ['boss', 'plan-a-1', 'plan-b-1']),
    );
    expect(plan.errors.map((e) => e.code)).toContain('selection.conflict');
    expect(plan.canStart).toBe(false);
    const state = plan.selectionGroups[0];
    expect(state.conflictingOptionIds.sort()).toEqual(['a', 'b']);
    expect(state.chosenOptionId).toBeNull();
  });

  it('B7b. 同一方案裡的多條軌道合法', () => {
    const plan = buildPlaybackPlan(
      planInput(timeline, SCH, ['boss', 'plan-a-1', 'plan-a-2']),
    );
    expect(plan.errors).toEqual([]);
    expect(plan.canStart).toBe(true);
    expect(plan.selectionGroups[0].chosenOptionId).toBe('a');
  });

  it('B8a. 不適用職業的隱藏軌道不會產生假互斥', () => {
    // 學者選 A 方案，同時 B 方案的占星軌也被勾選 —— 對學者沒有實際提示
    const plan = buildPlaybackPlan(
      planInput(timeline, SCH, ['boss', 'plan-a-1', 'plan-b-ast']),
    );
    expect(plan.errors.map((e) => e.code)).not.toContain('selection.conflict');
    expect(plan.canStart).toBe(true);
    expect(plan.selectionGroups[0].chosenOptionId).toBe('a');
  });

  it('B8b. 全部 cue 停用的軌道不算「有效」，不會造成互斥衝突', () => {
    const disabledB = timelineOf(
      timeline.tracks.map((t) =>
        t.id === 'plan-b-1'
          ? { ...t, events: t.events.map((e) => ({ ...e, cues: e.cues.map((c) => ({ ...c, enabled: false })) })) }
          : t,
      ),
      { selectionGroups: timeline.selectionGroups },
    );
    const plan = buildPlaybackPlan(
      planInput(disabledB, SCH, ['boss', 'plan-a-1', 'plan-b-1']),
    );
    expect(plan.errors.map((e) => e.code)).not.toContain('selection.conflict');
    expect(plan.canStart).toBe(true);
  });

  it('B8c. 舊偏好／匯入留下的衝突不能繞過（沒有靜默猜一個）', () => {
    // 模擬 storage 還原出兩個方案都開著的狀態
    const restored = ['boss', 'plan-a-1', 'plan-a-2', 'plan-b-1'];
    const plan = buildPlaybackPlan(planInput(timeline, SCH, restored));
    expect(plan.canStart).toBe(false);
    expect(plan.errors.find((e) => e.code === 'selection.conflict')?.hint).toContain('不會替你猜');
  });

  it('track 指向不存在的方案是阻擋錯誤', () => {
    const broken = timelineOf(
      [
        track('t', [absEvent('e', 1000, [cue('c', 'x')])], {
          selection: { groupId: 'nope', optionId: 'nope' },
        }),
      ],
      { selectionGroups: [{ id: 'strategy', name: 's', options: [{ id: 'a', name: 'A' }] }] },
    );
    const plan = buildPlaybackPlan(planInput(broken, PLD, ['t']));
    expect(plan.errors.map((e) => e.message).join()).toContain('不存在的方案');
  });
});

describe('B14. 這一場的時間與環境檢查', () => {
  const base = timelineOf([
    track(
      'boss',
      [absEvent('b1', 0, [cue('b1c', '開場前十秒', { offsetMs: -10_000 })])],
      { type: 'encounter' },
    ),
  ]);

  it('倒數不足以涵蓋負時間提示 → 阻擋，並提供解法', () => {
    const plan = buildPlaybackPlan(
      planInput(base, PLD, ['boss'], { countdownMs: 5000 }),
    );
    const issue = plan.errors.find((e) => e.code === 'plan.cue-before-countdown');
    expect(issue).toBeDefined();
    expect(issue?.hint).toContain('足夠');
    expect(plan.canStart).toBe(false);
  });

  it('倒數足夠時同一份時間軸可以開始（用本次倒數，不是 encounter 預設）', () => {
    expect(base.encounter.countdownMs).toBe(15_000);
    const plan = buildPlaybackPlan(planInput(base, PLD, ['boss'], { countdownMs: 15_000 }));
    expect(plan.errors).toEqual([]);
    expect(plan.canStart).toBe(true);
  });

  it('負校時會讓開場提示一開始就過期 → 阻擋；正校時合法', () => {
    // elapsed(0) = -countdown - offset；負 offset 讓時間軸一開始就已推進
    const skipped = buildPlaybackPlan(
      planInput(base, PLD, ['boss'], { countdownMs: 15_000, sessionOffsetMs: -9000, maxLateMs: 3000 }),
    );
    expect(skipped.errors.map((e) => e.code)).toContain('plan.offset-skips-cues');

    const fine = buildPlaybackPlan(
      planInput(base, PLD, ['boss'], { countdownMs: 15_000, sessionOffsetMs: 2000 }),
    );
    expect(fine.errors.map((e) => e.code)).not.toContain('plan.offset-skips-cues');
    expect(fine.canStart).toBe(true);
  });

  it('合法校時不會被一律當成錯誤', () => {
    for (const offset of [-2000, -500, 0, 500, 2000]) {
      const plan = buildPlaybackPlan(
        planInput(base, PLD, ['boss'], { countdownMs: 15_000, sessionOffsetMs: offset }),
      );
      expect(plan.errors.map((e) => e.code), String(offset)).not.toContain('plan.offset-skips-cues');
    }
  });

  it('不支援語音時是阻擋錯誤，不會顯示已正常啟動', () => {
    const plan = buildPlaybackPlan(planInput(base, PLD, ['boss'], { speechSupported: false }));
    expect(plan.errors.map((e) => e.code)).toContain('audio.unsupported');
    expect(plan.canStart).toBe(false);
  });

  it('不合法倒數／校時數值是阻擋錯誤', () => {
    expect(
      buildPlaybackPlan(planInput(base, PLD, ['boss'], { countdownMs: Number.NaN })).errors.map(
        (e) => e.code,
      ),
    ).toContain('plan.invalid-countdown');
    expect(
      buildPlaybackPlan(
        planInput(base, PLD, ['boss'], { sessionOffsetMs: Number.POSITIVE_INFINITY }),
      ).errors.map((e) => e.code),
    ).toContain('plan.invalid-offset');
  });

  it('零句是阻擋錯誤', () => {
    const plan = buildPlaybackPlan(planInput(base, PLD, []));
    expect(plan.errors.map((e) => e.code)).toContain('plan.no-cues');
    expect(plan.canStart).toBe(false);
  });
});

describe('需要確認的警告', () => {
  it('本次 queue 真正的碰撞才算，且需要確認', () => {
    const dense = timelineOf([
      track(
        'boss',
        [absEvent('b', 10_000, [cue('c1', '第一句'), cue('c2', '第二句', { offsetMs: 500 })])],
        { type: 'encounter' },
      ),
      // 另一條不適用的軌道，時間重疊但不該算進來
      track('other', [absEvent('o', 10_000, [cue('oc', '別人的句子')])], {
        type: 'job',
        target: { positions: ['H1'], jobs: ['AST'] },
      }),
    ]);
    const plan = buildPlaybackPlan(planInput(dense, PLD, ['boss', 'other']));
    expect(plan.actualCollisions.pairs).toHaveLength(1);
    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.warnings.find((w) => w.code === 'plan.collisions')?.message).toContain('可能來不及');
  });

  it('type=job 卻有不限職業的提示 → 警告但不阻擋', () => {
    const loose = timelineOf([
      track('job', [absEvent('e', 1000, [cue('c', '沒填對象')])], { type: 'job' }),
    ]);
    const plan = buildPlaybackPlan(planInput(loose, PLD, ['job']));
    expect(plan.errors).toEqual([]);
    expect(plan.warnings.map((w) => w.code)).toContain('plan.job-track-unrestricted');
    expect(plan.canStart).toBe(true);
  });

  it('只有共通提醒時明確說明，不假裝套用了完整奶軸', () => {
    const sharedOnly = timelineOf([
      track('boss', [absEvent('b', 1000, [cue('c', '全體傷害')])], { type: 'encounter' }),
    ]);
    const plan = buildPlaybackPlan(planInput(sharedOnly, PLD, ['boss']));
    const warning = plan.warnings.find((w) => w.code === 'plan.only-shared-cues');
    expect(warning?.requiresConfirmation).toBe(true);
    expect(warning?.hint).toContain('不等於');
  });
});

describe('連動引用參與計畫', () => {
  it('關掉 Boss 報點軌道，連動提醒仍然算得出時間', () => {
    const timeline = timelineOf([
      track('boss', [absEvent('b1', 60_000, [cue('b1c', '全體傷害')])], { type: 'encounter' }),
      track('me', [linkedEvent('r1', 'boss', 'b1', [cue('r1c', '我的提醒', { offsetMs: -3000 })])], {
        target: { positions: ['MT'], jobs: ['PLD'] },
      }),
    ]);
    // 只選我的軌道，Boss 軌不選
    const plan = buildPlaybackPlan(planInput(timeline, PLD, ['me']));
    expect(plan.errors).toEqual([]);
    expect(plan.cues.map((c) => `${c.id}@${c.triggerMs}`)).toEqual(['r1c@57000']);
  });

  it('連動失效是阻擋錯誤，並標記在對應軌道上', () => {
    const timeline = timelineOf([
      track('boss', [absEvent('b1', 60_000, [cue('b1c', '全體傷害')])], { type: 'encounter' }),
      track('me', [linkedEvent('r1', 'boss', 'gone', [cue('r1c', '壞掉的提醒')])], {
        target: { positions: ['MT'], jobs: ['PLD'] },
      }),
    ]);
    const plan = buildPlaybackPlan(planInput(timeline, PLD, ['boss', 'me']));
    expect(plan.canStart).toBe(false);
    expect(plan.errors.map((e) => e.message).join()).toContain('來源機制不存在');
    const row = plan.tracks.find((r) => r.track.id === 'me')!;
    expect(row.hasTimingError).toBe(true);
    expect(row.blockedReason).toContain('尚不可播放');
    // 不是靜默刪掉錯誤的 cue 讓數字看起來正常
    expect(row.matchingCueCount).toBe(1);
  });
});

describe('fingerprint', () => {
  const timeline = mixedTimeline();
  const base = planInput(timeline, SCH, ['boss', 'sch-heal']);

  it('相同輸入得到相同 fingerprint', () => {
    expect(buildPlaybackPlan(base).fingerprint).toBe(buildPlaybackPlan(base).fingerprint);
  });

  it.each([
    ['profile', { profile: AST }],
    ['tracks', { enabledTrackIds: ['boss'] }],
    ['countdown', { countdownMs: 5000 }],
    ['collision window', { collisionWindowMs: 500 }],
    ['maxLate', { maxLateMs: 1000 }],
    ['offset', { sessionOffsetMs: 500 }],
    ['audio', { audio: { lang: 'en-US', rate: 1, pitch: 1, volume: 1 } }],
  ])('%s 改變會改變 fingerprint', (_label, patch) => {
    expect(buildPlaybackPlan({ ...base, ...patch }).fingerprint).not.toBe(
      buildPlaybackPlan(base).fingerprint,
    );
  });

  it('文件內容改變會改變 fingerprint（不是只看 id 或 meta.version）', () => {
    const edited = timelineOf(
      timeline.tracks.map((t) =>
        t.id === 'sch-heal'
          ? { ...t, events: t.events.map((e) => ({ ...e, cues: e.cues.map((c) => ({ ...c, text: '改過的字' })) })) }
          : t,
      ),
      { selectionGroups: timeline.selectionGroups, id: timeline.id, meta: timeline.meta },
    );
    expect(buildPlaybackPlan({ ...base, timeline: edited }).fingerprint).not.toBe(
      buildPlaybackPlan(base).fingerprint,
    );
  });
});
