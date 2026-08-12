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
      message: 'Timeline has no tracks',
    });
  }

  for (const track of timeline.tracks) {
    if (trackIds.has(track.id)) {
      issues.push({
        level: 'error',
        code: 'track.duplicate-id',
        message: `Duplicate track id "${track.id}"`,
        trackId: track.id,
        field: 'id',
      });
    }
    trackIds.add(track.id);

    if (track.name.trim() === '') {
      issues.push({
        level: 'warning',
        code: 'track.empty-name',
        message: 'Track has no name',
        trackId: track.id,
        field: 'name',
      });
    }

    if (track.events.length === 0) {
      issues.push({
        level: 'warning',
        code: 'track.no-events',
        message: `Track "${track.name}" has no events`,
        trackId: track.id,
      });
    }

    if (isEmptyTarget(track.target)) {
      issues.push({
        level: 'warning',
        code: 'track.empty-target',
        message: `Track "${track.name}" targets nobody`,
        trackId: track.id,
        field: 'target',
      });
    }

    for (const event of track.events) {
      if (eventIds.has(event.id)) {
        issues.push({
          level: 'error',
          code: 'event.duplicate-id',
          message: `Duplicate event id "${event.id}"`,
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
          message: 'Event has no name',
          trackId: track.id,
          eventId: event.id,
          field: 'name',
        });
      }

      if (event.atMs > durationMs) {
        issues.push({
          level: 'error',
          code: 'event.after-duration',
          message: `Event "${event.name}" is after the encounter duration (${durationMs}ms)`,
          trackId: track.id,
          eventId: event.id,
          field: 'atMs',
        });
      }

      if (event.atMs < minTimeMs) {
        issues.push({
          level: 'warning',
          code: 'event.before-countdown',
          message: `Event "${event.name}" starts before the countdown (${minTimeMs}ms)`,
          trackId: track.id,
          eventId: event.id,
          field: 'atMs',
        });
      }

      if (event.cues.length === 0) {
        issues.push({
          level: 'warning',
          code: 'event.no-cues',
          message: `Event "${event.name}" has no cues`,
          trackId: track.id,
          eventId: event.id,
        });
      }

      for (const cue of event.cues) {
        if (cueIds.has(cue.id)) {
          issues.push({
            level: 'error',
            code: 'cue.duplicate-id',
            message: `Duplicate cue id "${cue.id}"`,
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
            message: `Cue in "${event.name}" has no text`,
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
            message: `Cue triggers at ${triggerMs}ms, before the countdown starts (${minTimeMs}ms)`,
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
            message: `Cue triggers at ${triggerMs}ms, after the encounter duration (${durationMs}ms)`,
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
                ? `Cue text is very long (~${measureCueText(cue.text)} units); it may not finish before the next cue`
                : `Cue text is long (~${measureCueText(cue.text)} units)`,
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
            message: 'Cue target does not overlap its track target — it can never play',
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
