import { describe, expect, it } from 'vitest';
import { absEvent, AST, cue, SCH, timelineOf, track } from '../test/planFixtures';
import {
  addQuickReminder,
  ensurePersonalTrack,
  findPersonalTrack,
  PERSONAL_TRACK_PURPOSE,
  reminderOffsetMs,
  validateQuickReminder,
  type QuickReminderDraft,
} from './personalReminders';
import { duplicateTrack, forkTimeline } from './edits';
import { buildMechanicIndex, resolveEventTiming } from './resolveEventTiming';
import { validateTimeline } from './validator';
import { combineTargets } from './target';

function base() {
  return timelineOf([
    track(
      'boss',
      [
        absEvent('mech-60', 60_000, [cue('mech-60-cue', '第二次全體傷害')], {
          name: '第二次全體傷害',
          phase: 'P2',
          category: 'raidwide',
        }),
      ],
      { type: 'encounter', name: 'Boss Mechanics' },
    ),
  ]);
}

const draft = (over: Partial<QuickReminderDraft> = {}): QuickReminderDraft => ({
  sourceTrackId: 'boss',
  sourceEventId: 'mech-60',
  text: '下野戰，準備集合',
  when: 'before',
  seconds: 3,
  ...over,
});

describe('C. 快速追加', () => {
  it('C15. 60,000ms 機制的「前 3 秒」得到明確 source 引用與 57,000ms 觸發，對象是目前身分', () => {
    const result = addQuickReminder(base(), SCH, draft());
    expect(result.ok).toBe(true);

    const trackRow = result.timeline.tracks.find((t) => t.id === result.trackId)!;
    const event = trackRow.events.find((e) => e.id === result.eventId)!;

    expect(event.timing).toEqual({
      kind: 'mechanic',
      sourceTrackId: 'boss',
      sourceEventId: 'mech-60',
    });
    expect(event.cues[0].offsetMs).toBe(-3000);

    const resolved = resolveEventTiming(event, trackRow.id, buildMechanicIndex(result.timeline));
    expect(resolved.atMs).toBe(60_000);
    expect(resolved.atMs! + event.cues[0].offsetMs).toBe(57_000);
    // 階段由來源即時解析，不留過期複本
    expect(resolved.phase).toBe('P2');
    expect(event.phase).toBeUndefined();

    // 對象只由軌道限制，沒有繼承 Boss 的「所有人」，也沒有帶入別的職業
    expect(trackRow.target).toEqual({ positions: ['H2'], jobs: ['SCH'] });
    expect(event.cues[0].target).toBeUndefined();
    expect(combineTargets(trackRow.target, event.cues[0].target)).toEqual({
      positions: ['H2'],
      jobs: ['SCH'],
    });
    expect(event.cues[0].enabled).toBe(true);
    expect(event.cues[0].priority).toBe('normal');
  });

  it('前／當下／後 分別換算成 -N、0、+N 毫秒，且不會雙重加偏移', () => {
    expect(reminderOffsetMs('before', 3)).toBe(-3000);
    expect(reminderOffsetMs('at', 99)).toBe(0);
    expect(reminderOffsetMs('after', 1.5)).toBe(1500);

    for (const [when, seconds, expected] of [
      ['before', 1, 59_000],
      ['at', 0, 60_000],
      ['after', 2.5, 62_500],
    ] as const) {
      const result = addQuickReminder(base(), SCH, draft({ when, seconds }));
      const trackRow = result.timeline.tracks.find((t) => t.id === result.trackId)!;
      const event = trackRow.events.find((e) => e.id === result.eventId)!;
      const resolved = resolveEventTiming(event, trackRow.id, buildMechanicIndex(result.timeline));
      // 只有 cue.offsetMs 承載偏移；event 沒有第二份時間
      expect(resolved.atMs).toBe(60_000);
      expect(resolved.atMs! + event.cues[0].offsetMs).toBe(expected);
    }
  });

  it('C16. 沒有個人軌道時自動建立；再次新增復用；連點不重複建立', () => {
    const first = addQuickReminder(base(), SCH, draft());
    expect(first.createdTrack).toBe(true);
    expect(first.timeline.tracks.filter((t) => t.purpose === PERSONAL_TRACK_PURPOSE)).toHaveLength(1);

    const second = addQuickReminder(first.timeline, SCH, draft({ text: '第二句' }));
    expect(second.createdTrack).toBe(false);
    expect(second.timeline.tracks.filter((t) => t.purpose === PERSONAL_TRACK_PURPOSE)).toHaveLength(1);
    expect(second.timeline.tracks.find((t) => t.id === second.trackId)!.events).toHaveLength(2);

    // 同一份文件連續 ensure（等同雙擊）不會多一條
    const a = ensurePersonalTrack(second.timeline, SCH);
    const b = ensurePersonalTrack(a.timeline, SCH);
    expect(b.created).toBe(false);
    expect(b.timeline.tracks.filter((t) => t.purpose === PERSONAL_TRACK_PURPOSE)).toHaveLength(1);
  });

  it('不同身分各有自己的個人軌道，驗證器也接受', () => {
    const withSch = addQuickReminder(base(), SCH, draft()).timeline;
    const withBoth = addQuickReminder(withSch, AST, draft({ text: '占星的提醒' })).timeline;
    expect(withBoth.tracks.filter((t) => t.purpose === PERSONAL_TRACK_PURPOSE)).toHaveLength(2);
    expect(findPersonalTrack(withBoth, SCH)!.target).toEqual({ positions: ['H2'], jobs: ['SCH'] });
    expect(findPersonalTrack(withBoth, AST)!.target).toEqual({ positions: ['H1'], jobs: ['AST'] });
    expect(validateTimeline(withBoth).errors).toEqual([]);
  });

  it('同一身分出現兩條系統個人軌道是阻擋錯誤', () => {
    const one = addQuickReminder(base(), SCH, draft()).timeline;
    const duplicated = {
      ...one,
      tracks: [...one.tracks, { ...findPersonalTrack(one, SCH)!, id: 'copy' }],
    };
    expect(validateTimeline(duplicated).errors.map((e) => e.code)).toContain(
      'track.duplicate-personal-track',
    );
  });

  it('C24d. 複製個人軌道會變成一般自訂軌（不重複 system purpose）', () => {
    const one = addQuickReminder(base(), SCH, draft()).timeline;
    const personalId = findPersonalTrack(one, SCH)!.id;
    const copied = duplicateTrack(one, personalId);
    expect(copied.tracks.filter((t) => t.purpose === PERSONAL_TRACK_PURPOSE)).toHaveLength(1);
    const copy = copied.tracks.find((t) => t.id !== personalId && t.name.includes('複本'))!;
    expect(copy.purpose).toBeUndefined();
    // 內容與 target 保留
    expect(copy.target).toEqual({ positions: ['H2'], jobs: ['SCH'] });
    expect(copy.events).toHaveLength(1);
    expect(validateTimeline(copied).errors).toEqual([]);
  });

  it('C17. 空白文字、超出可用時間、來源失效都不能儲存，並指出欄位', () => {
    const blank = validateQuickReminder(base(), draft({ text: '   ' }));
    expect(blank.ok).toBe(false);
    expect(blank.errors.map((e) => e.field)).toContain('text');

    const tooEarly = validateQuickReminder(base(), draft({ when: 'before', seconds: 100 }));
    expect(tooEarly.ok).toBe(false);
    expect(tooEarly.errors.map((e) => e.field)).toContain('time');

    const tooLate = validateQuickReminder(base(), draft({ when: 'after', seconds: 10_000 }));
    expect(tooLate.ok).toBe(false);
    expect(tooLate.errors.map((e) => e.field)).toContain('time');

    const missing = validateQuickReminder(base(), draft({ sourceEventId: 'nope' }));
    expect(missing.ok).toBe(false);
    expect(missing.errors.map((e) => e.field)).toContain('source');

    for (const seconds of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const bad = validateQuickReminder(base(), draft({ seconds }));
      expect(bad.ok, String(seconds)).toBe(false);
    }
  });

  it('C17b. 驗證失敗時不會產生任何副作用（沒有空軌道）', () => {
    const start = base();
    const result = addQuickReminder(start, SCH, draft({ text: '' }));
    expect(result.ok).toBe(false);
    expect(result.timeline).toBe(start);
    expect(result.timeline.tracks).toHaveLength(1);
  });

  it('C18. 內建範本 fork 後引用正確映射，原文件位元內容未改', () => {
    const builtin = base();
    const snapshot = JSON.stringify(builtin);

    const fork = forkTimeline(builtin, { name: '複本' });
    const mappedTrack = fork.trackIdMap.get('boss')!;
    const mappedEvent = fork.eventIdMap.get('mech-60')!;
    expect(mappedTrack).not.toBe('boss');
    expect(mappedEvent).not.toBe('mech-60');

    const added = addQuickReminder(fork.timeline, SCH, {
      ...draft(),
      sourceTrackId: mappedTrack,
      sourceEventId: mappedEvent,
    });
    expect(added.ok).toBe(true);

    const trackRow = added.timeline.tracks.find((t) => t.id === added.trackId)!;
    const event = trackRow.events.find((e) => e.id === added.eventId)!;
    expect(event.timing).toEqual({
      kind: 'mechanic',
      sourceTrackId: mappedTrack,
      sourceEventId: mappedEvent,
    });
    // 引用解析得到與原本相同的秒數
    const resolved = resolveEventTiming(event, trackRow.id, buildMechanicIndex(added.timeline));
    expect(resolved.atMs! + event.cues[0].offsetMs).toBe(57_000);

    // 原始文件完全沒被動到
    expect(JSON.stringify(builtin)).toBe(snapshot);
    expect(validateTimeline(added.timeline).errors).toEqual([]);
  });

  it('回報個人軌道當下是否啟用，讓 UI 不會讓人誤以為一定會播', () => {
    const one = addQuickReminder(base(), SCH, draft()).timeline;
    const personalId = findPersonalTrack(one, SCH)!.id;
    const off = {
      ...one,
      tracks: one.tracks.map((t) => (t.id === personalId ? { ...t, enabledByDefault: false } : t)),
    };
    const result = addQuickReminder(off, SCH, draft({ text: '再一句' }));
    expect(result.trackEnabledByDefault).toBe(false);
  });
});
