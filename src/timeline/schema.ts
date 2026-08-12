import { z } from 'zod';
import {
  CUE_PRIORITIES,
  EVENT_CATEGORIES,
  JOB_CODES,
  PARTY_POSITIONS,
  TIMELINE_TRACK_TYPES,
  type TimelinePackage,
} from './types';

/**
 * Structural validation (spec §72/§73). This layer only checks shape and value
 * ranges — cross-entity rules (duplicate ids, event beyond duration, ...) live
 * in validator.ts.
 */

const finiteMs = z
  .number({ invalid_type_error: 'Time must be a number of milliseconds' })
  .finite('Time must be finite (NaN / Infinity are invalid)');

const nonNegativeMs = finiteMs.min(0, 'Must be >= 0');

const enumFrom = <T extends string>(values: readonly T[], label: string) =>
  z.enum(values as unknown as [T, ...T[]], {
    errorMap: () => ({ message: `Invalid ${label}` }),
  });

export const partyPositionSchema = enumFrom(PARTY_POSITIONS, 'party position');
export const jobCodeSchema = enumFrom(JOB_CODES, 'job code');
export const eventCategorySchema = enumFrom(EVENT_CATEGORIES, 'event category');
export const cuePrioritySchema = enumFrom(CUE_PRIORITIES, 'cue priority');
export const trackTypeSchema = enumFrom(TIMELINE_TRACK_TYPES, 'track type');

export const cueTargetSchema = z
  .object({
    positions: z.array(partyPositionSchema).optional(),
    jobs: z.array(jobCodeSchema).optional(),
  })
  .strict();

export const audioConfigSchema = z
  .object({
    lang: z.string().min(1).optional(),
    voiceUri: z.string().min(1).optional(),
    rate: z.number().finite().min(0.1).max(10).optional(),
    pitch: z.number().finite().min(0).max(2).optional(),
    volume: z.number().finite().min(0).max(1).optional(),
  })
  .strict();

export const timelineCueSchema = z
  .object({
    id: z.string().min(1),
    offsetMs: finiteMs,
    text: z.string(),
    target: cueTargetSchema.optional(),
    priority: cuePrioritySchema.optional(),
    enabled: z.boolean().optional(),
    audio: audioConfigSchema.optional(),
  })
  .strict();

export const timelineEventSchema = z
  .object({
    id: z.string().min(1),
    atMs: finiteMs,
    name: z.string(),
    phase: z.string().optional(),
    category: eventCategorySchema,
    cues: z.array(timelineCueSchema),
  })
  .strict();

export const timelineTrackSchema = z
  .object({
    id: z.string().min(1),
    type: trackTypeSchema,
    name: z.string(),
    enabledByDefault: z.boolean(),
    target: cueTargetSchema.optional(),
    events: z.array(timelineEventSchema),
  })
  .strict();

export const timelineMetaSchema = z
  .object({
    name: z.string().min(1, 'Timeline name is required'),
    encounterId: z.string().min(1, 'Encounter id is required'),
    strategy: z.string().optional(),
    author: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
  })
  .strict();

export const encounterSchema = z
  .object({
    durationMs: nonNegativeMs,
    countdownMs: nonNegativeMs,
  })
  .strict();

export const timelinePackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    meta: timelineMetaSchema,
    encounter: encounterSchema,
    tracks: z.array(timelineTrackSchema),
  })
  .strict();

export type TimelinePackageInput = z.input<typeof timelinePackageSchema>;

export interface SchemaParseSuccess {
  ok: true;
  timeline: TimelinePackage;
}

export interface SchemaParseFailure {
  ok: false;
  issues: SchemaIssue[];
}

export interface SchemaIssue {
  path: string;
  message: string;
}

export type SchemaParseResult = SchemaParseSuccess | SchemaParseFailure;

export function parseTimelinePackage(input: unknown): SchemaParseResult {
  const result = timelinePackageSchema.safeParse(input);
  if (result.success) {
    return { ok: true, timeline: result.data as TimelinePackage };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
