import { DEFAULT_COLLISION_WINDOW_MS } from '../timeline/collision';
import { DEFAULT_AUDIO_CONFIG } from '../timeline/compiler';
import { DEFAULT_MAX_LATE_MS, DEFAULT_TICK_INTERVAL_MS } from '../engine/TimelineEngine';
import type {
  JobCode,
  PartyPosition,
  PlayerProfile,
  ResolvedAudioConfig,
} from '../timeline/types';
import { STORAGE_PREFIX } from './LocalStorageTimelineRepository';

/**
 * Browser-local preferences (spec §17, §37, §42, §43). Stored separately from
 * timelines: player choices must never mutate timeline JSON.
 */

export interface AppSettings {
  /** Skip the Ready Summary before START (spec §37). */
  quickStart: boolean;
  /** Esc triggers WIPE (spec §42). */
  escWipe: boolean;
  collisionWindowMs: number;
  tickIntervalMs: number;
  maxLateMs: number;
  audio: ResolvedAudioConfig;
  lastCountdownMs: number;
  lastPosition: PartyPosition;
  lastJob: JobCode;
  /** Measured constant drift for this browser/setup; survives pulls (spec §34). */
  sessionOffsetMs: number;
}

/** 常用的開場倒數秒數；玩家沒有自己設定時就用這個值。 */
export const DEFAULT_COUNTDOWN_MS = 16_000;

export const DEFAULT_SETTINGS: AppSettings = {
  quickStart: false,
  escWipe: true,
  collisionWindowMs: DEFAULT_COLLISION_WINDOW_MS,
  tickIntervalMs: DEFAULT_TICK_INTERVAL_MS,
  maxLateMs: DEFAULT_MAX_LATE_MS,
  audio: { ...DEFAULT_AUDIO_CONFIG },
  lastCountdownMs: DEFAULT_COUNTDOWN_MS,
  lastPosition: 'MT',
  lastJob: 'PLD',
  sessionOffsetMs: 0,
};

export const COUNTDOWN_PRESETS_MS = [5000, 10_000, 16_000, 20_000] as const;

const SETTINGS_KEY = `${STORAGE_PREFIX}:settings`;

/**
 * Track selection is remembered per timeline *and* per identity (spec §4.2):
 * a Scholar's choice must not be reused when the same player switches to
 * Astrologian.
 */
const playerPrefsKey = (timelineId: string, position: PartyPosition, job: JobCode) =>
  `${STORAGE_PREFIX}:player-prefs:${timelineId}:${position}:${job}`;

/** Pre-V2 key: one shared preference per timeline, with no identity. */
const legacyPlayerPrefsKey = (timelineId: string) =>
  `${STORAGE_PREFIX}:player-prefs:${timelineId}`;

/**
 * Marker recording which identity inherited the legacy preference.
 *
 * Without it the same old selection would be re-applied every time the player
 * tries a new job, which is exactly the bug §4.2 calls out.
 */
const legacyClaimKey = (timelineId: string) =>
  `${STORAGE_PREFIX}:player-prefs-claimed:${timelineId}`;

/** Per-timeline, per-identity player choices (spec §43). */
export interface TimelinePlayerPrefs {
  enabledTrackIds?: string[];
  countdownMs?: number;
  /** Chosen option per selection group id (spec §4.4). */
  selectedOptions?: Record<string, string>;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSettings(): AppSettings {
  const store = storage();
  if (!store) return { ...DEFAULT_SETTINGS };
  const raw = store.getItem(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      audio: { ...DEFAULT_SETTINGS.audio, ...(parsed.audio ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  storage()?.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function parsePrefs(raw: string | null): TimelinePlayerPrefs | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const value = parsed as TimelinePlayerPrefs;
    const result: TimelinePlayerPrefs = {};
    // Validate as data: a corrupt or hand-edited record must not crash the
    // player or silently pretend to be valid.
    if (Array.isArray(value.enabledTrackIds)) {
      result.enabledTrackIds = value.enabledTrackIds.filter(
        (id): id is string => typeof id === 'string',
      );
    }
    if (typeof value.countdownMs === 'number' && Number.isFinite(value.countdownMs)) {
      result.countdownMs = value.countdownMs;
    }
    if (
      typeof value.selectedOptions === 'object' &&
      value.selectedOptions !== null &&
      !Array.isArray(value.selectedOptions)
    ) {
      const options: Record<string, string> = {};
      for (const [groupId, optionId] of Object.entries(value.selectedOptions)) {
        if (typeof optionId === 'string') options[groupId] = optionId;
      }
      result.selectedOptions = options;
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Read the preference for one identity.
 *
 * The legacy per-timeline record is inherited by whichever identity opens the
 * timeline first, and only once — the claim marker stops it from being pasted
 * onto every other job afterwards.
 */
export function loadPlayerPrefs(
  timelineId: string,
  profile: PlayerProfile,
): TimelinePlayerPrefs {
  const store = storage();
  if (!store) return {};

  const own = parsePrefs(store.getItem(playerPrefsKey(timelineId, profile.position, profile.job)));
  if (own) return own;

  const claim = store.getItem(legacyClaimKey(timelineId));
  const claimKey = `${profile.position}:${profile.job}`;
  if (claim !== null && claim !== claimKey) return {};

  const legacy = parsePrefs(store.getItem(legacyPlayerPrefsKey(timelineId)));
  if (!legacy) return {};

  if (claim === null) {
    try {
      // The old key itself is left in place, so downgrading keeps working.
      store.setItem(legacyClaimKey(timelineId), claimKey);
    } catch {
      // A failed marker write only means the legacy value may be inherited
      // again later; it must not break loading.
    }
  }
  return legacy;
}

export class PrefsWriteError extends Error {
  constructor(readonly cause?: unknown) {
    super('儲存軌道選擇失敗，這次的設定只保留在畫面上');
    this.name = 'PrefsWriteError';
  }
}

/** Throws {@link PrefsWriteError} so the UI can report it (spec §4.2). */
export function savePlayerPrefs(
  timelineId: string,
  profile: PlayerProfile,
  prefs: TimelinePlayerPrefs,
): void {
  const store = storage();
  if (!store) throw new PrefsWriteError();
  try {
    store.setItem(
      playerPrefsKey(timelineId, profile.position, profile.job),
      JSON.stringify(prefs),
    );
  } catch (error) {
    throw new PrefsWriteError(error);
  }
}

/** Drop track ids that no longer exist, so a deleted track cannot linger. */
export function pruneEnabledTrackIds(
  enabledTrackIds: readonly string[],
  existingTrackIds: readonly string[],
): string[] {
  const existing = new Set(existingTrackIds);
  return enabledTrackIds.filter((id) => existing.has(id));
}
