import type { ValidationReport } from '../timeline/validator';
import type { TimelinePackage } from '../timeline/types';

/**
 * Storage abstraction (spec §71). UI code must go through a repository instead
 * of touching localStorage directly (spec §97).
 */

export type TimelineSource = 'local' | 'builtin';

export interface ValidTimelineEntry {
  status: 'valid';
  source: TimelineSource;
  id: string;
  timeline: TimelinePackage;
  updatedAtMs?: number;
  /** Domain warnings/errors; a valid entry may still carry warnings. */
  report: ValidationReport;
}

/**
 * A stored record that failed schema/domain validation. It is kept and shown as
 * "Invalid" so one broken row cannot crash the library (spec §81).
 */
export interface InvalidTimelineEntry {
  status: 'invalid';
  source: TimelineSource;
  id: string;
  name?: string;
  raw: string;
  error: string;
  report?: ValidationReport;
}

export type TimelineEntry = ValidTimelineEntry | InvalidTimelineEntry;

export interface TimelineRepository {
  getAll(): Promise<TimelineEntry[]>;
  get(id: string): Promise<TimelineEntry | null>;
  save(timeline: TimelinePackage): Promise<void>;
  delete(id: string): Promise<void>;
  /** Raw stored JSON, used by "Export Raw Data" for invalid entries (spec §81). */
  getRaw(id: string): Promise<string | null>;
  /** Store an unparsed payload (raw draft import/backup). */
  saveRaw(id: string, raw: string): Promise<void>;
}

export function entryName(entry: TimelineEntry): string {
  return entry.status === 'valid' ? entry.timeline.meta.name : (entry.name ?? entry.id);
}
