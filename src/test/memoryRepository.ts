import { parseAndValidateTimeline } from '../timeline/validator';
import type { TimelineEntry, TimelineRepository } from '../storage/TimelineRepository';
import type { TimelinePackage } from '../timeline/types';

/** In-memory repository for tests — same contract as the LocalStorage one. */
export class MemoryTimelineRepository implements TimelineRepository {
  private readonly records = new Map<string, string>();

  constructor(seed: TimelinePackage[] = []) {
    for (const timeline of seed) this.records.set(timeline.id, JSON.stringify(timeline));
  }

  async getAll(): Promise<TimelineEntry[]> {
    return [...this.records.keys()]
      .map((id) => this.read(id))
      .filter((entry): entry is TimelineEntry => entry !== null);
  }

  async get(id: string): Promise<TimelineEntry | null> {
    return this.read(id);
  }

  async save(timeline: TimelinePackage): Promise<void> {
    this.records.set(timeline.id, JSON.stringify(timeline));
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async getRaw(id: string): Promise<string | null> {
    return this.records.get(id) ?? null;
  }

  async saveRaw(id: string, raw: string): Promise<void> {
    this.records.set(id, raw);
  }

  private read(id: string): TimelineEntry | null {
    const raw = this.records.get(id);
    if (raw === undefined) return null;
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      return { status: 'invalid', source: 'local', id, raw, error: 'Invalid JSON' };
    }
    const result = parseAndValidateTimeline(payload);
    if (!result.ok) {
      return {
        status: 'invalid',
        source: 'local',
        id,
        raw,
        error: result.report.errors[0]?.message ?? 'Invalid timeline',
        report: result.report,
      };
    }
    return { status: 'valid', source: 'local', id, timeline: result.timeline, report: result.report };
  }
}
