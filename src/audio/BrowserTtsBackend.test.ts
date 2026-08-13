import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock, ManualTicker } from '../engine/Clock';
import { TimelineEngine } from '../engine/TimelineEngine';
import { compileTimeline } from '../timeline/compiler';
import type { TimelinePackage } from '../timeline/types';
import { BrowserTtsBackend } from './BrowserTtsBackend';

/**
 * 倒數 16 秒、提示排在 -15 秒、全域偏移 -4 秒的情境。
 *
 * 時間軸從 -12 秒起跳，-15 秒那句一開始就遲到 3 秒，會在 start() 的同一個 tick
 * 內送進語音佇列。prepare() 如果在 await 之後才 cancel()，就會在下一個 microtask
 * 把這句剛送出的語音取消掉——每一場的第一句都會失敗。
 */

const TIMELINE: TimelinePackage = {
  schemaVersion: 1,
  id: 'tts-start-race',
  meta: { name: 'tts-start-race', encounterId: 'test' },
  encounter: { durationMs: 610_000, countdownMs: 16_000 },
  tracks: [
    {
      id: 'track',
      type: 'encounter',
      name: 'track',
      enabledByDefault: true,
      events: [
        {
          id: 'event',
          atMs: 0,
          name: '倒數15秒',
          category: 'mechanic',
          cues: [{ id: 'cue-15s', offsetMs: -15_000, text: '秘策綠帽主坦，雙坦單盾' }],
        },
      ],
    },
  ],
};

interface SpeechLog {
  calls: string[];
  restore(): void;
}

/** 模擬 Chrome：cancel() 會讓佇列中尚未播完的 utterance 觸發 onerror。 */
function stubSpeechSynthesis(): SpeechLog {
  const originalUtterance = window.SpeechSynthesisUtterance;
  const originalSynth = window.speechSynthesis;
  const calls: string[] = [];
  const queue: { onerror?: ((event: unknown) => void) | null }[] = [];

  (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance = class {
    text: string;
    lang = '';
    rate = 1;
    pitch = 1;
    volume = 1;
    voice: unknown = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  };

  (window as unknown as Record<string, unknown>).speechSynthesis = {
    speak(utterance: { text: string }) {
      calls.push(`speak:${utterance.text}`);
      queue.push(utterance as never);
    },
    cancel() {
      calls.push('cancel');
      while (queue.length) queue.shift()?.onerror?.({ error: 'canceled' });
    },
    // 必須回傳非空清單：loadVoices() 才會走「立即 resolve」那條路徑，
    // 和真實 Chrome 一樣。回空陣列會改走 2 秒 timeout，測試就抓不到問題。
    getVoices: () => [{ voiceURI: 'test-voice', name: 'test', lang: 'zh-TW' }],
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };

  return {
    calls,
    restore() {
      (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance = originalUtterance;
      (window as unknown as Record<string, unknown>).speechSynthesis = originalSynth;
    },
  };
}

describe('BrowserTtsBackend + engine start', () => {
  let speech: SpeechLog;

  beforeEach(() => {
    speech = stubSpeechSynthesis();
  });

  afterEach(() => {
    speech.restore();
  });

  it('不會被 prepare() 的暖機 cancel 打斷開場第一句', async () => {
    const clock = new FakeClock(1000);
    const ticker = new ManualTicker();
    const backend = new BrowserTtsBackend({ clock });
    const telemetry: string[] = [];
    backend.setTelemetryListener((event) => telemetry.push(`${event.cueId}:${event.phase}`));

    const engine = new TimelineEngine({ audio: backend, clock, ticker, notifyIntervalMs: 0 });
    engine.setSessionOffsetMs(-4000);

    const compiled = compileTimeline(TIMELINE, {
      profile: { position: 'MT', job: 'PLD' },
      enabledTrackIds: ['track'],
      countdownMs: 16_000,
    });

    // 播放器的 beginPull()：load() 之後緊接著 start()
    engine.load(compiled);
    engine.start();

    // 讓 prepare() 的 await 續行跑完
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const speakIndex = speech.calls.indexOf('speak:秘策綠帽主坦，雙坦單盾');
    expect(speakIndex).toBeGreaterThanOrEqual(0);
    // 送出語音之後不能再有 cancel()
    expect(speech.calls.indexOf('cancel', speakIndex)).toBe(-1);
    expect(telemetry).not.toContain('cue-15s:error');
  });
});
