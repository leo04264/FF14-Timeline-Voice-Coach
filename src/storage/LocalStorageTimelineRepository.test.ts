import { beforeEach, describe, expect, it } from 'vitest';
import { EXAMPLE_TIMELINE } from '../timeline/exampleTimeline';
import { LocalStorageTimelineRepository, timelineKey } from './LocalStorageTimelineRepository';
import { exportFileName, parseImportPayload } from './timelineIo';
import type { TimelinePackage } from '../timeline/types';

describe('LocalStorageTimelineRepository', () => {
  let repository: LocalStorageTimelineRepository;

  beforeEach(() => {
    localStorage.clear();
    repository = new LocalStorageTimelineRepository(localStorage);
  });

  it('round-trips a timeline', async () => {
    await repository.save(EXAMPLE_TIMELINE);
    const entry = await repository.get(EXAMPLE_TIMELINE.id);
    expect(entry?.status).toBe('valid');
    if (entry?.status === 'valid') {
      expect(entry.timeline.meta.name).toBe(EXAMPLE_TIMELINE.meta.name);
      expect(entry.report.hasBlockingError).toBe(false);
    }
  });

  it('isolates a corrupt record instead of breaking the library', async () => {
    await repository.save(EXAMPLE_TIMELINE);
    localStorage.setItem(timelineKey('broken'), '{ not json');
    localStorage.setItem(
      `${'ff14tc:v1'}:timeline-index`,
      JSON.stringify([EXAMPLE_TIMELINE.id, 'broken']),
    );

    const entries = await repository.getAll();
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.id === EXAMPLE_TIMELINE.id)?.status).toBe('valid');

    const broken = entries.find((entry) => entry.id === 'broken');
    expect(broken?.status).toBe('invalid');
    if (broken?.status === 'invalid') expect(broken.raw).toBe('{ not json');

    // Raw export and delete stay available for the broken record.
    expect(await repository.getRaw('broken')).toBe('{ not json');
    await repository.delete('broken');
    expect(await repository.get('broken')).toBeNull();
  });

  it('marks a record with a wrong schema version as invalid', async () => {
    localStorage.setItem(
      timelineKey('future'),
      JSON.stringify({ id: 'future', updatedAtMs: 0, timeline: { schemaVersion: 99 } }),
    );
    localStorage.setItem(`${'ff14tc:v1'}:timeline-index`, JSON.stringify(['future']));

    const entries = await repository.getAll();
    expect(entries[0].status).toBe('invalid');
    if (entries[0].status === 'invalid') expect(entries[0].error).toMatch(/schemaVersion/);
  });

  it('keeps domain-invalid timelines editable', async () => {
    const broken: TimelinePackage = structuredClone(EXAMPLE_TIMELINE);
    broken.tracks[0].events[0].cues[0].text = '';
    await repository.save(broken);

    const entry = await repository.get(broken.id);
    expect(entry?.status).toBe('valid');
    if (entry?.status === 'valid') expect(entry.report.hasBlockingError).toBe(true);
  });

  it('removes deleted ids from the index', async () => {
    await repository.save(EXAMPLE_TIMELINE);
    await repository.delete(EXAMPLE_TIMELINE.id);
    expect(await repository.getAll()).toHaveLength(0);
  });
});

describe('timeline import/export', () => {
  it('names exports encounter-strategy-version.json', () => {
    expect(
      exportFileName({
        ...EXAMPLE_TIMELINE,
        meta: { name: 'M4S', encounterId: 'm4s', strategy: 'tw-pf', version: '1.2.0' },
      }),
    ).toBe('m4s-tw-pf-v1-2-0.json');

    expect(
      exportFileName({
        ...EXAMPLE_TIMELINE,
        meta: { name: 'M4S', encounterId: 'm4s', strategy: 'tw-pf' },
      }),
    ).toBe('m4s-tw-pf.json');
  });

  it('rejects malformed import payloads', () => {
    expect(parseImportPayload('not json').ok).toBe(false);
    expect(parseImportPayload('{}').ok).toBe(false);
    expect(parseImportPayload(JSON.stringify(EXAMPLE_TIMELINE)).ok).toBe(true);
  });
});
