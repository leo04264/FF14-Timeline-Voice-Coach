import { combineTargets, describeTarget, targetsCanOverlap } from './target';
import { DEFAULT_CUE_PRIORITY } from './compiler';
import type { CueTarget, CuePriority, TimelinePackage } from './types';

/**
 * Collision analysis (spec §26–§28).
 *
 * This is an *editor-time advisory*. The runtime never drops, merges or
 * rewrites cues because of a collision (spec §25).
 */

export const DEFAULT_COLLISION_WINDOW_MS = 2000;

export const COLLISION_WINDOW_PRESETS_MS = [500, 1000, 1500, 2000, 3000, 5000] as const;

/** Same priority is the more serious case: two equally important lines overlap. */
export type CollisionSeverity = 'warning' | 'severe';

export interface CollisionCueRef {
  trackId: string;
  trackName: string;
  eventId: string;
  eventName: string;
  cueId: string;
  text: string;
  triggerMs: number;
  priority: CuePriority;
  target?: CueTarget;
}

export interface CollisionPair {
  severity: CollisionSeverity;
  gapMs: number;
  a: CollisionCueRef;
  b: CollisionCueRef;
}

export interface CollisionReport {
  windowMs: number;
  pairs: CollisionPair[];
  /** cueId -> collisions involving that cue, for per-row markers in the editor. */
  byCueId: Map<string, CollisionPair[]>;
}

function emptyReport(windowMs: number): CollisionReport {
  return { windowMs, pairs: [], byCueId: new Map() };
}

export function collectCueRefs(timeline: TimelinePackage): CollisionCueRef[] {
  const refs: CollisionCueRef[] = [];
  for (const track of timeline.tracks) {
    for (const event of track.events) {
      for (const cue of event.cues) {
        if (cue.enabled === false) continue; // Disabled cues never play
        refs.push({
          trackId: track.id,
          trackName: track.name,
          eventId: event.id,
          eventName: event.name,
          cueId: cue.id,
          text: cue.text,
          triggerMs: event.atMs + cue.offsetMs,
          priority: cue.priority ?? DEFAULT_CUE_PRIORITY,
          target: combineTargets(track.target, cue.target),
        });
      }
    }
  }
  return refs;
}

/**
 * Two cues collide when they trigger within `windowMs` of each other *and*
 * their targets could both apply to the same player (spec §27).
 */
export function analyzeCollisions(
  timeline: TimelinePackage,
  windowMs: number = DEFAULT_COLLISION_WINDOW_MS,
): CollisionReport {
  return analyzeCueRefCollisions(collectCueRefs(timeline), windowMs);
}

export function analyzeCueRefCollisions(
  refs: CollisionCueRef[],
  windowMs: number = DEFAULT_COLLISION_WINDOW_MS,
): CollisionReport {
  if (windowMs <= 0 || refs.length < 2) return emptyReport(windowMs);

  const sorted = [...refs].sort((a, b) =>
    a.triggerMs === b.triggerMs ? a.cueId.localeCompare(b.cueId) : a.triggerMs - b.triggerMs,
  );

  const pairs: CollisionPair[] = [];
  const byCueId = new Map<string, CollisionPair[]>();

  const record = (cueId: string, pair: CollisionPair) => {
    const list = byCueId.get(cueId);
    if (list) list.push(pair);
    else byCueId.set(cueId, [pair]);
  };

  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j];
      const gapMs = b.triggerMs - a.triggerMs;
      if (gapMs > windowMs) break; // sorted: nothing further can be in window
      if (!targetsCanOverlap(a.target, b.target)) continue;

      const pair: CollisionPair = {
        severity: a.priority === b.priority ? 'severe' : 'warning',
        gapMs,
        a,
        b,
      };
      pairs.push(pair);
      record(a.cueId, pair);
      record(b.cueId, pair);
    }
  }

  return { windowMs, pairs, byCueId };
}

export function describeCollision(pair: CollisionPair): string {
  return (
    `${pair.a.eventName} / "${pair.a.text}" (${describeTarget(pair.a.target)}) ` +
    `and ${pair.b.eventName} / "${pair.b.text}" (${describeTarget(pair.b.target)}) ` +
    `trigger ${pair.gapMs}ms apart`
  );
}
