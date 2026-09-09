import { describe, expect, it } from 'vitest';
import { compileTimeline } from './compiler';
import { EXAMPLE_TIMELINE } from './exampleTimeline';
import { appendMechanicAction, setEventAbsoluteTime } from './edits';
import { buildMechanicIndex, resolveEventTiming } from './resolveEventTiming';
import { absoluteTiming } from './types';

describe('appendMechanicAction', () => {
  it('links the new event to the encounter mechanic by default', () => {
    const source = structuredClone(EXAMPLE_TIMELINE);
    const result = appendMechanicAction(
      source,
      'example-track-boss',
      'example-event-raidwide',
      'example-track-healer',
      {
        eventName: '全體攻擊：學者罩子',
        category: 'mitigation',
        cueText: '全體前罩子',
        cueOffsetMs: -5000,
        priority: 'high',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const target = result.timeline.tracks.find((track) => track.id === 'example-track-healer');
    const added = target?.events.find((event) => event.id === result.eventId);
    // 預設是真正的跨軌連動，不是複製秒數（規格 §5.2.5）
    expect(added).toMatchObject({
      timing: {
        kind: 'mechanic',
        sourceTrackId: 'example-track-boss',
        sourceEventId: 'example-event-raidwide',
      },
      name: '全體攻擊：學者罩子',
      category: 'mitigation',
    });
    // 連動事件不凍結 phase；階段由來源機制即時解析（規格 §3.1）
    expect(added?.phase).toBeUndefined();
    expect(
      resolveEventTiming(added!, 'example-track-healer', buildMechanicIndex(result.timeline)),
    ).toMatchObject({ atMs: 20_000, phase: 'P1' });
    expect(added?.cues).toEqual([
      expect.objectContaining({
        id: result.cueId,
        offsetMs: -5000,
        text: '全體前罩子',
        priority: 'high',
        enabled: true,
      }),
    ]);
    expect(source.tracks.find((track) => track.id === 'example-track-healer')?.events).toHaveLength(1);
  });

  it('can snapshot a fixed time instead, which then does not follow the source', () => {
    const linked = appendMechanicAction(
      EXAMPLE_TIMELINE,
      'example-track-boss',
      'example-event-raidwide',
      'example-track-healer',
      {
        eventName: '固定時間版',
        category: 'mitigation',
        cueText: '固定時間提示',
        cueOffsetMs: -5000,
        priority: 'normal',
        mode: 'fixed',
      },
    );
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    const added = linked.timeline.tracks
      .find((track) => track.id === 'example-track-healer')
      ?.events.find((event) => event.id === linked.eventId);
    expect(added?.timing).toEqual(absoluteTiming(20_000));

    // 移動來源機制之後，固定時間版不動
    const moved = setEventAbsoluteTime(
      linked.timeline,
      'example-track-boss',
      'example-event-raidwide',
      25_000,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const after = moved.timeline.tracks
      .find((track) => track.id === 'example-track-healer')
      ?.events.find((event) => event.id === linked.eventId);
    expect(after?.timing).toEqual(absoluteTiming(20_000));
  });

  it('inserts chronologically without reordering existing same-time events', () => {
    const result = appendMechanicAction(
      EXAMPLE_TIMELINE,
      'example-track-boss',
      'example-event-raidwide',
      'example-track-healer',
      {
        eventName: '第二個同時間事件',
        category: 'heal',
        cueText: '補血',
        cueOffsetMs: 0,
        priority: 'normal',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const target = result.timeline.tracks.find((track) => track.id === 'example-track-healer');
    expect(target?.events.map((event) => event.id)).toEqual([
      'example-event-heal',
      result.eventId,
    ]);
  });

  it('inherits target-track filtering when compiled for the player', () => {
    const result = appendMechanicAction(
      EXAMPLE_TIMELINE,
      'example-track-boss',
      'example-event-raidwide',
      'example-track-healer',
      {
        eventName: '補師減傷',
        category: 'mitigation',
        cueText: '放補師減傷',
        cueOffsetMs: -4000,
        priority: 'normal',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const options = { enabledTrackIds: ['example-track-healer'] };
    const healer = compileTimeline(result.timeline, {
      ...options,
      profile: { position: 'H2', job: 'SCH' },
    });
    const tank = compileTimeline(result.timeline, {
      ...options,
      profile: { position: 'MT', job: 'PLD' },
    });

    expect(healer.cues.map((cue) => cue.id)).toContain(result.cueId);
    expect(tank.cues.map((cue) => cue.id)).not.toContain(result.cueId);
  });

  it('rejects an invalid source, same-track target and out-of-range cue', () => {
    const input = {
      eventName: '動作',
      category: 'job' as const,
      cueText: '提示',
      cueOffsetMs: 0,
      priority: 'normal' as const,
    };

    expect(
      appendMechanicAction(
        EXAMPLE_TIMELINE,
        'example-track-healer',
        'example-event-heal',
        'example-track-dnc',
        input,
      ),
    ).toMatchObject({ ok: false, error: '找不到可作為錨點的王機制事件' });
    expect(
      appendMechanicAction(
        EXAMPLE_TIMELINE,
        'example-track-boss',
        'example-event-raidwide',
        'example-track-boss',
        input,
      ),
    ).toMatchObject({ ok: false, error: '請選擇另一條有效軌道' });
    expect(
      appendMechanicAction(
        EXAMPLE_TIMELINE,
        'example-track-boss',
        'example-event-pull',
        'example-track-dnc',
        { ...input, cueOffsetMs: -16_000 },
      ),
    ).toMatchObject({ ok: false, error: '提示時間早於倒數開始' });
  });
});
