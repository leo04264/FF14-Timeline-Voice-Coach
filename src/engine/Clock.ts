/**
 * Injectable clock (spec §32). `performance.now()` is the runtime source;
 * `Date.now()` must never drive the timeline because it is wall-clock and can
 * jump. Unit tests inject FakeClock instead of sleeping.
 */
export interface Clock {
  nowMs(): number;
}

export class PerformanceClock implements Clock {
  nowMs(): number {
    return performance.now();
  }
}

export class FakeClock implements Clock {
  private current: number;

  constructor(startMs = 0) {
    this.current = startMs;
  }

  nowMs(): number {
    return this.current;
  }

  set(ms: number): void {
    this.current = ms;
  }

  advance(deltaMs: number): void {
    this.current += deltaMs;
  }
}

/** Periodic driver for the engine loop; injectable so tests stay synchronous. */
export interface Ticker {
  start(callback: () => void, intervalMs: number): void;
  stop(): void;
}

export class IntervalTicker implements Ticker {
  private handle: ReturnType<typeof setInterval> | null = null;

  start(callback: () => void, intervalMs: number): void {
    this.stop();
    this.handle = setInterval(callback, intervalMs);
  }

  stop(): void {
    if (this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }
}

/** Ticker that never fires on its own — tests call `engine.tick()` directly. */
export class ManualTicker implements Ticker {
  callback: (() => void) | null = null;

  start(callback: () => void): void {
    this.callback = callback;
  }

  stop(): void {
    this.callback = null;
  }

  fire(): void {
    this.callback?.();
  }
}
