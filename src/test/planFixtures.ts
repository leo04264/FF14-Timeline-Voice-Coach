import { DEFAULT_SETTINGS } from '../storage/settings';
import type { PlaybackPlanInput } from '../timeline/playbackPlan';
import {
  absoluteTiming,
  mechanicTiming,
  type PlayerProfile,
  type TimelineCue,
  type TimelineEvent,
  type TimelinePackage,
  type TimelineTrack,
} from '../timeline/types';

/** Small builders so tests read as data, not as boilerplate. */

export function cue(id: string, text: string, extra: Partial<TimelineCue> = {}): TimelineCue {
  return { id, offsetMs: 0, text, ...extra };
}

export function absEvent(
  id: string,
  atMs: number,
  cues: TimelineCue[],
  extra: Partial<Omit<TimelineEvent, 'id' | 'timing' | 'cues'>> = {},
): TimelineEvent {
  return { id, timing: absoluteTiming(atMs), name: id, category: 'mechanic', cues, ...extra };
}

export function linkedEvent(
  id: string,
  sourceTrackId: string,
  sourceEventId: string,
  cues: TimelineCue[],
  extra: Partial<Omit<TimelineEvent, 'id' | 'timing' | 'cues'>> = {},
): TimelineEvent {
  return {
    id,
    timing: mechanicTiming(sourceTrackId, sourceEventId),
    name: id,
    category: 'custom',
    cues,
    ...extra,
  };
}

export function track(
  id: string,
  events: TimelineEvent[],
  extra: Partial<Omit<TimelineTrack, 'id' | 'events'>> = {},
): TimelineTrack {
  return { id, type: 'custom', name: id, enabledByDefault: true, events, ...extra };
}

export function timelineOf(
  tracks: TimelineTrack[],
  extra: Partial<Omit<TimelinePackage, 'tracks'>> = {},
): TimelinePackage {
  return {
    schemaVersion: 2,
    id: 'fixture',
    meta: { name: 'Fixture', encounterId: 'fixture' },
    encounter: { durationMs: 600_000, countdownMs: 15_000 },
    tracks,
    ...extra,
  };
}

export const SCH: PlayerProfile = { position: 'H2', job: 'SCH' };
export const AST: PlayerProfile = { position: 'H1', job: 'AST' };
export const PLD: PlayerProfile = { position: 'MT', job: 'PLD' };

export function planInput(
  timeline: TimelinePackage,
  profile: PlayerProfile,
  enabledTrackIds: readonly string[],
  overrides: Partial<PlaybackPlanInput> = {},
): PlaybackPlanInput {
  return {
    timeline,
    profile,
    enabledTrackIds,
    countdownMs: timeline.encounter.countdownMs,
    audio: DEFAULT_SETTINGS.audio,
    collisionWindowMs: DEFAULT_SETTINGS.collisionWindowMs,
    maxLateMs: DEFAULT_SETTINGS.maxLateMs,
    sessionOffsetMs: 0,
    speechSupported: true,
    ...overrides,
  };
}

/**
 * A timeline containing Scholar-only, Astrologian-only and shared content, plus
 * two mutually exclusive strategies. Used by the identity / exclusivity tests.
 */
export function mixedTimeline(): TimelinePackage {
  return timelineOf(
    [
      track(
        'boss',
        [
          absEvent('boss-1', 60_000, [cue('boss-1-cue', '全體傷害')], { category: 'raidwide' }),
          absEvent('boss-2', 120_000, [cue('boss-2-cue', '死刑')], { category: 'tankbuster' }),
        ],
        { type: 'encounter', name: 'Boss Mechanics' },
      ),
      // Scholar healing plan
      track('sch-heal', [absEvent('sch-heal-1', 58_000, [cue('sch-heal-1-cue', '罩子')])], {
        type: 'job',
        name: 'H2 學者奶軸',
        target: { positions: ['H2'], jobs: ['SCH'] },
      }),
      // Scholar damage rotation — same job, must be usable together with above
      track('sch-dps', [absEvent('sch-dps-1', 30_000, [cue('sch-dps-1-cue', '補毒')])], {
        type: 'job',
        name: 'H2 學者輸出',
        target: { positions: ['H2'], jobs: ['SCH'] },
      }),
      // Astrologian only
      track('ast-heal', [absEvent('ast-heal-1', 58_000, [cue('ast-heal-1-cue', '命運之輪')])], {
        type: 'job',
        name: 'H1 占星奶軸',
        target: { positions: ['H1'], jobs: ['AST'] },
      }),
      // Shared healer content, addressed to two jobs at once
      track(
        'shared-healer',
        [absEvent('shared-1', 90_000, [cue('shared-1-cue', '補血', { target: { jobs: ['SCH', 'SGE'] } })])],
        { type: 'role', name: '補師共用', target: { positions: ['H1', 'H2'] } },
      ),
      // Two exclusive strategies for the same fight
      track('plan-a-1', [absEvent('plan-a-1-e', 200_000, [cue('plan-a-1-cue', 'A 方案第一步')])], {
        type: 'job',
        name: 'A 方案（學者）',
        target: { positions: ['H2'], jobs: ['SCH'] },
        selection: { groupId: 'strategy', optionId: 'a' },
      }),
      track('plan-a-2', [absEvent('plan-a-2-e', 210_000, [cue('plan-a-2-cue', 'A 方案第二步')])], {
        type: 'job',
        name: 'A 方案補充（學者）',
        target: { positions: ['H2'], jobs: ['SCH'] },
        selection: { groupId: 'strategy', optionId: 'a' },
      }),
      track('plan-b-1', [absEvent('plan-b-1-e', 200_000, [cue('plan-b-1-cue', 'B 方案第一步')])], {
        type: 'job',
        name: 'B 方案（學者）',
        target: { positions: ['H2'], jobs: ['SCH'] },
        selection: { groupId: 'strategy', optionId: 'b' },
      }),
      // Belongs to option B but targets another job: must never create a
      // phantom conflict for a Scholar.
      track('plan-b-ast', [absEvent('plan-b-ast-e', 205_000, [cue('plan-b-ast-cue', 'B 方案占星')])], {
        type: 'job',
        name: 'B 方案（占星）',
        target: { positions: ['H1'], jobs: ['AST'] },
        selection: { groupId: 'strategy', optionId: 'b' },
      }),
    ],
    {
      selectionGroups: [
        {
          id: 'strategy',
          name: '打法方案',
          options: [
            { id: 'a', name: 'A 方案' },
            { id: 'b', name: 'B 方案' },
          ],
        },
      ],
    },
  );
}
