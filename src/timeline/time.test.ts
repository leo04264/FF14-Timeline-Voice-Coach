import { describe, expect, it } from 'vitest';
import { formatMs, formatSecondsSigned, formatTimer, parseTimeInput } from './time';

describe('formatMs', () => {
  it('formats milliseconds as MM:SS.mmm', () => {
    expect(formatMs(48_000)).toBe('00:48.000');
    expect(formatMs(65_432)).toBe('01:05.432');
    expect(formatMs(-2000)).toBe('-00:02.000');
  });

  it('can drop the fraction', () => {
    expect(formatMs(48_500, { millis: false })).toBe('00:48');
  });
});

describe('formatTimer', () => {
  it('renders 0.1s precision', () => {
    expect(formatTimer(0)).toBe('00:00.0');
    expect(formatTimer(1234)).toBe('00:01.2');
    expect(formatTimer(-4900)).toBe('-00:04.9');
  });
});

describe('formatSecondsSigned', () => {
  it('always shows a sign', () => {
    expect(formatSecondsSigned(700)).toBe('+0.7s');
    expect(formatSecondsSigned(-500)).toBe('-0.5s');
    expect(formatSecondsSigned(0)).toBe('+0.0s');
  });
});

describe('parseTimeInput', () => {
  it('parses MM:SS.mmm', () => {
    expect(parseTimeInput('00:48.000')).toEqual({ ok: true, ms: 48_000 });
    expect(parseTimeInput('01:05.432')).toEqual({ ok: true, ms: 65_432 });
    expect(parseTimeInput('00:48')).toEqual({ ok: true, ms: 48_000 });
    expect(parseTimeInput('48')).toEqual({ ok: true, ms: 48_000 });
    expect(parseTimeInput('48.5')).toEqual({ ok: true, ms: 48_500 });
  });

  it('parses negative times', () => {
    expect(parseTimeInput('-00:02.000')).toEqual({ ok: true, ms: -2000 });
  });

  it('rejects malformed input instead of guessing', () => {
    expect(parseTimeInput('').ok).toBe(false);
    expect(parseTimeInput('abc').ok).toBe(false);
    expect(parseTimeInput('00:99').ok).toBe(false);
    expect(parseTimeInput('1:2:3').ok).toBe(false);
  });

  it('round-trips with formatMs', () => {
    for (const ms of [0, 1, 999, 48_000, 123_456, -15_000]) {
      const parsed = parseTimeInput(formatMs(ms));
      expect(parsed.ok).toBe(true);
      expect(parsed.ms).toBe(ms);
    }
  });
});
