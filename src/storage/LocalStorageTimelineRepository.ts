import { migrateTimeline } from '../timeline/migration';
import { parseAndValidateTimeline } from '../timeline/validator';
import type { TimelinePackage } from '../timeline/types';
import type { TimelineEntry, TimelineRepository } from './TimelineRepository';

/**
 * V0.1 persistence: LocalStorage, JSON/text only — no audio blobs (spec §70).
 * Each timeline is stored under its own key so one corrupt record cannot break
 * the whole library (spec §81).
 */

export const STORAGE_PREFIX = 'ff14tc:v1';
export const INDEX_KEY = `${STORAGE_PREFIX}:timeline-index`;
export const timelineKey = (id: string) => `${STORAGE_PREFIX}:timeline:${id}`;

interface StoredRecord {
  id: string;
  updatedAtMs: number;
  timeline: unknown;
}

export class StorageWriteError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'StorageWriteError';
  }
}

function readIndex(storage: Storage): string[] {
  const raw = storage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(storage: Storage, ids: string[]): void {
  storage.setItem(INDEX_KEY, JSON.stringify(ids));
}

function guessName(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as { timeline?: { meta?: { name?: unknown } } };
    const name = parsed?.timeline?.meta?.name;
    return typeof name === 'string' ? name : undefined;
  } catch {
    return undefined;
  }
}

export class LocalStorageTimelineRepository implements TimelineRepository {
  constructor(private readonly storage: Storage = globalThis.localStorage) {}

  async getAll(): Promise<TimelineEntry[]> {
    return readIndex(this.storage)
      .map((id) => this.readEntry(id))
      .filter((entry): entry is TimelineEntry => entry !== null);
  }

  async get(id: string): Promise<TimelineEntry | null> {
    return this.readEntry(id);
  }

  async save(timeline: TimelinePackage): Promise<void> {
    const record: StoredRecord = {
      id: timeline.id,
      updatedAtMs: Date.now(),
      timeline,
    };
    try {
      this.storage.setItem(timelineKey(timeline.id), JSON.stringify(record));
    } catch (error) {
      throw new StorageWriteError('Failed to write timeline to LocalStorage', error);
    }
    const ids = readIndex(this.storage);
    if (!ids.includes(timeline.id)) writeIndex(this.storage, [...ids, timeline.id]);
  }

  async delete(id: string): Promise<void> {
    this.storage.removeItem(timelineKey(id));
    writeIndex(
      this.storage,
      readIndex(this.storage).filter((candidate) => candidate !== id),
    );
  }

  async getRaw(id: string): Promise<string | null> {
    return this.storage.getItem(timelineKey(id));
  }

  async saveRaw(id: string, raw: string): Promise<void> {
    try {
      this.storage.setItem(timelineKey(id), raw);
    } catch (error) {
      throw new StorageWriteError('Failed to write raw timeline to LocalStorage', error);
    }
    const ids = readIndex(this.storage);
    if (!ids.includes(id)) writeIndex(this.storage, [...ids, id]);
  }

  async has(id: string): Promise<boolean> {
    return this.storage.getItem(timelineKey(id)) !== null;
  }

  private readEntry(id: string): TimelineEntry | null {
    const raw = this.storage.getItem(timelineKey(id));
    if (raw === null) return null;

    const invalid = (error: string): TimelineEntry => ({
      status: 'invalid',
      source: 'local',
      id,
      name: guessName(raw),
      raw,
      error,
    });

    let record: StoredRecord;
    try {
      record = JSON.parse(raw) as StoredRecord;
    } catch {
      return invalid('Stored value is not valid JSON');
    }

    // `saveRaw` may have stored a bare TimelinePackage instead of a wrapper.
    const payload = record?.timeline ?? record;

    const migrated = migrateTimeline(payload);
    if (!migrated.ok) return invalid(migrated.error);

    const result = parseAndValidateTimeline(migrated.value);
    if (!result.ok) {
      // Structurally broken: cannot be edited, only exported raw or deleted.
      return {
        status: 'invalid',
        source: 'local',
        id,
        name: guessName(raw),
        raw,
        error: result.report.errors[0]?.message ?? 'Timeline failed validation',
        report: result.report,
      };
    }

    // Domain errors (duplicate ids, bad times) keep the entry editable; the
    // player is blocked elsewhere by the same report (spec §79).
    return {
      status: 'valid',
      source: 'local',
      id,
      timeline: result.timeline,
      updatedAtMs: typeof record.updatedAtMs === 'number' ? record.updatedAtMs : undefined,
      report: result.report,
    };
  }
}
