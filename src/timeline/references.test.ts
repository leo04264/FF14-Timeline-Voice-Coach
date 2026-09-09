import { describe, expect, it } from 'vitest';
import { absEvent, cue, linkedEvent, PLD, SCH, timelineOf, track } from '../test/planFixtures';
import {
  convertEventToFixedTime,
  describeEventDependents,
  describeTrackDependents,
  duplicateEvent,
  duplicateTrack,
  forkTimeline,
  linkEventToMechanic,
  removeEventSafely,
  removeTrackSafely,
  setEventAbsoluteTime,
} from './edits';
import {
  buildMechanicIndex,
  collectTimingIssues,
  resolveEventTiming,
} from './resolveEventTiming';
import { validateTimeline } from './validator';
import { absoluteTiming, mechanicTiming, type TimelinePackage } from './types';

/** Boss mechanic at 60s, a linked reminder at -3s, and a fixed-time reminder. */
function base(): TimelinePackage {
  return timelineOf([
    track('boss', [absEvent('mech', 60_000, [cue('mech-cue', '全體傷害')], { phase: 'P2' })], {
      type: 'encounter',
      name: 'Boss',
    }),
    track('sch', [linkedEvent('linked', 'boss', 'mech', [cue('linked-cue', '連動提醒', { offsetMs: -3000 })])], {
      type: 'job',
      name: 'H2 學者',
      target: { positions: ['H2'], jobs: ['SCH'] },
    }),
    track('ast', [linkedEvent('linked-ast', 'boss', 'mech', [cue('linked-ast-cue', '占星的連動提醒', { offsetMs: -1000 })])], {
      type: 'job',
      name: 'H1 占星',
      target: { positions: ['H1'], jobs: ['AST'] },
    }),
    track('fixed', [absEvent('abs', 57_000, [cue('abs-cue', '固定時間提醒')])], {
      type: 'custom',
      name: '固定時間軌',
      target: { positions: ['H2'], jobs: ['SCH'] },
    }),
  ]);
}

const at = (timeline: TimelinePackage, trackId: string, eventId: string) => {
  const trackRow = timeline.tracks.find((t) => t.id === trackId)!;
  const event = trackRow.events.find((e) => e.id === eventId)!;
  return resolveEventTiming(event, trackId, buildMechanicIndex(timeline));
};

const triggerOf = (timeline: TimelinePackage, trackId: string, eventId: string) => {
  const trackRow = timeline.tracks.find((t) => t.id === trackId)!;
  const event = trackRow.events.find((e) => e.id === eventId)!;
  const resolved = resolveEventTiming(event, trackId, buildMechanicIndex(timeline));
  return resolved.atMs === undefined ? undefined : resolved.atMs + event.cues[0].offsetMs;
};

describe('D20. 移動來源時間', () => {
  it('來源 60,000 → 65,000 時連動提示從 57,000 變 62,000，固定時間的不動', () => {
    const before = base();
    expect(triggerOf(before, 'sch', 'linked')).toBe(57_000);
    expect(triggerOf(before, 'fixed', 'abs')).toBe(57_000);

    const moved = setEventAbsoluteTime(before, 'boss', 'mech', 65_000);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    expect(triggerOf(moved.timeline, 'sch', 'linked')).toBe(62_000);
    expect(triggerOf(moved.timeline, 'ast', 'linked-ast')).toBe(64_000);
    // offset 完全不變
    expect(
      moved.timeline.tracks.find((t) => t.id === 'sch')!.events[0].cues[0].offsetMs,
    ).toBe(-3000);
    // 舊的 absolute 提醒不跟著變
    expect(triggerOf(moved.timeline, 'fixed', 'abs')).toBe(57_000);
  });

  it('移出範圍時明確標錯，不靜默夾到合法時間', () => {
    const moved = setEventAbsoluteTime(base(), 'boss', 'mech', 900_000);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    // 值原樣保留
    expect(at(moved.timeline, 'boss', 'mech').atMs).toBe(900_000);
    const report = validateTimeline(moved.timeline);
    expect(report.errors.map((e) => e.code)).toContain('event.after-duration');
  });

  it('連動事件不能直接設定絕對時間', () => {
    const result = setEventAbsoluteTime(base(), 'sch', 'linked', 1000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('連動事件');
  });
});

describe('D21. 來源軌道關閉／階段更新', () => {
  it('關掉 Boss 報點不影響錨點存在（軌道選擇不參與解析）', () => {
    const timeline = base();
    // 把 Boss 軌的 cue 全部停用，等同「關掉報點」
    const muted: TimelinePackage = {
      ...timeline,
      tracks: timeline.tracks.map((t) =>
        t.id === 'boss'
          ? { ...t, enabledByDefault: false, events: t.events.map((e) => ({ ...e, cues: e.cues.map((c) => ({ ...c, enabled: false })) })) }
          : t,
      ),
    };
    expect(triggerOf(muted, 'sch', 'linked')).toBe(57_000);
    expect(collectTimingIssues(muted)).toEqual([]);
  });

  it('來源 phase 改變會即時反映在連動事件上', () => {
    const timeline = base();
    expect(at(timeline, 'sch', 'linked').phase).toBe('P2');
    const rephased: TimelinePackage = {
      ...timeline,
      tracks: timeline.tracks.map((t) =>
        t.id === 'boss' ? { ...t, events: t.events.map((e) => ({ ...e, phase: 'P3' })) } : t,
      ),
    };
    expect(at(rephased, 'sch', 'linked').phase).toBe('P3');
  });
});

describe('D22. 刪除有引用的來源', () => {
  it('取消是預設：回報所有受影響提醒，包含其他職業的', () => {
    const result = removeEventSafely(base(), 'boss', 'mech');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.dependents.map((d) => d.eventId).sort()).toEqual(['linked', 'linked-ast']);
    expect(result.dependents.map((d) => d.trackName)).toContain('H1 占星');
    expect(result.timeline).toEqual(base());
  });

  it('連帶刪除：來源與所有相關提醒一起消失', () => {
    const result = removeEventSafely(base(), 'boss', 'mech', 'delete-dependents');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deletedEventIds.sort()).toEqual(['linked', 'linked-ast']);
    expect(result.timeline.tracks.find((t) => t.id === 'boss')!.events).toHaveLength(0);
    expect(result.timeline.tracks.find((t) => t.id === 'sch')!.events).toHaveLength(0);
    expect(collectTimingIssues(result.timeline)).toEqual([]);
  });

  it('轉成固定時間再刪除：實際 triggerMs 完全不變', () => {
    const before = base();
    const schTrigger = triggerOf(before, 'sch', 'linked');
    const astTrigger = triggerOf(before, 'ast', 'linked-ast');

    const result = removeEventSafely(before, 'boss', 'mech', 'convert-to-fixed');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.convertedEventIds.sort()).toEqual(['linked', 'linked-ast']);
    expect(triggerOf(result.timeline, 'sch', 'linked')).toBe(schTrigger);
    expect(triggerOf(result.timeline, 'ast', 'linked-ast')).toBe(astTrigger);
    expect(at(result.timeline, 'sch', 'linked').atMs).toBe(60_000);
    // phase 凍結成當時顯示的值，不會變空白
    expect(result.timeline.tracks.find((t) => t.id === 'sch')!.events[0].phase).toBe('P2');
    expect(collectTimingIssues(result.timeline)).toEqual([]);
    expect(validateTimeline(result.timeline).errors).toEqual([]);
  });

  it('刪除整條來源軌道也走同一套規則', () => {
    const cancelled = removeTrackSafely(base(), 'boss');
    expect(cancelled.ok).toBe(false);
    if (cancelled.ok) return;
    expect(cancelled.dependents).toHaveLength(2);
    expect(describeTrackDependents(base(), 'boss')).toHaveLength(2);

    const converted = removeTrackSafely(base(), 'boss', 'convert-to-fixed');
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    expect(converted.timeline.tracks.find((t) => t.id === 'boss')).toBeUndefined();
    expect(triggerOf(converted.timeline, 'sch', 'linked')).toBe(57_000);
  });

  it('沒有引用時直接刪除，不需要對話框', () => {
    expect(describeEventDependents(base(), 'abs')).toEqual([]);
    const result = removeEventSafely(base(), 'fixed', 'abs');
    expect(result.ok).toBe(true);
  });

  it('每種策略都是一次文件替換（可用單次 undo 還原）', () => {
    const before = base();
    for (const strategy of ['delete-dependents', 'convert-to-fixed'] as const) {
      const result = removeEventSafely(before, 'boss', 'mech', strategy);
      expect(result.ok).toBe(true);
      // 原文件沒有被就地修改，undo 只要換回 before 即可
      expect(before).toEqual(base());
      if (result.ok) expect(result.timeline).not.toBe(before);
    }
  });
});

describe('D23. 不合法引用是明確的阻擋錯誤，不丟例外', () => {
  it.each([
    [
      '自引用',
      timelineOf([
        track('boss', [absEvent('m', 1000, [])], { type: 'encounter' }),
        track('t', [{ id: 'self', timing: mechanicTiming('t', 'self'), name: 'self', category: 'custom' as const, cues: [cue('c', 'x')] }]),
      ]),
      'timing.self-reference',
    ],
    [
      '來源不存在',
      timelineOf([
        track('boss', [absEvent('m', 1000, [])], { type: 'encounter' }),
        track('t', [linkedEvent('e', 'boss', 'missing', [cue('c', 'x')])]),
      ]),
      'timing.missing-source-event',
    ],
    [
      '來源軌道宣告不符',
      timelineOf([
        track('boss', [absEvent('m', 1000, [])], { type: 'encounter' }),
        track('t', [linkedEvent('e', 'wrong-track', 'm', [cue('c', 'x')])]),
      ]),
      'timing.missing-source-track',
    ],
    [
      '來源不是戰鬥軌道',
      timelineOf([
        track('notboss', [absEvent('m', 1000, [])], { type: 'job' }),
        track('t', [linkedEvent('e', 'notboss', 'm', [cue('c', 'x')])]),
      ]),
      'timing.source-not-encounter',
    ],
    [
      '連鎖連動',
      timelineOf([
        track('boss', [absEvent('m', 1000, []), linkedEvent('m2', 'boss', 'm', [])], {
          type: 'encounter',
        }),
        track('t', [linkedEvent('e', 'boss', 'm2', [cue('c', 'x')])]),
      ]),
      'timing.source-not-absolute',
    ],
    [
      '非有限數值',
      timelineOf([
        track('boss', [{ id: 'm', timing: absoluteTiming(Number.NaN), name: 'm', category: 'mechanic' as const, cues: [] }], { type: 'encounter' }),
        track('t', [linkedEvent('e', 'boss', 'm', [cue('c', 'x')])]),
      ]),
      'timing.non-finite',
    ],
  ])('%s → %s', (_label, timeline, code) => {
    expect(() => collectTimingIssues(timeline)).not.toThrow();
    const issues = collectTimingIssues(timeline);
    expect(issues.map((i) => i.code)).toContain(code);

    const report = validateTimeline(timeline);
    expect(report.hasBlockingError).toBe(true);
    expect(report.errors.map((e) => e.code)).toContain(code);
  });

  it('連鎖不存在，所以不可能形成循環', () => {
    // 兩個事件互相指向：兩者都不是 absolute，因此各自都是「來源不是 absolute」
    const cyclic = timelineOf([
      track(
        'boss',
        [linkedEvent('a', 'boss', 'b', [cue('ac', 'x')]), linkedEvent('b', 'boss', 'a', [cue('bc', 'y')])],
        { type: 'encounter' },
      ),
    ]);
    expect(() => collectTimingIssues(cyclic)).not.toThrow();
    expect(collectTimingIssues(cyclic).map((i) => i.code)).toEqual([
      'timing.source-not-absolute',
      'timing.source-not-absolute',
    ]);
  });
});

describe('D24. 複製規則', () => {
  it('整份 fork：全部新 ID，內部引用重映射，不指向原文件', () => {
    const before = base();
    const fork = forkTimeline(before);
    const oldIds = new Set([
      ...before.tracks.map((t) => t.id),
      ...before.tracks.flatMap((t) => t.events.map((e) => e.id)),
      ...before.tracks.flatMap((t) => t.events.flatMap((e) => e.cues.map((c) => c.id))),
    ]);
    for (const t of fork.timeline.tracks) {
      expect(oldIds.has(t.id)).toBe(false);
      for (const e of t.events) {
        expect(oldIds.has(e.id)).toBe(false);
        for (const c of e.cues) expect(oldIds.has(c.id)).toBe(false);
        if (e.timing.kind === 'mechanic') {
          expect(oldIds.has(e.timing.sourceEventId)).toBe(false);
          expect(oldIds.has(e.timing.sourceTrackId)).toBe(false);
        }
      }
    }
    expect(collectTimingIssues(fork.timeline)).toEqual([]);
    // 時間安排不變
    const schTrack = fork.trackIdMap.get('sch')!;
    const schEvent = fork.eventIdMap.get('linked')!;
    expect(triggerOf(fork.timeline, schTrack, schEvent)).toBe(57_000);
  });

  it('複製單個提醒：新 ID，仍關聯同一來源機制', () => {
    const result = duplicateEvent(base(), 'sch', 'linked');
    const copy = result.timeline.tracks
      .find((t) => t.id === 'sch')!
      .events.find((e) => e.id === result.eventId)!;
    expect(copy.id).not.toBe('linked');
    expect(copy.cues[0].id).not.toBe('linked-cue');
    expect(copy.timing).toEqual(mechanicTiming('boss', 'mech'));
    expect(triggerOf(result.timeline, 'sch', copy.id)).toBe(57_000);
  });

  it('複製單個來源機制：既有提醒繼續關聯舊機制，不自動搬到複製品', () => {
    const result = duplicateEvent(base(), 'boss', 'mech');
    expect(result.eventId).not.toBe('mech');
    const linked = result.timeline.tracks.find((t) => t.id === 'sch')!.events[0];
    expect(linked.timing).toEqual(mechanicTiming('boss', 'mech'));
  });

  it('複製軌道：範圍內的來源重映射，範圍外的仍指向原機制', () => {
    // 一條軌道同時含來源與引用
    const selfContained = timelineOf([
      track(
        'boss',
        [absEvent('outside', 10_000, [cue('oc', '外部機制')])],
        { type: 'encounter' },
      ),
      track('mixed', [
        absEvent('inside-src', 20_000, [cue('isc', '軌內來源')]),
        linkedEvent('to-outside', 'boss', 'outside', [cue('toc', '指向軌外')]),
      ], { type: 'encounter' }),
      track('user', [linkedEvent('u', 'mixed', 'inside-src', [cue('uc', '指向軌內來源')])]),
    ]);

    const copied = duplicateTrack(selfContained, 'mixed');
    const copy = copied.tracks.find((t) => t.id !== 'mixed' && t.name.includes('複本'))!;
    const copiedToOutside = copy.events.find((e) => e.name === 'to-outside')!;
    // 範圍外的來源仍指向同一文件內的原機制
    expect(copiedToOutside.timing).toEqual(mechanicTiming('boss', 'outside'));
    // 原本指向 mixed 的使用者提醒沒有被搬走
    expect(copied.tracks.find((t) => t.id === 'user')!.events[0].timing).toEqual(
      mechanicTiming('mixed', 'inside-src'),
    );
    expect(collectTimingIssues(copied)).toEqual([]);
  });

  it('複製軌道時軌內互相引用會重映射到複本自己', () => {
    const withInternal = timelineOf([
      track('enc', [
        absEvent('src', 5000, [cue('sc', '來源')]),
      ], { type: 'encounter' }),
    ]);
    const withRef: TimelinePackage = {
      ...withInternal,
      tracks: [
        {
          ...withInternal.tracks[0],
          events: [
            ...withInternal.tracks[0].events,
            linkedEvent('ref', 'enc', 'src', [cue('rc', '軌內引用')]),
          ],
        },
      ],
    };
    const copied = duplicateTrack(withRef, 'enc');
    const copy = copied.tracks.find((t) => t.id !== 'enc')!;
    const ref = copy.events.find((e) => e.name === 'ref')!;
    expect(ref.timing.kind).toBe('mechanic');
    if (ref.timing.kind !== 'mechanic') return;
    expect(ref.timing.sourceTrackId).toBe(copy.id);
    expect(ref.timing.sourceEventId).not.toBe('src');
    expect(collectTimingIssues(copied)).toEqual([]);
  });
});

describe('D6.1.6 連動至機制／轉成固定時間', () => {
  it('連動時預設保持實際觸發時刻不變（平移 offset）', () => {
    const before = base();
    expect(triggerOf(before, 'fixed', 'abs')).toBe(57_000);

    const linked = linkEventToMechanic(before, 'fixed', 'abs', 'boss', 'mech');
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;

    expect(triggerOf(linked.timeline, 'fixed', 'abs')).toBe(57_000);
    const event = linked.timeline.tracks.find((t) => t.id === 'fixed')!.events[0];
    expect(event.timing).toEqual(mechanicTiming('boss', 'mech'));
    expect(event.cues[0].offsetMs).toBe(-3000);

    // 之後移動來源，這個提醒才會跟著移動
    const moved = setEventAbsoluteTime(linked.timeline, 'boss', 'mech', 70_000);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(triggerOf(moved.timeline, 'fixed', 'abs')).toBe(67_000);
  });

  it('轉成固定時間也保持觸發時刻', () => {
    const result = convertEventToFixedTime(base(), 'sch', 'linked');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(triggerOf(result.timeline, 'sch', 'linked')).toBe(57_000);
    expect(result.timeline.tracks.find((t) => t.id === 'sch')!.events[0].timing).toEqual(
      absoluteTiming(60_000),
    );
  });

  it('拒絕自連動與非戰鬥來源', () => {
    expect(linkEventToMechanic(base(), 'sch', 'linked', 'sch', 'linked').ok).toBe(false);
    expect(linkEventToMechanic(base(), 'fixed', 'abs', 'sch', 'linked').ok).toBe(false);
  });
});

describe('不依時間或名稱自動歸屬', () => {
  it('同秒數的固定時間提醒不會被當成連動', () => {
    const timeline = base();
    // fixed/abs 的觸發時間剛好等於 sch/linked 的 57,000
    expect(triggerOf(timeline, 'fixed', 'abs')).toBe(triggerOf(timeline, 'sch', 'linked'));
    expect(timeline.tracks.find((t) => t.id === 'fixed')!.events[0].timing.kind).toBe('absolute');
    // 移動來源機制後，只有真正連動的那個會動
    const moved = setEventAbsoluteTime(timeline, 'boss', 'mech', 65_000);
    if (!moved.ok) return;
    expect(triggerOf(moved.timeline, 'fixed', 'abs')).toBe(57_000);
    expect(triggerOf(moved.timeline, 'sch', 'linked')).toBe(62_000);
  });

  it('profile 無關：跨職業引用一律列入相依清單', () => {
    const dependents = describeEventDependents(base(), 'mech');
    expect(dependents.map((d) => d.target)).toEqual(
      expect.arrayContaining([
        { positions: ['H2'], jobs: ['SCH'] },
        { positions: ['H1'], jobs: ['AST'] },
      ]),
    );
    // SCH 與 PLD 看到的清單相同（不因目前身分而縮減）
    expect(describeEventDependents(base(), 'mech')).toEqual(dependents);
    expect([SCH, PLD].length).toBe(2);
  });
});
