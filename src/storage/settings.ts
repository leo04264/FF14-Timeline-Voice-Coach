import { DEFAULT_COLLISION_WINDOW_MS } from '../timeline/collision';
import { DEFAULT_AUDIO_CONFIG } from '../timeline/compiler';
import { DEFAULT_MAX_LATE_MS, DEFAULT_TICK_INTERVAL_MS } from '../engine/TimelineEngine';
import type { JobCode, PartyPosition, ResolvedAudioConfig } from '../timeline/types';
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
const playerPrefsKey = (timelineId: string) => `${STORAGE_PREFIX}:player-prefs:${timelineId}`;

/** Per-timeline player choices (spec §43). */
export interface TimelinePlayerPrefs {
  enabledTrackIds?: string[];
  countdownMs?: number;
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

export function loadPlayerPrefs(timelineId: string): TimelinePlayerPrefs {
  const raw = storage()?.getItem(playerPrefsKey(timelineId));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as TimelinePlayerPrefs;
  } catch {
    return {};
  }
}

export function savePlayerPrefs(timelineId: string, prefs: TimelinePlayerPrefs): void {
  storage()?.setItem(playerPrefsKey(timelineId), JSON.stringify(prefs));
}
