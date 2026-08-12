import { migrateTimeline } from '../timeline/migration';
import { parseAndValidateTimeline } from '../timeline/validator';
import type { TimelineEntry } from './TimelineRepository';

/**
 * Read-only templates shipped in `/public/timelines/` (spec §64). A manifest is
 * required because static hosting cannot list a directory.
 */

const MANIFEST_PATH = 'timelines/index.json';

function baseUrl(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return base.endsWith('/') ? base : `${base}/`;
}

interface ManifestEntry {
  file: string;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as unknown;
}

export async function loadBuiltinTimelines(): Promise<TimelineEntry[]> {
  let manifest: unknown;
  try {
    manifest = await fetchJson(`${baseUrl()}${MANIFEST_PATH}`);
  } catch {
    return []; // No manifest deployed — built-ins are optional.
  }

  const files = Array.isArray(manifest)
    ? manifest
        .map((item) =>
          typeof item === 'string' ? item : (item as ManifestEntry | null)?.file ?? null,
        )
        .filter((file): file is string => typeof file === 'string')
    : [];

  const entries: TimelineEntry[] = [];

  for (const file of files) {
    const url = `${baseUrl()}timelines/${file}`;
    try {
      const payload = await fetchJson(url);
      const migrated = migrateTimeline(payload);
      if (!migrated.ok) {
        entries.push({
          status: 'invalid',
          source: 'builtin',
          id: `builtin:${file}`,
          name: file,
          raw: JSON.stringify(payload, null, 2),
          error: migrated.error,
        });
        continue;
      }

      const result = parseAndValidateTimeline(migrated.value);
      if (!result.ok) {
        entries.push({
          status: 'invalid',
          source: 'builtin',
          id: `builtin:${file}`,
          name: file,
          raw: JSON.stringify(payload, null, 2),
          error: result.report.errors[0]?.message ?? '內建時間軸格式錯誤',
          report: result.report,
        });
        continue;
      }

      entries.push({
        status: 'valid',
        source: 'builtin',
        id: result.timeline.id,
        timeline: result.timeline,
        report: result.report,
      });
    } catch (error) {
      entries.push({
        status: 'invalid',
        source: 'builtin',
        id: `builtin:${file}`,
        name: file,
        raw: '',
        error: error instanceof Error ? error.message : '內建時間軸載入失敗',
      });
    }
  }

  return entries;
}
