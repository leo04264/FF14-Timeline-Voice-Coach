import { createId } from './ids';
import type { TimelinePackage, TimelineTrack } from './types';

/**
 * In-source demo timeline. Used by unit tests and as the "New from example"
 * template. Built-in read-only templates ship as JSON under
 * `/public/timelines/` (spec §64).
 */
export const EXAMPLE_TIMELINE: TimelinePackage = {
  schemaVersion: 1,
  id: 'example-demo-encounter',
  meta: {
    name: '示範時間軸',
    encounterId: 'demo',
    strategy: 'example',
    author: 'FF14 Timeline Voice Coach',
    description: '示範用的短時間軸，展示軌道、對象、優先度與負時間提示。',
    version: '1.0.0',
  },
  encounter: {
    durationMs: 120_000,
    countdownMs: 15_000,
  },
  tracks: [
    {
      id: 'example-track-boss',
      type: 'encounter',
      name: '王機制',
      enabledByDefault: true,
      events: [
        {
          id: 'example-event-pull',
          atMs: 0,
          name: '開場',
          phase: 'P1',
          category: 'mechanic',
          cues: [
            {
              id: 'example-cue-pull-warn',
              offsetMs: -2000,
              text: '兩秒後開始',
              priority: 'normal',
            },
          ],
        },
        {
          id: 'example-event-raidwide',
          atMs: 20_000,
          name: '全體攻擊',
          phase: 'P1',
          category: 'raidwide',
          cues: [
            {
              id: 'example-cue-raidwide-warn',
              offsetMs: -5000,
              text: '五秒後全體攻擊',
              priority: 'normal',
            },
          ],
        },
        {
          id: 'example-event-tankbuster',
          atMs: 48_000,
          name: '坦克死刑',
          phase: 'P1',
          category: 'tankbuster',
          cues: [
            {
              id: 'example-cue-tb-mt',
              offsetMs: -3000,
              text: '三秒後坦克死刑',
              target: { positions: ['MT'] },
              priority: 'high',
            },
            {
              id: 'example-cue-tb-st',
              offsetMs: -2000,
              text: '準備換坦',
              target: { positions: ['ST'] },
              priority: 'high',
            },
          ],
        },
        {
          id: 'example-event-enrage',
          atMs: 115_000,
          name: '狂暴',
          phase: 'P2',
          category: 'mechanic',
          cues: [
            {
              id: 'example-cue-enrage',
              offsetMs: -10_000,
              text: '十秒後狂暴',
              priority: 'high',
            },
          ],
        },
      ],
    },
    {
      id: 'example-track-party-mit',
      type: 'party',
      name: '團隊減傷',
      enabledByDefault: true,
      events: [
        {
          id: 'example-event-party-mit',
          atMs: 20_000,
          name: '全體減傷',
          phase: 'P1',
          category: 'mitigation',
          cues: [
            {
              id: 'example-cue-party-mit',
              offsetMs: -8000,
              text: '放團減',
              priority: 'normal',
            },
          ],
        },
      ],
    },
    {
      id: 'example-track-healer',
      type: 'role',
      name: '補師',
      enabledByDefault: false,
      target: { positions: ['H1', 'H2'] },
      events: [
        {
          id: 'example-event-heal',
          atMs: 20_000,
          name: '全體補血',
          phase: 'P1',
          category: 'heal',
          cues: [
            {
              id: 'example-cue-heal-h1',
              offsetMs: 500,
              text: '大團補',
              target: { positions: ['H1'] },
              priority: 'normal',
            },
            {
              id: 'example-cue-shield-h2',
              offsetMs: -6000,
              text: '上盾',
              target: { positions: ['H2'] },
              priority: 'normal',
            },
          ],
        },
      ],
    },
    {
      id: 'example-track-dnc',
      type: 'job',
      name: '舞者',
      enabledByDefault: false,
      target: { jobs: ['DNC'] },
      events: [
        {
          id: 'example-event-dnc-tech',
          atMs: 15_000,
          name: '技巧舞步',
          phase: 'P1',
          category: 'job',
          cues: [
            {
              id: 'example-cue-dnc-tech',
              offsetMs: -3000,
              text: '準備技巧舞步',
              priority: 'low',
            },
          ],
        },
      ],
    },
  ],
};

/** A brand-new empty timeline for the editor. */
export function createEmptyTimeline(name = '新的時間軸'): TimelinePackage {
  const track: TimelineTrack = {
    id: createId(),
    type: 'encounter',
    name: '王機制',
    enabledByDefault: true,
    events: [],
  };

  return {
    schemaVersion: 1,
    id: createId(),
    meta: {
      name,
      encounterId: 'unknown',
    },
    encounter: {
      durationMs: 600_000,
      countdownMs: 15_000,
    },
    tracks: [track],
  };
}

/**
 * Deep copy with fresh ids at every level. Used by Duplicate / Fork /
 * Import-as-Copy (spec §10, §65).
 */
export function cloneTimelineWithNewIds(
  timeline: TimelinePackage,
  overrides: { name?: string; version?: string } = {},
): TimelinePackage {
  return {
    ...timeline,
    id: createId(),
    meta: {
      ...timeline.meta,
      name: overrides.name ?? timeline.meta.name,
      version: overrides.version ?? timeline.meta.version,
    },
    encounter: { ...timeline.encounter },
    tracks: timeline.tracks.map((track) => ({
      ...track,
      id: createId(),
      target: track.target ? { ...track.target } : undefined,
      events: track.events.map((event) => ({
        ...event,
        id: createId(),
        cues: event.cues.map((cue) => ({
          ...cue,
          id: createId(),
          target: cue.target ? { ...cue.target } : undefined,
          audio: cue.audio ? { ...cue.audio } : undefined,
        })),
      })),
    })),
  };
}
