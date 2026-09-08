import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NullAudioBackend } from '../audio/AudioBackend';
import { AudioOwnershipConflict, AudioOwnershipManager } from '../audio/AudioOwnership';
import { OwnedAudioBackend } from '../audio/OwnedAudioBackend';
import { FakeClock, ManualTicker } from '../engine/Clock';
import { PreviewController, previewWindowFor } from './PreviewController';
import type { CompiledCue, ResolvedAudioConfig } from '../timeline/types';

const AUDIO: ResolvedAudioConfig = { lang: 'zh-TW', rate: 1.15, pitch: 1, volume: 1 };

function compiled(id: string, triggerMs: number, over: Partial<CompiledCue> = {}): CompiledCue {
  return {
    id,
    trackId: 't',
    eventId: 'e',
    eventName: 'E',
    eventAtMs: triggerMs,
    triggerMs,
    offsetMs: 0,
    category: 'custom',
    text: id,
    priority: 'normal',
    audio: AUDIO,
    ...over,
  };
}

function setup() {
  const audio = new NullAudioBackend();
  const ownership = new AudioOwnershipManager();
  const clock = new FakeClock(0);
  const ticker = new ManualTicker();
  const preview = new PreviewController({ audio, ownership, clock, ticker, drainMs: 1000 });
  return { audio, ownership, clock, ticker, preview };
}

describe('E28. 片段預覽的區間與時間關係', () => {
  it('以觸發時刻為中心、預設前後 5 秒，並夾在 [-倒數, 全長]', () => {
    expect(previewWindowFor({ cues: [], centerMs: 30_000, minMs: -15_000, maxMs: 600_000 })).toEqual({
      startMs: 25_000,
      endMs: 35_000,
      centerMs: 30_000,
    });
    // 開頭邊界：不會早於 -倒數
    expect(previewWindowFor({ cues: [], centerMs: -13_000, minMs: -15_000, maxMs: 600_000 })).toEqual({
      startMs: -15_000,
      endMs: -8000,
      centerMs: -13_000,
    });
    // 結尾邊界：不會超過全長
    expect(previewWindowFor({ cues: [], centerMs: 598_000, minMs: -15_000, maxMs: 600_000 })).toEqual({
      startMs: 593_000,
      endMs: 600_000,
      centerMs: 598_000,
    });
  });

  it('從區間開始直接播，保持句間相對時間，不播區間外的句子', () => {
    const { audio, clock, ticker, preview } = setup();
    const cues = [
      compiled('before-window', 20_000),
      compiled('a', 28_000),
      compiled('b', 29_500),
      compiled('after-window', 40_000),
    ];

    const result = preview.start({ cues, centerMs: 30_000, minMs: -15_000, maxMs: 600_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cueCount).toBe(2);

    // 不從 0 秒跑起：一開始就在 25s，且第一句 28s 還沒到
    expect(audio.played).toHaveLength(0);

    clock.advance(3000); // 預覽時間 28.0s
    ticker.fire();
    expect(audio.played.map((c) => c.id)).toEqual(['a']);

    clock.advance(1000); // 29.0s：還沒到 29.5s，不是一次全送
    ticker.fire();
    expect(audio.played.map((c) => c.id)).toEqual(['a']);

    clock.advance(500); // 29.5s
    ticker.fire();
    expect(audio.played.map((c) => c.id)).toEqual(['a', 'b']);

    clock.advance(6000); // 走到區間結束
    ticker.fire();
    expect(preview.getSnapshot().state).toBe('draining');
    expect(audio.played.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('負時間區間也能播', () => {
    const { audio, clock, ticker, preview } = setup();
    const cues = [compiled('countdown', -10_000)];
    const result = preview.start({ cues, centerMs: -10_000, minMs: -15_000, maxMs: 600_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.window).toEqual({ startMs: -15_000, endMs: -5000, centerMs: -10_000 });

    clock.advance(5000); // -10s
    ticker.fire();
    expect(audio.played.map((c) => c.id)).toEqual(['countdown']);
  });

  it('區間結束後不再送新句子，drain 完才收工', () => {
    const { audio, clock, ticker, preview } = setup();
    // 區間是 [-5s, +5s]，從 -5s 起算，所以要推進 10 秒才到結尾
    preview.start({ cues: [compiled('a', 0)], centerMs: 0, minMs: -15_000, maxMs: 600_000 });
    clock.advance(5000);
    ticker.fire();
    expect(audio.played).toHaveLength(1);
    expect(preview.getSnapshot().state).toBe('playing');

    clock.advance(5000);
    ticker.fire();
    expect(preview.getSnapshot().state).toBe('draining');

    clock.advance(1100);
    ticker.fire();
    expect(preview.getSnapshot().state).toBe('stopped');
    // drain 期間沒有再送
    expect(audio.played).toHaveLength(1);
  });
});

describe('E27. 預覽不影響正式場次', () => {
  it('使用 cue 自己解析後的 audio 設定（含每句覆蓋值）', () => {
    const { audio, preview } = setup();
    const override: ResolvedAudioConfig = { lang: 'ja-JP', rate: 0.8, pitch: 1.2, volume: 0.5 };
    preview.previewSingleCue(compiled('x', 1000, { audio: override }));
    expect(audio.played[0].audio).toEqual(override);
  });

  it('預覽用獨立 clock／ticker，不觸碰真實引擎的 pullId 或 recorder', () => {
    const { preview, ticker } = setup();
    // ManualTicker 只有在預覽自己 start 之後才有 callback
    expect(ticker.callback).toBeNull();
    preview.previewSingleCue(compiled('x', 0));
    expect(ticker.callback).not.toBeNull();
    preview.stop(null);
    expect(ticker.callback).toBeNull();
  });
});

describe('E29. 重複試聽、停止、離開不留殘留', () => {
  it('連續試聽先停止上一段，不無限疊加', () => {
    const { audio, ownership, preview } = setup();
    const cancel = vi.spyOn(audio, 'cancelAll');

    preview.previewSingleCue(compiled('a', 0));
    preview.previewSingleCue(compiled('b', 0));
    preview.previewSingleCue(compiled('c', 0));

    expect(audio.played.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    // 每次重新取得 lease 時都清掉前一段
    expect(cancel).toHaveBeenCalled();
    expect(ownership.currentKind).toBe('cue-preview');
  });

  it('停止會取消剩餘語音並釋放 ownership', () => {
    const { audio, ownership, preview } = setup();
    const cancel = vi.spyOn(audio, 'cancelAll');
    preview.start({ cues: [compiled('a', 0), compiled('b', 3000)], centerMs: 0, minMs: -15_000, maxMs: 600_000 });
    expect(ownership.currentKind).toBe('segment-preview');

    preview.stop(null);
    expect(cancel).toHaveBeenCalled();
    expect(ownership.currentKind).toBeNull();
    expect(preview.getSnapshot().pendingCount).toBe(0);
  });

  it('dispose 後 ticker 與 listener 都清空', () => {
    const { ownership, ticker, preview } = setup();
    const seen: number[] = [];
    preview.subscribe(() => seen.push(1));
    preview.start({ cues: [compiled('a', 0)], centerMs: 0, minMs: -15_000, maxMs: 600_000 });
    const before = seen.length;
    preview.dispose();
    expect(ticker.callback).toBeNull();
    expect(ownership.currentKind).toBeNull();
    // listener 已移除：之後的狀態變化不再通知
    preview.stop(null);
    expect(seen.length).toBe(before + 1);
  });

  it('停止後過期的 tick 不會再送語音', () => {
    const { audio, clock, ticker, preview } = setup();
    preview.start({ cues: [compiled('a', 5000)], centerMs: 5000, minMs: -15_000, maxMs: 600_000 });
    preview.stop(null);
    clock.advance(10_000);
    ticker.fire();
    expect(audio.played).toHaveLength(0);
  });
});

describe('E30. 正式播放與預覽互斥', () => {
  let audio: NullAudioBackend;
  let ownership: AudioOwnershipManager;

  beforeEach(() => {
    audio = new NullAudioBackend();
    ownership = new AudioOwnershipManager();
  });

  it('正式播放持有裝置時，編輯器試聽被拒絕且不會取消正式語音', () => {
    const owned = new OwnedAudioBackend(audio, ownership);
    owned.acquireForPlayback();
    const cancel = vi.spyOn(audio, 'cancelAll');

    const preview = new PreviewController({
      audio,
      ownership,
      clock: new FakeClock(0),
      ticker: new ManualTicker(),
    });
    const result = preview.previewSingleCue(compiled('x', 0));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('正式播放進行中');
    expect(cancel).not.toHaveBeenCalled();
    expect(ownership.currentKind).toBe('playback');
    expect(audio.played).toHaveLength(0);
  });

  it('正式播放可以搶走預覽，但預覽被撤銷時不會 cancel 新主人的語音', () => {
    const preview = new PreviewController({
      audio,
      ownership,
      clock: new FakeClock(0),
      ticker: new ManualTicker(),
    });
    preview.start({ cues: [compiled('a', 3000)], centerMs: 3000, minMs: -15_000, maxMs: 600_000 });
    expect(ownership.currentKind).toBe('segment-preview');

    const owned = new OwnedAudioBackend(audio, ownership);
    const cancelCalls: number[] = [];
    vi.spyOn(audio, 'cancelAll').mockImplementation(() => cancelCalls.push(Date.now()));

    owned.acquireForPlayback();
    expect(ownership.currentKind).toBe('playback');
    expect(preview.getSnapshot().state).toBe('stopped');
    // 只有接手者清一次隊列；被撤銷的預覽不再自己 cancel
    expect(cancelCalls).toHaveLength(1);
  });

  it('尚未取得 ownership 的 prepare / cancelAll 不會影響別人', async () => {
    const preview = new PreviewController({
      audio,
      ownership,
      clock: new FakeClock(0),
      ticker: new ManualTicker(),
    });
    preview.previewSingleCue(compiled('a', 0));
    expect(ownership.currentKind).toBe('cue-preview');

    const owned = new OwnedAudioBackend(audio, ownership);
    const cancel = vi.spyOn(audio, 'cancelAll');
    const prepare = vi.spyOn(audio, 'prepare');

    // 這正是 engine.load() 在 idle 時會做的事
    await owned.prepare([compiled('a', 0)]);
    owned.cancelAll();

    expect(prepare).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(ownership.currentKind).toBe('cue-preview');
  });

  it('play() 會自動取得 ownership（cue 響了代表有一場在跑）', () => {
    const owned = new OwnedAudioBackend(audio, ownership);
    expect(owned.holdsLease).toBe(false);
    owned.play(compiled('a', 0));
    expect(owned.holdsLease).toBe(true);
    expect(ownership.currentKind).toBe('playback');
    expect(audio.played).toHaveLength(1);
  });

  it('正式結束後釋放，預覽才能拿到裝置', () => {
    const owned = new OwnedAudioBackend(audio, ownership);
    owned.acquireForPlayback();
    const preview = new PreviewController({
      audio,
      ownership,
      clock: new FakeClock(0),
      ticker: new ManualTicker(),
    });
    expect(preview.previewSingleCue(compiled('a', 0)).ok).toBe(false);

    owned.releasePlayback();
    expect(ownership.currentKind).toBeNull();
    expect(preview.previewSingleCue(compiled('a', 0)).ok).toBe(true);
  });

  it('設定頁試聽也受同一套仲裁', () => {
    const owned = new OwnedAudioBackend(audio, ownership);
    owned.acquireForPlayback();
    expect(ownership.canAcquire('settings-preview')).toBe(false);
    expect(() => ownership.acquire('settings-preview')).toThrow(AudioOwnershipConflict);

    owned.releasePlayback();
    expect(ownership.canAcquire('settings-preview')).toBe(true);
  });

  it('同時最多一個 owner', () => {
    const a = ownership.acquire('cue-preview');
    expect(ownership.currentKind).toBe('cue-preview');
    const b = ownership.acquire('segment-preview');
    expect(a.active).toBe(false);
    expect(b.active).toBe(true);
    expect(ownership.currentKind).toBe('segment-preview');

    // 過期的 lease 釋放不會影響現任
    a.release();
    expect(ownership.currentKind).toBe('segment-preview');
  });
});
