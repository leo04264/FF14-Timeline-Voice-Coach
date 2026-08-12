import {
  JOB_ROLE,
  POSITION_ROLES,
  type CueTarget,
  type JobCode,
  type PartyPosition,
  type PlayerProfile,
} from './types';
import { JOB_NAME_LABEL } from '../i18n/labels';

/**
 * Target semantics (spec §19):
 *   - within a dimension the listed values are OR-ed
 *   - across dimensions the constraints are AND-ed
 *   - a missing dimension means "any"
 *   - an *explicitly empty* array means "nobody" (only produced by intersecting
 *     a track target with a non-overlapping cue target)
 */
export function matchesTarget(target: CueTarget | undefined, profile: PlayerProfile): boolean {
  if (!target) return true;
  if (target.positions && !target.positions.includes(profile.position)) return false;
  if (target.jobs && !target.jobs.includes(profile.job)) return false;
  return true;
}

function intersectDimension<T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
  if (!a) return b ? [...b] : undefined;
  if (!b) return [...a];
  return a.filter((value) => b.includes(value));
}

/**
 * Track target AND cue target. The result is the effective audience of a cue.
 */
export function combineTargets(
  trackTarget: CueTarget | undefined,
  cueTarget: CueTarget | undefined,
): CueTarget | undefined {
  if (!trackTarget) return cueTarget;
  if (!cueTarget) return trackTarget;

  const positions = intersectDimension<PartyPosition>(trackTarget.positions, cueTarget.positions);
  const jobs = intersectDimension<JobCode>(trackTarget.jobs, cueTarget.jobs);

  const combined: CueTarget = {};
  if (positions) combined.positions = positions;
  if (jobs) combined.jobs = jobs;
  return combined;
}

function dimensionsOverlap<T>(a: T[] | undefined, b: T[] | undefined): boolean {
  if (!a || !b) return true; // "any" overlaps everything
  return a.some((value) => b.includes(value));
}

/**
 * True when both targets could fire for the same player (spec §27). Used by
 * collision analysis — mutually exclusive targets never collide.
 */
export function targetsCanOverlap(a: CueTarget | undefined, b: CueTarget | undefined): boolean {
  if (!a || !b) return true;
  return dimensionsOverlap(a.positions, b.positions) && dimensionsOverlap(a.jobs, b.jobs);
}

/** A target that can never match anybody (empty dimension after intersection). */
export function isEmptyTarget(target: CueTarget | undefined): boolean {
  if (!target) return false;
  if (target.positions && target.positions.length === 0) return true;
  if (target.jobs && target.jobs.length === 0) return true;
  return false;
}

export function describeTarget(target: CueTarget | undefined): string {
  if (!target) return '所有人';
  const parts: string[] = [];
  if (target.positions) {
    parts.push(target.positions.length ? target.positions.join('/') : '（沒有站位）');
  }
  if (target.jobs) {
    parts.push(
      target.jobs.length
        ? target.jobs.map((job) => JOB_NAME_LABEL[job]).join('/')
        : '（沒有職業）',
    );
  }
  return parts.length ? parts.join(' + ') : '所有人';
}

/**
 * Unconventional position/job combinations are allowed but warned about
 * (spec §8) — never blocked, because odd setups are useful for testing.
 */
export function isConventionalAssignment(position: PartyPosition, job: JobCode): boolean {
  return POSITION_ROLES[position].includes(JOB_ROLE[job]);
}
