import { beforeEach, describe, expect, it } from 'vitest';
import { NullAudioBackend } from '../audio/AudioBackend';
import { compileTimeline } from '../timeline/compiler';
import type { CompiledTimeline, TimelinePackage } from '../timeline/types';
import { FakeClock, ManualTicker } from './Clock';
import { TimelineEngine, type EngineEvent } from './TimelineEngine';

const TIMELINE: TimelinePackage = {
  schemaVersion: 1,
  id: 'engine-test',
  meta: { name: 'Engine Test', encounterId: 'test' },
  encounter: { durationMs: 60_000, countdownMs: 15_000 },
  tracks: [
    {
      id: 'track',
      type: 'encounter',
      name: 'Track',
      enabledByDefault: true,
      events: [
        {
          id: 'e-pull',
          atMs: 0,
          name: 'Pull',
          category: 'mechanic',
          cues: [{ id: 'c-countdown', offsetMs: -2000, text: '兩秒後開始' }],
        },
        {
          id: 'e-first',
          atMs: 10_000,
          name: 'First',
          category: 'mechanic',
          cues: [{ id: 'c-first', offsetMs: 0, text: '第一次' }],
        },
        {
          id: 'e-second',
          atMs: 20_000,
          name: 'Second',
          category: 'mechanic',
          cues: [{ id: 'c-second', offsetMs: 0, text: '第二次' }],
        },
      ],
    },
  ],
};

function compiled(countdownMs?: number): CompiledTimeline {
  return compileTimeline(TIMELINE, {
    profile: { position: 'MT', job: 'PLD' },
    enabledTrackIds: ['track'],
    countdownMs,
  });
}

interface Harness {
  clock: FakeClock;
  ticker: ManualTicker;
  audio: NullAudioBackend;
  engine: TimelineEngine;
  events: EngineEvent[];
  /** Jump the clock and run a single tick — simulates a browser stall. */
  advance(ms: number): void;
  /** Advance in 50ms tick steps, like the real scheduler. */
  run(ms: number, stepMs?: number): void;
}

function harness(options: { maxLateMs?: number; countdownMs?: number } = {}): Harness {
  const clock = new FakeClock(1000);
  const ticker = new ManualTicker();
  const audio = new NullAudioBackend();
  const engine = new TimelineEngine({
    audio,
    clock,
    ticker,
    maxLateMs: options.maxLateMs,
    notifyIntervalMs: 0,
  });
  const events: EngineEvent[] = [];
  engine.addEventListener((event) => events.push(event));
  engine.load(compiled(options.countdownMs));
  return {
    clock,
    ticker,
    audio,
    engine,
    events,
    advance(ms: number) {
      clock.advance(ms);
      ticker.fire();
    },
    run(ms: number, stepMs = 50) {
      let remaining = ms;
      while (remaining > 0) {
        const step = Math.min(stepMs, remaining);
        clock.advance(step);
        ticker.fire();
        remaining -= step;
      }
    },
  };
}

describe('TimelineEngine', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  it('starts idle at -countdown', () => {
    expect(h.engine.getSnapshot().state).toBe('idle');
    expect(h.engine.getSnapshot().timelineElapsedMs).toBe(-15_000);
  });

  it('enters countdown on START and running at t=0', () => {
    h.engine.start();
    expect(h.engine.getSnapshot().state).toBe('countdown');
    h.run(14_000);
    expect(h.engine.getSnapshot().state).toBe('countdown');
    h.run(1000);
    expect(h.engine.getSnapshot().state).toBe('running');
    expect(h.engine.getSnapshot().timelineElapsedMs).toBe(0);
  });

  it('fires negative-time cues during the countdown', () => {
    h.engine.start();
    h.run(13_000); // timeline -2000
    expect(h.audio.played.map((cue) => cue.id)).toEqual(['c-countdown']);
    expect(h.engine.getSnapshot().state).toBe('countdown');
  });

  it('fires cues in order and tracks the current cue and next 3', () => {
    h.engine.start();
    h.run(25_000); // timeline 10_000
    expect(h.audio.played.map((cue) => cue.id)).toEqual(['c-countdown', 'c-first']);
    const snapshot = h.engine.getSnapshot();
    expect(snapshot.currentCue?.id).toBe('c-first');
    expect(snapshot.nextCues.map((cue) => cue.id)).toEqual(['c-second']);
    expect(snapshot.firedCount).toBe(2);
  });

  it('reports engine lateness', () => {
    h.engine.start();
    h.run(24_950); // timeline 9950 — the 10s cue is not due yet
    h.advance(250); // tick lands 200ms after it was due
    const fired = h.events.filter((event) => event.type === 'cue-fired');
    const last = fired[fired.length - 1];
    expect(last.type === 'cue-fired' && last.engineLateMs).toBe(200);
  });

  it('skips cues later than maxLateMs instead of dumping them', () => {
    const late = harness({ maxLateMs: 3000 });
    late.engine.start();
    late.advance(45_000); // jump far past both cues
    expect(late.audio.played.map((cue) => cue.id)).toEqual([]);
    expect(late.engine.getSnapshot().skippedCount).toBe(3);
    expect(late.events.filter((event) => event.type === 'cue-skipped')).toHaveLength(3);
  });

  it('still plays a cue that is late but inside the tolerance', () => {
    const late = harness({ maxLateMs: 3000 });
    late.engine.start();
    late.advance(17_900); // timeline 2900, cue was due at -2000... within 3000 of due time
    expect(late.audio.played.map((cue) => cue.id)).toEqual([]);

    const soon = harness({ maxLateMs: 3000 });
    soon.engine.start();
    soon.advance(15_500); // timeline 500, countdown cue due at -2000 => 2500 late
    expect(soon.audio.played.map((cue) => cue.id)).toEqual(['c-countdown']);
  });

  describe('offsets', () => {
    it('delays the timeline by the effective offset', () => {
      h.engine.setSessionOffsetMs(700);
      h.engine.setPullOffsetMs(200);
      expect(h.engine.effectiveOffsetMs).toBe(900);

      h.engine.start();
      h.run(24_900); // raw 9900 -> timeline 9000
      expect(h.audio.played.map((cue) => cue.id)).not.toContain('c-first');
      h.run(1000); // raw 10900 -> timeline 10000
      expect(h.audio.played.map((cue) => cue.id)).toContain('c-first');
    });

    it('keeps the session offset but clears the pull offset on start', () => {
      h.engine.setSessionOffsetMs(700);
      h.engine.setPullOffsetMs(300);
      h.engine.start();
      expect(h.engine.getSnapshot().sessionOffsetMs).toBe(700);
      expect(h.engine.getSnapshot().pullOffsetMs).toBe(0);
    });

    it('never replays a cue after a negative nudge', () => {
      h.engine.start();
      h.run(25_000);
      expect(h.audio.played).toHaveLength(2);
      h.engine.adjustPullOffsetMs(1000); // rewinds the timeline by 1s
      h.run(500);
      expect(h.audio.played).toHaveLength(2);
    });
  });

  describe('wipe and restart', () => {
    it('resets runtime state, keeps the session offset, clears the pull offset', () => {
      h.engine.setSessionOffsetMs(700);
      h.engine.start();
      h.run(25_000);
      h.engine.setPullOffsetMs(500);

      h.engine.wipe();

      const snapshot = h.engine.getSnapshot();
      expect(snapshot.state).toBe('idle');
      expect(snapshot.sessionOffsetMs).toBe(700);
      expect(snapshot.pullOffsetMs).toBe(0);
      expect(snapshot.currentCue).toBeNull();
      expect(snapshot.firedCount).toBe(0);
      expect(snapshot.timelineElapsedMs).toBe(-15_000);
    });

    it('increments the pull id on every start', () => {
      h.engine.start();
      expect(h.engine.getSnapshot().pullId).toBe(1);
      h.engine.wipe();
      h.engine.start();
      expect(h.engine.getSnapshot().pullId).toBe(2);
    });

    it('replays cues from the beginning after a restart', () => {
      h.engine.start();
      h.run(25_000);
      h.engine.wipe();
      h.engine.start();
      h.run(25_000);
      expect(h.audio.played.map((cue) => cue.id)).toEqual([
        'c-countdown',
        'c-first',
        'c-countdown',
        'c-first',
      ]);
    });
  });

  describe('pause', () => {
    it('freezes the timeline while paused', () => {
      h.engine.start();
      h.run(20_000); // timeline 5000
      h.engine.pause();
      expect(h.engine.getSnapshot().state).toBe('paused');
      h.clock.advance(30_000);
      expect(h.engine.getSnapshot().timelineElapsedMs).toBe(5000);
      h.engine.resume();
      h.run(5000); // timeline 10_000
      expect(h.audio.played.map((cue) => cue.id)).toContain('c-first');
    });
  });

  it('completes after the last cue and the encounter duration', () => {
    h.engine.start();
    h.run(75_000); // timeline 60_000
    expect(h.engine.getSnapshot().state).toBe('completed');
    expect(h.events.some((event) => event.type === 'completed')).toBe(true);
  });

  it('honours a countdown override', () => {
    const short = harness({ countdownMs: 5000 });
    short.engine.start();
    expect(short.engine.getSnapshot().timelineElapsedMs).toBe(-5000);
    short.run(3000); // timeline -2000
    expect(short.audio.played.map((cue) => cue.id)).toEqual(['c-countdown']);
  });
});
