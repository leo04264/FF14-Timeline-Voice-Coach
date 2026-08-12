import { parseTimelinePackage } from './schema';
import { isEmptyTarget, combineTargets } from './target';
import type { TimelinePackage } from './types';

export type ValidationLevel = 'error' | 'warning';

export interface ValidationIssue {
  level: ValidationLevel;
  code: string;
  message: string;
  /** Location, used by the editor to jump to the offending row (spec §78). */
  trackId?: string;
  eventId?: string;
  cueId?: string;
  field?: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** Blocking errors forbid Live Player and formal export (spec §79). */
  hasBlockingError: boolean;
}

export const LONG_TEXT_WARN_UNITS = 15;
export const LONG_TEXT_SEVERE_UNITS = 25;

const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/**
 * Approximate spoken length in "CJK character units" (spec §29).
 * A CJK glyph counts as 1, other characters as 0.5. When the audio layer can
 * estimate a real TTS duration this should be replaced by that estimate.
 */
export function measureCueText(text: string): number {
  let units = 0;
  for (const char of text.trim()) {
    if (char === ' ') continue;
    units += CJK.test(char) ? 1 : 0.5;
  }
  return units;
}

export type TextLengthLevel = 'ok' | 'warning' | 'severe';

export function cueTextLengthLevel(text: string): TextLengthLevel {
  const units = measureCueText(text);
  if (units > LONG_TEXT_SEVERE_UNITS) return 'severe';
  if (units > LONG_TEXT_WARN_UNITS) return 'warning';
  return 'ok';
}

function buildReport(issues: ValidationIssue[]): ValidationReport {
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  return { issues, errors, warnings, hasBlockingError: errors.length > 0 };
}

/**
 * Domain validation — runs *after* Zod structural parsing (spec §73).
 * Never mutates or auto-fixes the timeline (spec §75).
 */
export function validateTimeline(timeline: TimelinePackage): ValidationReport {
  const issues: ValidationIssue[] = [];
  const { durationMs, countdownMs } = timeline.encounter;
  const minTimeMs = -countdownMs;

  const trackIds = new Set<string>();
  const eventIds = new Set<string>();
  const cueIds = new Set<string>();

  if (timeline.tracks.length === 0) {
    issues.push({
      level: 'warning',
      code: 'timeline.no-tracks',
      message: '這份時間軸沒有任何軌道',
    });
  }

  for (const track of timeline.tracks) {
    if (trackIds.has(track.id)) {
      issues.push({
        level: 'error',
        code: 'track.duplicate-id',
        message: `軌道 ID 重複：「${track.id}」`,
        trackId: track.id,
        field: 'id',
      });
    }
    trackIds.add(track.id);

    if (track.name.trim() === '') {
      issues.push({
        level: 'warning',
        code: 'track.empty-name',
        message: '軌道沒有名稱',
        trackId: track.id,
        field: 'name',
      });
    }

    if (track.events.length === 0) {
      issues.push({
        level: 'warning',
        code: 'track.no-events',
        message: `軌道「${track.name}」沒有任何事件`,
        trackId: track.id,
      });
    }

    if (isEmptyTarget(track.target)) {
      issues.push({
        level: 'warning',
        code: 'track.empty-target',
        message: `軌道「${track.name}」的對象是空的，沒有人會聽到`,
        trackId: track.id,
        field: 'target',
      });
    }

    for (const event of track.events) {
      if (eventIds.has(event.id)) {
        issues.push({
          level: 'error',
          code: 'event.duplicate-id',
          message: `事件 ID 重複：「${event.id}」`,
          trackId: track.id,
          eventId: event.id,
          field: 'id',
        });
      }
      eventIds.add(event.id);

      if (event.name.trim() === '') {
        issues.push({
          level: 'warning',
          code: 'event.empty-name',
          message: '事件沒有名稱',
          trackId: track.id,
          eventId: event.id,
          field: 'name',
        });
      }

      if (event.atMs > durationMs) {
        issues.push({
          level: 'error',
          code: 'event.after-duration',
          message: `事件「${event.name}」超過戰鬥全長（${durationMs} 毫秒）`,
          trackId: track.id,
          eventId: event.id,
          field: 'atMs',
        });
      }

      if (event.atMs < minTimeMs) {
        issues.push({
          level: 'warning',
          code: 'event.before-countdown',
          message: `事件「${event.name}」早於倒數開始（${minTimeMs} 毫秒）`,
          trackId: track.id,
          eventId: event.id,
          field: 'atMs',
        });
      }

      if (event.cues.length === 0) {
        issues.push({
          level: 'warning',
          code: 'event.no-cues',
          message: `事件「${event.name}」沒有任何語音提示`,
          trackId: track.id,
          eventId: event.id,
        });
      }

      for (const cue of event.cues) {
        if (cueIds.has(cue.id)) {
          issues.push({
            level: 'error',
            code: 'cue.duplicate-id',
            message: `語音提示 ID 重複：「${cue.id}」`,
            trackId: track.id,
            eventId: event.id,
            cueId: cue.id,
            field: 'id',
          });
        }
        cueIds.add(cue.id);

        if (cue.text.trim() === '') {
          issues.push({
            level: 'error',
            code: 'cue.empty-text',
            message: `事件「${event.name}」底下有空白的語音提示`,
            trackId: track.id,
            eventId: event.id,
            cueId: cue.id,
            field: 'text',
          });
        }

        const triggerMs = event.atMs + cue.offsetMs;
        if (triggerMs < minTimeMs) {
          issues.push({
            level: 'error',
            code: 'cue.before-countdown',
            message: `提示在 ${triggerMs} 毫秒觸發，早於倒數開始（${minTimeMs} 毫秒）`,
            trackId: track.id,
            eventId: event.id,
            cueId: cue.id,
            field: 'offsetMs',
          });
        }

        if (triggerMs > durationMs) {
          issues.push({
            level: 'warning',
            code: 'cue.after-duration',
            message: `提示在 ${triggerMs} 毫秒觸發，超過戰鬥全長（${durationMs} 毫秒）`,
            trackId: track.id,
            eventId: event.id,
            cueId: cue.id,
            field: 'offsetMs',
          });
        }

        const level = cueTextLengthLevel(cue.text);
        if (level !== 'ok') {
          issues.push({
            level: 'warning',
            code: level === 'severe' ? 'cue.text-very-long' : 'cue.text-long',
            message:
              level === 'severe'
                ? `語音內容太長（約 ${measureCueText(cue.text)} 字），可能來不及在下一句之前念完`
                : `語音內容偏長（約 ${measureCueText(cue.text)} 字）`,
            trackId: track.id,
            eventId: event.id,
            cueId: cue.id,
            field: 'text',
          });
        }

        if (isEmptyTarget(combineTargets(track.target, cue.target))) {
          issues.push({
            level: 'warning',
            code: 'cue.unreachable-target',
            message: '提示對象和軌道對象沒有交集，這句永遠不會播放',
            trackId: track.id,
            eventId: event.id,
            cueId: cue.id,
            field: 'target',
          });
        }
      }
    }
  }

  return buildReport(issues);
}

export type TimelineValidationResult =
  | { ok: true; timeline: TimelinePackage; report: ValidationReport }
  | { ok: false; report: ValidationReport };

/**
 * Zod parse -> domain validation. The single entry point used by import,
 * repository reads and the compile path (spec §73).
 */
export function parseAndValidateTimeline(input: unknown): TimelineValidationResult {
  const parsed = parseTimelinePackage(input);
  if (!parsed.ok) {
    const issues: ValidationIssue[] = parsed.issues.map((issue) => ({
      level: 'error' as const,
      code: 'schema',
      message: issue.path ? `${issue.path}: ${issue.message}` : issue.message,
      field: issue.path,
    }));
    return { ok: false, report: buildReport(issues) };
  }

  const report = validateTimeline(parsed.timeline);
  return { ok: true, timeline: parsed.timeline, report };
}
