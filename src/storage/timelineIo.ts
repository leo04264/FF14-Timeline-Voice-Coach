import { downloadText } from '../debug/csv';
import { migrateTimeline } from '../timeline/migration';
import { parseAndValidateTimeline, type ValidationReport } from '../timeline/validator';
import type { TimelinePackage } from '../timeline/types';

/** JSON import/export rules (spec §67–§69). */

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `encounter-strategy-version.json` (spec §68). */
export function exportFileName(timeline: TimelinePackage): string {
  const parts = [slug(timeline.meta.encounterId)];
  if (timeline.meta.strategy) parts.push(slug(timeline.meta.strategy));
  if (timeline.meta.version) parts.push(`v${slug(timeline.meta.version)}`);
  return `${parts.filter(Boolean).join('-') || 'timeline'}.json`;
}

export function draftFileName(timeline: TimelinePackage): string {
  const parts = [slug(timeline.meta.encounterId) || 'timeline'];
  if (timeline.meta.strategy) parts.push(slug(timeline.meta.strategy));
  parts.push('draft');
  return `${parts.filter(Boolean).join('-')}.json`;
}

export function serializeTimeline(timeline: TimelinePackage): string {
  return `${JSON.stringify(timeline, null, 2)}\n`;
}

export class ExportBlockedError extends Error {
  constructor(readonly report: ValidationReport) {
    super('這份時間軸還有必須修正的錯誤，請改用「匯出草稿」');
    this.name = 'ExportBlockedError';
  }
}

/** Formal export — refused while blocking errors exist (spec §69). */
export function exportTimeline(timeline: TimelinePackage, report: ValidationReport): void {
  if (report.hasBlockingError) throw new ExportBlockedError(report);
  downloadText(exportFileName(timeline), serializeTimeline(timeline));
}

/** Backup export, always allowed (spec §69). */
export function exportRawDraft(timeline: TimelinePackage): void {
  downloadText(draftFileName(timeline), serializeTimeline(timeline));
}

export type ImportParseResult =
  | { ok: true; timeline: TimelinePackage; report: ValidationReport }
  | { ok: false; error: string; report?: ValidationReport };

export function parseImportPayload(rawText: string): ImportParseResult {
  let payload: unknown;
  try {
    payload = JSON.parse(rawText) as unknown;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'JSON 格式錯誤' };
  }

  const migrated = migrateTimeline(payload);
  if (!migrated.ok) return { ok: false, error: migrated.error };

  const result = parseAndValidateTimeline(migrated.value);
  if (!result.ok) {
    return {
      ok: false,
      error: result.report.errors[0]?.message ?? '時間軸沒有通過驗證',
      report: result.report,
    };
  }

  return { ok: true, timeline: result.timeline, report: result.report };
}

export function readFileAsText(file: File): Promise<string> {
  return file.text();
}
