import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NullAudioBackend } from '../audio/AudioBackend';
import { AudioOwnershipManager } from '../audio/AudioOwnership';
import { OwnedAudioBackend } from '../audio/OwnedAudioBackend';
import { FakeClock, ManualTicker } from '../engine/Clock';
import { TimelineEngine } from '../engine/TimelineEngine';
import { buildPlaybackPlan, type PlaybackPlanResult } from '../timeline/playbackPlan';
import { absEvent, cue, PLD, planInput, timelineOf, track } from '../test/planFixtures';
import { usePlaybackStart } from './usePlaybackStart';

/**
 * §9 B.12 in isolation: the confirmation belongs to exactly one request, and a
 * fingerprint change while a dialog is open makes it stale instead of starting a
 * plan that no longer matches the inputs.
 */

function makeEngine() {
  const audio = new NullAudioBackend();
  const ownership = new AudioOwnershipManager();
  const owned = new OwnedAudioBackend(audio, ownership);
  const clock = new FakeClock(0);
  const ticker = new ManualTicker();
  const engine = new TimelineEngine({ audio: owned, clock, ticker });
  return { audio, ownership, owned, clock, ticker, engine };
}

function colliding() {
  return timelineOf(
    [
      track(
        'boss',
        [absEvent('b', 10_000, [cue('c1', '第一句'), cue('c2', '第二句', { offsetMs: 500 })])],
        { type: 'encounter' },
      ),
    ],
    { encounter: { durationMs: 60_000, countdownMs: 16_000 } },
  );
}

/** Boss track plus a Paladin track, so there is no risk warning at all. */
function clean() {
  return timelineOf(
    [
      track('boss', [absEvent('b', 10_000, [cue('c1', '一句')])], { type: 'encounter' }),
      track('mine', [absEvent('m', 20_000, [cue('mc', '我的提醒')])], {
        type: 'job',
        target: { positions: ['MT'], jobs: ['PLD'] },
      }),
    ],
    { encounter: { durationMs: 60_000, countdownMs: 16_000 } },
  );
}

function setup(initialPlan: PlaybackPlanResult, quickStart = false) {
  const rig = makeEngine();
  const planBox = { current: initialPlan };
  const startSpy = vi.spyOn(rig.engine, 'start');
  const loadSpy = vi.spyOn(rig.engine, 'load');

  const view = renderHook(
    ({ plan }: { plan: PlaybackPlanResult }) => {
      planBox.current = plan;
      return usePlaybackStart({
        engine: rig.engine,
        ownedBackend: rig.owned,
        engineState: rig.engine.getSnapshot().state,
        quickStart,
        getPlan: () => planBox.current,
      });
    },
    { initialProps: { plan: initialPlan } },
  );

  return { ...rig, view, startSpy, loadSpy, planBox };
}

const planFor = (timeline: ReturnType<typeof clean>, over = {}) =>
  buildPlaybackPlan(planInput(timeline, PLD, timeline.tracks.map((t) => t.id), over));

describe('B12. 確認只屬於這一次請求', () => {
  it('fingerprint 變了就標記為失效，確認會重新檢查而不是用舊計畫開始', () => {
    const first = planFor(colliding());
    const { view, startSpy, planBox } = setup(first);

    act(() => view.result.current.requestStart());
    expect(view.result.current.pending?.stage).toBe('risk-confirm');
    expect(view.result.current.pending?.stale).toBe(false);
    expect(startSpy).not.toHaveBeenCalled();

    // 輸入在彈窗開著時改變（例如另一個分頁改了設定）
    const changed = planFor(colliding(), { countdownMs: 5000 });
    expect(changed.fingerprint).not.toBe(first.fingerprint);
    act(() => {
      planBox.current = changed;
      view.rerender({ plan: changed });
    });
    expect(view.result.current.pending?.stale).toBe(true);

    // 確認時重新跑一次流程；新計畫仍有需要確認的警告 → 再次要求確認，沒有開始
    act(() => view.result.current.confirm());
    expect(startSpy).not.toHaveBeenCalled();
    expect(view.result.current.pending?.stage).toBeDefined();
  });

  it('沒有變動時，確認就真的開始，而且只 load/start 一次', () => {
    const plan = planFor(clean());
    const { view, startSpy, loadSpy } = setup(plan);

    act(() => view.result.current.requestStart());
    expect(view.result.current.pending?.stage).toBe('ready-summary');

    act(() => view.result.current.confirm());
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(view.result.current.pending).toBeNull();

    // 重複確認不會再開一場
    act(() => view.result.current.confirm());
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('沒有永久略過警告的開關：每次請求都要重新確認', () => {
    const plan = planFor(colliding());
    const { view, startSpy, engine } = setup(plan);

    act(() => view.result.current.requestStart());
    act(() => view.result.current.confirm());
    expect(startSpy).toHaveBeenCalledTimes(1);

    act(() => engine.wipe());
    act(() => view.result.current.requestStart());
    // 又是 risk-confirm，不是直接開始
    expect(view.result.current.pending?.stage).toBe('risk-confirm');
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('invalidate 讓待處理的請求無效，之後的 confirm 是 no-op', () => {
    const plan = planFor(clean());
    const { view, startSpy } = setup(plan);

    act(() => view.result.current.requestStart());
    act(() => view.result.current.invalidate());
    expect(view.result.current.pending).toBeNull();
    act(() => view.result.current.confirm());
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('計畫不能開始時只顯示阻擋，不會 load 引擎', () => {
    const plan = buildPlaybackPlan(planInput(clean(), PLD, []));
    expect(plan.canStart).toBe(false);
    const { view, startSpy, loadSpy } = setup(plan);

    act(() => view.result.current.requestStart());
    expect(view.result.current.pending?.stage).toBe('blocked');
    act(() => view.result.current.confirm());
    expect(loadSpy).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('Quick Start 只跳過一般摘要，不跳過風險確認', () => {
    const risky = setup(planFor(colliding()), true);
    act(() => risky.view.result.current.requestStart());
    expect(risky.view.result.current.pending?.stage).toBe('risk-confirm');
    expect(risky.startSpy).not.toHaveBeenCalled();

    const fine = setup(planFor(clean()), true);
    act(() => fine.view.result.current.requestStart());
    expect(fine.view.result.current.pending).toBeNull();
    expect(fine.startSpy).toHaveBeenCalledTimes(1);
  });

  it('取得 ownership 之後才 load，讓 prepare 的暖機有裝置可用', () => {
    const plan = planFor(clean());
    const { view, owned, loadSpy, ownership } = setup(plan, true);
    const order: string[] = [];
    loadSpy.mockImplementation(() => order.push('load'));
    const acquire = vi.spyOn(owned, 'acquireForPlayback').mockImplementation(() => {
      order.push('acquire');
    });

    act(() => view.result.current.requestStart());
    expect(order).toEqual(['acquire', 'load']);
    expect(acquire).toHaveBeenCalled();
    expect(ownership.currentKind).toBeNull(); // 因為 acquire 被 mock 掉
  });

  it('播放中不會被再次 load（不會半場重開）', () => {
    const plan = planFor(clean());
    const { view, startSpy, loadSpy, engine } = setup(plan, true);

    act(() => view.result.current.requestStart());
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot().state).not.toBe('idle');

    loadSpy.mockClear();
    act(() => view.result.current.requestStart());
    act(() => view.result.current.togglePlayback()); // 這時是暫停
    expect(loadSpy).not.toHaveBeenCalled();
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('togglePlayback：paused 會 resume 同一場，不是新的一場', () => {
    const plan = planFor(clean());
    const { view, engine, startSpy } = setup(plan, true);

    act(() => view.result.current.requestStart());
    const pullId = engine.getSnapshot().pullId;
    act(() => engine.pause());
    act(() => view.result.current.togglePlayback());
    expect(engine.getSnapshot().state).not.toBe('paused');
    expect(engine.getSnapshot().pullId).toBe(pullId);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });
});
