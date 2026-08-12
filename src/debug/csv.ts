import type { DebugCueRecord } from './types';

/** Spec §54 — Excel-friendly UTF-8 with BOM. */
export const UTF8_BOM = '\uFEFF';

const COLUMNS = [
  'pull',
  'cue',
  'text',
  'triggerMs',
  'engineLateMs',
  'ttsQueueDelayMs',
  'approxAudibleLateMs',
  'visibilityTrigger',
  'visibilityAudioStart',
  'status',
] as const;

function escapeCell(value: string | number | undefined): string {
  if (value === undefined) return '';
  const text = typeof value === 'number' ? formatNumber(value) : value;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function recordsToCsv(records: DebugCueRecord[]): string {
  const lines = [COLUMNS.join(',')];
  for (const record of records) {
    lines.push(
      [
        escapeCell(record.pullId),
        escapeCell(record.eventName),
        escapeCell(record.text),
        escapeCell(record.triggerMs),
        escapeCell(record.engineLateMs),
        escapeCell(record.ttsQueueDelayMs),
        escapeCell(record.approxAudibleLateMs),
        escapeCell(record.visibilityTrigger),
        escapeCell(record.visibilityAudioStart),
        escapeCell(record.status),
      ].join(','),
    );
  }
  return UTF8_BOM + lines.join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  downloadText(filename, csv, 'text/csv;charset=utf-8');
}

export function downloadText(filename: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
