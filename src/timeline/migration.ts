import { parseTimelinePackageV1, type SchemaIssue } from './schema';
import {
  CURRENT_SCHEMA_VERSION,
  LEGACY_SCHEMA_VERSION_V1,
  absoluteTiming,
  type TimelineEvent,
  type TimelinePackage,
  type TimelinePackageV1,
  type TimelineTrack,
} from './types';

/**
 * Schema migration (spec §80, §3.3).
 *
 * V1 -> V2 turns every `atMs` into `{ kind: 'absolute', atMs }` and changes
 * nothing else:
 *   - `cue.offsetMs` is copied verbatim, so every trigger time is bit-identical
 *   - no rounding, no clamping, no "looks close enough" linking
 *   - old standalone events stay `absolute`; they are never guessed into
 *     mechanic references just because they share a time or a similar name
 *
 * The function is pure and never mutates its input.
 */

export type MigrationResult =
  | { ok: true; value: unknown; migratedFrom?: number }
  | { ok: false; error: string; issues?: SchemaIssue[] };

export function readSchemaVersion(input: unknown): number | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const version = (input as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === 'number' ? version : undefined;
}

/** Pure V1 -> V2 conversion. Input must already be a validated V1 document. */
export function migrateV1ToV2(v1: TimelinePackageV1): TimelinePackage {
  const tracks: TimelineTrack[] = v1.tracks.map((track) => {
    const events: TimelineEvent[] = track.events.map((event) => {
      const migrated: TimelineEvent = {
        id: event.id,
        timing: absoluteTiming(event.atMs),
        name: event.name,
        category: event.category,
        cues: event.cues.map((cue) => ({ ...cue })),
      };
      // Only carry `phase` when it existed, so exports stay byte-clean.
      if (event.phase !== undefined) migrated.phase = event.phase;
      return migrated;
    });

    const migratedTrack: TimelineTrack = {
      id: track.id,
      type: track.type,
      name: track.name,
      enabledByDefault: track.enabledByDefault,
      events,
    };
    if (track.target !== undefined) migratedTrack.target = { ...track.target };
    // V1 had no selection groups and no system purposes: nothing is invented
    // here (spec §3.2 — never guess exclusivity).
    return migratedTrack;
  });

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: v1.id,
    meta: { ...v1.meta },
    encounter: { ...v1.encounter },
    tracks,
  };
}

/**
 * Normalise any accepted document version to V2.
 *
 * V1 is structurally validated *before* conversion so a malformed old file
 * reports a schema problem instead of producing a half-migrated V2.
 */
export function migrateTimeline(input: unknown): MigrationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: '時間軸必須是 JSON 物件' };
  }

  const version = readSchemaVersion(input);

  if (version === undefined) {
    return { ok: false, error: '缺少 schemaVersion 欄位' };
  }

  if (version === CURRENT_SCHEMA_VERSION) {
    // Already current: pass through untouched, never re-migrated.
    return { ok: true, value: input };
  }

  if (version === LEGACY_SCHEMA_VERSION_V1) {
    const parsed = parseTimelinePackageV1(input);
    if (!parsed.ok) {
      return {
        ok: false,
        error: `舊版（schemaVersion 1）時間軸的結構不合法：${
          parsed.issues[0]
            ? `${parsed.issues[0].path ? `${parsed.issues[0].path}: ` : ''}${parsed.issues[0].message}`
            : '未知原因'
        }`,
        issues: parsed.issues,
      };
    }
    return { ok: true, value: migrateV1ToV2(parsed.timeline), migratedFrom: 1 };
  }

  if (version > CURRENT_SCHEMA_VERSION) {
    // Unknown future version: refuse outright rather than dropping fields we
    // do not understand (spec §3.3.2). The caller keeps the raw payload.
    return {
      ok: false,
      error: `時間軸的 schemaVersion 是 ${version}，比這個版本支援的 ${CURRENT_SCHEMA_VERSION} 還新`,
    };
  }

  return { ok: false, error: `不支援的 schemaVersion：${version}` };
}
