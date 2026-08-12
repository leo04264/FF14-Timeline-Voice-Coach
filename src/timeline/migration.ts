import { CURRENT_SCHEMA_VERSION } from './types';

/**
 * Schema migration hook (spec §80).
 *
 * V0.1 only knows schemaVersion 1. The function exists so future versions can
 * be upgraded instead of rejected; it must stay side-effect free.
 */

export type MigrationResult =
  | { ok: true; value: unknown; migratedFrom?: number }
  | { ok: false; error: string };

export function readSchemaVersion(input: unknown): number | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const version = (input as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === 'number' ? version : undefined;
}

export function migrateTimeline(input: unknown): MigrationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'Timeline must be a JSON object' };
  }

  const version = readSchemaVersion(input);

  if (version === undefined) {
    return { ok: false, error: 'Missing schemaVersion' };
  }

  if (version === CURRENT_SCHEMA_VERSION) {
    return { ok: true, value: input };
  }

  if (version > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Timeline schemaVersion ${version} is newer than this app supports (${CURRENT_SCHEMA_VERSION})`,
    };
  }

  // No older versions exist yet; future migrations chain from here.
  return { ok: false, error: `Unsupported schemaVersion ${version}` };
}
