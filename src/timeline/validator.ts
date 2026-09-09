import { buildMechanicIndex, resolveEventTiming } from './resolveEventTiming';
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
  const index = buildMechanicIndex(timeline);

  // ---- selection groups (spec §3.2): ids must exist and be unique ---------
  const groupIds = new Set<string>();
  const optionKeys = new Set<string>();
  for (const group of timeline.selectionGroups ?? []) {
    if (groupIds.has(group.id)) {
      issues.push({
        level: 'error',
        code: 'selection-group.duplicate-id',
        message: `方案群組 ID 重複：「${group.id}」`,
        field: 'selectionGroups',
      });
    }
    groupIds.add(group.id);
    if (group.options.length === 0) {
      issues.push({
        level: 'warning',
        code: 'selection-group.no-options',
        message: `方案群組「${group.name || group.id}」沒有任何選項`,
        field: 'selectionGroups',
      });
    }
    const seen = new Set<string>();
    for (const option of group.options) {
      if (seen.has(option.id)) {
        issues.push({
          level: 'error',
          code: 'selection-option.duplicate-id',
          message: `方案群組「${group.name || group.id}」裡的選項 ID 重複：「${option.id}」`,
          field: 'selectionGroups',
        });
      }
      seen.add(option.id);
      optionKeys.add(`${group.id}\u0000${option.id}`);
    }
  }

  // ---- at most one system personal-reminders track per exact profile -------
  const personalTargetKeys = new Set<string>();

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

    if (track.selection) {
      if (!optionKeys.has(`${track.selection.groupId}\u0000${track.selection.optionId}`)) {
        issues.push({
          level: 'error',
          code: 'track.unknown-selection',
          message: `軌道「${track.name}」指向不存在的方案（${track.selection.groupId} / ${track.selection.optionId}）`,
          trackId: track.id,
          field: 'selection',
        });
      }
    }

    if (track.purpose === 'personal-reminders') {
      const positions = track.target?.positions ?? [];
      const jobs = track.target?.jobs ?? [];
      if (positions.length !== 1 || jobs.length !== 1) {
        issues.push({
          level: 'error',
          code: 'track.personal-target-not-exact',
          message: `我的自訂提醒軌道「${track.name}」必須剛好對應一個站位與一個職業`,
          trackId: track.id,
          field: 'target',
        });
      } else {
        const key = `${positions[0]}\u0000${jobs[0]}`;
        if (personalTargetKeys.has(key)) {
          issues.push({
            level: 'error',
            code: 'track.duplicate-personal-track',
            message: `同一個身分（${positions[0]} / ${jobs[0]}）出現了兩條我的自訂提醒軌道`,
            trackId: track.id,
            field: 'purpose',
          });
        }
        personalTargetKeys.add(key);
      }
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

      const resolved = resolveEventTiming(event, track.id, index);
      if (resolved.issue) {
        // Structurally readable but referentially broken: a blocking error, so
        // the player and formal export stop, while the editor can still fix it.
        issues.push({ level: 'error', ...resolved.issue });
      }
      const eventAtMs = resolved.atMs;

      if (eventAtMs !== undefined && eventAtMs > durationMs) {
        issues.push({
          level: 'error',
          code: 'event.after-duration',
          message: `事件「${event.name}」超過戰鬥全長（${durationMs} 毫秒）`,
          trackId: track.id,
          eventId: event.id,
          field: 'timing',
        });
      }

      if (eventAtMs !== undefined && eventAtMs < minTimeMs) {
        issues.push({
          level: 'warning',
          code: 'event.before-countdown',
          message: `事件「${event.name}」早於倒數開始（${minTimeMs} 毫秒）`,
          trackId: track.id,
          eventId: event.id,
          field: 'timing',
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

        const triggerMs = eventAtMs === undefined ? undefined : eventAtMs + cue.offsetMs;
        if (triggerMs !== undefined && triggerMs < minTimeMs) {
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

        if (triggerMs !== undefined && triggerMs > durationMs) {
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
