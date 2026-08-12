/**
 * UI <-> domain time conversion (spec §6, §59).
 *
 * The domain model only ever holds milliseconds; these helpers exist so the UI
 * can show / accept `MM:SS.mmm`.
 */

export interface FormatTimeOptions {
  /** Include the `.mmm` fraction. Default true. */
  millis?: boolean;
  /** Always render a leading `+` for non-negative values. Default false. */
  signed?: boolean;
}

export function formatMs(ms: number, options: FormatTimeOptions = {}): string {
  const { millis = true, signed = false } = options;
  if (!Number.isFinite(ms)) return '--:--';

  const negative = ms < 0;
  const abs = Math.abs(Math.trunc(ms));
  const minutes = Math.floor(abs / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1000);
  const rest = abs % 1000;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const body = millis ? `${mm}:${ss}.${String(rest).padStart(3, '0')}` : `${mm}:${ss}`;

  if (negative) return `-${body}`;
  return signed ? `+${body}` : body;
}

/** `12345` -> `+12.3s`, used for offsets. */
export function formatSecondsSigned(ms: number, decimals = 1): string {
  if (!Number.isFinite(ms)) return '--';
  const sign = ms < 0 ? '-' : '+';
  return `${sign}${(Math.abs(ms) / 1000).toFixed(decimals)}s`;
}

/** Timer readout with 0.1s precision (spec §94). */
export function formatTimer(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--.-';
  const negative = ms < 0;
  // Truncate towards zero so a countdown reads -00:05.0 ... -00:00.1 -> 00:00.0
  const abs = Math.abs(ms);
  const tenths = Math.floor(abs / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  const tenth = tenths % 10;
  const body = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenth}`;
  return negative ? `-${body}` : body;
}

export interface ParseTimeResult {
  ok: boolean;
  ms?: number;
  error?: string;
}

const TIME_PATTERN = /^([+-])?(?:(\d+):)?(\d{1,2})(?:[.,](\d{1,3}))?$/;

/**
 * Accepts `MM:SS.mmm`, `MM:SS`, `SS.mmm`, `SS`, each optionally signed.
 * Never silently clamps or auto-fixes (spec §75).
 */
export function parseTimeInput(raw: string): ParseTimeResult {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'Time is required' };

  const match = TIME_PATTERN.exec(text);
  if (!match) return { ok: false, error: 'Expected MM:SS.mmm' };

  const [, sign, minutesRaw, secondsRaw, fractionRaw] = match;
  const minutes = minutesRaw ? Number(minutesRaw) : 0;
  const seconds = Number(secondsRaw);
  if (minutesRaw !== undefined && seconds > 59) {
    return { ok: false, error: 'Seconds must be < 60 when minutes are given' };
  }
  const fraction = fractionRaw ? Number(fractionRaw.padEnd(3, '0')) : 0;

  const ms = minutes * 60_000 + seconds * 1000 + fraction;
  if (!Number.isFinite(ms)) return { ok: false, error: 'Time must be finite' };

  return { ok: true, ms: sign === '-' ? -ms : ms };
}

export const NUDGE_STEPS_MS = [-1000, -500, -100, 100, 500, 1000] as const;

export function formatNudge(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  const abs = Math.abs(ms);
  return abs >= 1000 ? `${sign}${abs / 1000}s` : `${sign}${abs}ms`;
}
