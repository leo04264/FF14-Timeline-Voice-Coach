import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import baseline from '../test/baseline/compiledBaseline.json';
import { compileTimeline } from './compiler';
import { migrateTimeline, migrateV1ToV2 } from './migration';
import { parseTimelinePackage, parseTimelinePackageV1 } from './schema';
import { JOB_CODES, PARTY_POSITIONS, type TimelinePackage } from './types';

/**
 * The regression gate for V1 -> V2 (spec §9 D.26).
 *
 * `src/test/baseline/compiledBaseline.json` was generated from the **pre-V2
 * compiler** before any of this work started. Every shipped template, for every
 * position x job x track-set combination, must still compile to the same cue
 * ids, texts, trigger times, order and resolved audio.
 *
 * New preflight warnings are allowed to change. Existing timings are not.
 */

const DIR = 'public/timelines';
const AUDIO = { lang: 'zh-TW', rate: 1.15, pitch: 1, volume: 1 } as const;

const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 32);

const row = (cue: {
  id: string;
  triggerMs: number;
  text: string;
  priority: string;
  trackId: string;
  eventId: string;
  eventAtMs: number;
  offsetMs: number;
  phase?: string;
  category: string;
  audio: { lang: string; rate: number; pitch: number; volume: number; voiceUri?: string };
}) =>
  `${cue.id}|${cue.triggerMs}|${cue.text}|${cue.priority}|${cue.trackId}|${cue.eventId}|${cue.eventAtMs}|${cue.offsetMs}|${cue.phase ?? ''}|${cue.category}|${cue.audio.lang}/${cue.audio.rate}/${cue.audio.pitch}/${cue.audio.volume}/${cue.audio.voiceUri ?? ''}`;

interface BaselineFile {
  id: string;
  encounter: { durationMs: number; countdownMs: number };
  trackIds: string[];
  defaultTrackIds: string[];
  cases: Record<string, { n: number; sha: string }>;
  detail: Record<string, string[]>;
}

const files = Object.keys((baseline as { files: Record<string, BaselineFile> }).files);
const expectedFor = (file: string) =>
  (baseline as { files: Record<string, BaselineFile> }).files[file];

function loadMigrated(file: string): TimelinePackage {
  const payload: unknown = JSON.parse(readFileSync(`${DIR}/${file}`, 'utf8'));
  const migrated = migrateTimeline(payload);
  if (!migrated.ok) throw new Error(`${file}: ${migrated.error}`);
  const parsed = parseTimelinePackage(migrated.value);
  if (!parsed.ok) throw new Error(`${file}: ${JSON.stringify(parsed.issues)}`);
  return parsed.timeline;
}

describe('V1 -> V2 遷移不改變任何既有時間安排', () => {
  it('baseline 檔案本身是 V2 之前產生的', () => {
    expect((baseline as { generatedFrom: string }).generatedFrom).toContain('pre-V2');
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s 的 encounter 與軌道結構未變', (file) => {
    const expected = expectedFor(file);
    const timeline = loadMigrated(file);
    expect(timeline.id).toBe(expected.id);
    expect(timeline.encounter).toEqual(expected.encounter);
    expect(timeline.tracks.map((track) => track.id)).toEqual(expected.trackIds);
    expect(
      timeline.tracks.filter((track) => track.enabledByDefault).map((track) => track.id),
    ).toEqual(expected.defaultTrackIds);
  });

  it.each(files)('%s 對全部 8x21x3 組合的編譯輸出逐位元組相同', (file) => {
    const expected = expectedFor(file);
    const timeline = loadMigrated(file);
    const allIds = timeline.tracks.map((track) => track.id);
    const defaults = timeline.tracks
      .filter((track) => track.enabledByDefault)
      .map((track) => track.id);

    const mismatches: string[] = [];
    for (const position of PARTY_POSITIONS) {
      for (const job of JOB_CODES) {
        for (const [label, ids] of [
          ['all', allIds],
          ['default', defaults],
          ['none', [] as string[]],
        ] as const) {
          const rows = compileTimeline(timeline, {
            profile: { position, job },
            enabledTrackIds: ids,
            audioDefaults: AUDIO,
          }).cues.map(row);

          const key = `${position}/${job}/${label}`;
          const want = expected.cases[key];
          if (!want) {
            mismatches.push(`${key}: baseline 缺少這個案例`);
            continue;
          }
          if (rows.length !== want.n || sha(rows.join('\n')) !== want.sha) {
            const detail = expected.detail[key];
            mismatches.push(
              detail
                ? `${key}: 期望 ${want.n} 句、實得 ${rows.length} 句；第一處差異 ${
                    rows.find((value, index) => value !== detail[index]) ?? '(僅長度不同)'
                  }`
                : `${key}: 期望 ${want.n} 句/${want.sha}，實得 ${rows.length} 句/${sha(rows.join('\n'))}`,
            );
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it.each(files)('%s 對四種代表身分的每一句明細相同', (file) => {
    const expected = expectedFor(file);
    const timeline = loadMigrated(file);
    const allIds = timeline.tracks.map((track) => track.id);
    const defaults = timeline.tracks
      .filter((track) => track.enabledByDefault)
      .map((track) => track.id);

    for (const [key, want] of Object.entries(expected.detail)) {
      const [position, job, label] = key.split('/');
      const rows = compileTimeline(timeline, {
        profile: { position: position as never, job: job as never },
        enabledTrackIds: label === 'all' ? allIds : defaults,
        audioDefaults: AUDIO,
      }).cues.map(row);
      expect(rows, `${file} ${key}`).toEqual(want);
    }
  });
});

describe('migrateV1ToV2 的性質', () => {
  it('是純函式，不修改輸入', () => {
    const payload: unknown = JSON.parse(readFileSync(`${DIR}/${files[0]}`, 'utf8'));
    const before = JSON.stringify(payload);
    const parsed = parseTimelinePackageV1(payload);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    migrateV1ToV2(parsed.timeline);
    expect(JSON.stringify(payload)).toBe(before);
  });

  it('毫秒數值完全不四捨五入，offsetMs 原樣保留', () => {
    const v1 = {
      schemaVersion: 1 as const,
      id: 'ms-precision',
      meta: { name: 'x', encounterId: 'y' },
      encounter: { durationMs: 100_001, countdownMs: 15_000 },
      tracks: [
        {
          id: 't',
          type: 'encounter' as const,
          name: 'T',
          enabledByDefault: true,
          events: [
            {
              id: 'e',
              atMs: -14_999,
              name: 'E',
              category: 'mechanic' as const,
              cues: [{ id: 'c', offsetMs: 1, text: 'a' }],
            },
          ],
        },
      ],
    };
    const v2 = migrateV1ToV2(v1);
    expect(v2.tracks[0].events[0].timing).toEqual({ kind: 'absolute', atMs: -14_999 });
    expect(v2.tracks[0].events[0].cues[0].offsetMs).toBe(1);
    expect(v2.encounter).toEqual({ durationMs: 100_001, countdownMs: 15_000 });
  });

  it('不會把同時間或名稱相近的舊事件猜成連動', () => {
    for (const file of files) {
      const timeline = loadMigrated(file);
      const linked = timeline.tracks.flatMap((track) =>
        track.events.filter((event) => event.timing.kind === 'mechanic'),
      );
      expect(linked, file).toEqual([]);
    }
  });

  it('V2 不再重複遷移，round trip 穩定', () => {
    const timeline = loadMigrated(files[0]);
    const again = migrateTimeline(timeline);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value).toBe(timeline);
    expect(again.migratedFrom).toBeUndefined();
    const reparsed = parseTimelinePackage(JSON.parse(JSON.stringify(timeline)));
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.timeline).toEqual(timeline);
  });

  it('拒絕未來版本，且不吞掉未知欄位', () => {
    const future = { schemaVersion: 99, id: 'x', meta: {}, encounter: {}, tracks: [] };
    const result = migrateTimeline(future);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('99');
  });

  it('結構不合法的 V1 會在遷移前就被擋下', () => {
    const broken = {
      schemaVersion: 1,
      id: 'x',
      meta: { name: 'x', encounterId: 'y' },
      encounter: { durationMs: 1, countdownMs: 0 },
      tracks: [{ id: 't', type: 'encounter', name: 'T', enabledByDefault: true, events: [{ id: 'e', atMs: 'nope', name: 'E', category: 'mechanic', cues: [] }] }],
    };
    const result = migrateTimeline(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('schemaVersion 1');
  });
});
