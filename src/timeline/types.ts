/**
 * Domain model for FF14 Timeline Voice Coach.
 *
 * All time values in this module are milliseconds (spec §6).
 * Never store formatted strings such as "00:48" in the domain model.
 */

export type PartyPosition =
  | 'MT'
  | 'ST'
  | 'H1'
  | 'H2'
  | 'D1'
  | 'D2'
  | 'D3'
  | 'D4';

export const PARTY_POSITIONS: readonly PartyPosition[] = [
  'MT',
  'ST',
  'H1',
  'H2',
  'D1',
  'D2',
  'D3',
  'D4',
];

export type JobCode =
  | 'PLD'
  | 'WAR'
  | 'DRK'
  | 'GNB'
  | 'WHM'
  | 'SCH'
  | 'AST'
  | 'SGE'
  | 'MNK'
  | 'DRG'
  | 'NIN'
  | 'SAM'
  | 'RPR'
  | 'VPR'
  | 'BRD'
  | 'MCH'
  | 'DNC'
  | 'BLM'
  | 'SMN'
  | 'RDM'
  | 'PCT';

export const JOB_CODES: readonly JobCode[] = [
  'PLD',
  'WAR',
  'DRK',
  'GNB',
  'WHM',
  'SCH',
  'AST',
  'SGE',
  'MNK',
  'DRG',
  'NIN',
  'SAM',
  'RPR',
  'VPR',
  'BRD',
  'MCH',
  'DNC',
  'BLM',
  'SMN',
  'RDM',
  'PCT',
];

export type JobRole = 'tank' | 'healer' | 'melee' | 'ranged' | 'caster';

export const JOB_ROLE: Readonly<Record<JobCode, JobRole>> = {
  PLD: 'tank',
  WAR: 'tank',
  DRK: 'tank',
  GNB: 'tank',
  WHM: 'healer',
  SCH: 'healer',
  AST: 'healer',
  SGE: 'healer',
  MNK: 'melee',
  DRG: 'melee',
  NIN: 'melee',
  SAM: 'melee',
  RPR: 'melee',
  VPR: 'melee',
  BRD: 'ranged',
  MCH: 'ranged',
  DNC: 'ranged',
  BLM: 'caster',
  SMN: 'caster',
  RDM: 'caster',
  PCT: 'caster',
};

/** Roles conventionally expected at each party position. */
export const POSITION_ROLES: Readonly<Record<PartyPosition, readonly JobRole[]>> = {
  MT: ['tank'],
  ST: ['tank'],
  H1: ['healer'],
  H2: ['healer'],
  D1: ['melee'],
  D2: ['melee'],
  D3: ['ranged'],
  D4: ['caster'],
};

export type EventCategory =
  | 'mechanic'
  | 'raidwide'
  | 'tankbuster'
  | 'tankswap'
  | 'mitigation'
  | 'heal'
  | 'shield'
  | 'movement'
  | 'job'
  | 'custom';

export const EVENT_CATEGORIES: readonly EventCategory[] = [
  'mechanic',
  'raidwide',
  'tankbuster',
  'tankswap',
  'mitigation',
  'heal',
  'shield',
  'movement',
  'job',
  'custom',
];

/** V0.1 deliberately has no `critical` level (spec §20). */
export type CuePriority = 'low' | 'normal' | 'high';

export const CUE_PRIORITIES: readonly CuePriority[] = ['low', 'normal', 'high'];

export type TimelineTrackType = 'encounter' | 'role' | 'job' | 'party' | 'custom';

export const TIMELINE_TRACK_TYPES: readonly TimelineTrackType[] = [
  'encounter',
  'role',
  'job',
  'party',
  'custom',
];

/**
 * Cue targeting.
 *
 * Within one dimension the values are OR-ed, across dimensions they are AND-ed
 * (spec §19). `undefined` on a dimension means "any". An explicitly empty array
 * means "nobody" — it can only be produced by intersecting a track target with a
 * cue target that do not overlap.
 */
export interface CueTarget {
  positions?: PartyPosition[];
  jobs?: JobCode[];
}

/**
 * Per-cue audio overrides. Every field is optional; the compiler resolves them
 * against the player's audio defaults so a CompiledCue always carries a
 * fully-resolved config.
 */
export interface AudioConfig {
  /** BCP-47 language tag handed to the TTS backend. */
  lang?: string;
  /** SpeechSynthesisVoice.voiceURI, when the player pinned a specific voice. */
  voiceUri?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
}

export type ResolvedAudioConfig = Required<Pick<AudioConfig, 'lang' | 'rate' | 'pitch' | 'volume'>> & {
  voiceUri?: string;
};

export interface TimelineCue {
  id: string;
  /** Offset relative to the owning event; negative = before the event (spec §15). */
  offsetMs: number;
  text: string;
  target?: CueTarget;
  priority?: CuePriority;
  enabled?: boolean;
  audio?: AudioConfig;
}

export interface TimelineEvent {
  id: string;
  /** Absolute timeline time of the in-game event. May be negative (spec §16). */
  atMs: number;
  name: string;
  phase?: string;
  category: EventCategory;
  cues: TimelineCue[];
}

export interface TimelineTrack {
  id: string;
  type: TimelineTrackType;
  name: string;
  enabledByDefault: boolean;
  /** Applied on top of each cue target (intersection). */
  target?: CueTarget;
  events: TimelineEvent[];
}

export interface TimelineMeta {
  name: string;
  encounterId: string;
  strategy?: string;
  author?: string;
  description?: string;
  version?: string;
}

export interface EncounterConfig {
  durationMs: number;
  countdownMs: number;
}

export interface TimelinePackage {
  schemaVersion: 1;
  id: string;
  meta: TimelineMeta;
  encounter: EncounterConfig;
  tracks: TimelineTrack[];
}

export const CURRENT_SCHEMA_VERSION = 1 as const;

/** Who the player is for this session. */
export interface PlayerProfile {
  position: PartyPosition;
  job: JobCode;
}

export interface CompiledCue {
  id: string;
  trackId: string;
  eventId: string;
  eventName: string;
  eventAtMs: number;
  triggerMs: number;
  offsetMs: number;
  phase?: string;
  category: EventCategory;
  text: string;
  priority: CuePriority;
  audio: ResolvedAudioConfig;
}

export interface CompiledTimeline {
  timelineId: string;
  name: string;
  durationMs: number;
  /** Countdown actually used for this run (may be a player override, spec §17). */
  countdownMs: number;
  profile: PlayerProfile;
  enabledTrackIds: string[];
  cues: CompiledCue[];
}
