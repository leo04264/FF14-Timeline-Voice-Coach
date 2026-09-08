import { z } from 'zod';
import {
  CUE_PRIORITIES,
  EVENT_CATEGORIES,
  JOB_CODES,
  PARTY_POSITIONS,
  TIMELINE_TRACK_TYPES,
  TRACK_PURPOSES,
  type TimelinePackage,
  type TimelinePackageV1,
} from './types';

/**
 * Structural validation (spec §72/§73). This layer only checks shape and value
 * ranges — cross-entity rules (duplicate ids, event beyond duration, ...) live
 * in validator.ts.
 */

/** Zod 內建訊息也要用繁體中文顯示（介面語言一致）。 */
const zhErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return issue.received === 'undefined'
        ? { message: '缺少必填欄位' }
        : { message: `型別錯誤：應該是 ${issue.expected}，實際是 ${issue.received}` };
    case z.ZodIssueCode.invalid_literal:
      return { message: '值不符合規定的固定值' };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `不支援的值：${String(issue.received)}` };
    case z.ZodIssueCode.unrecognized_keys:
      return { message: `有不認得的欄位：${issue.keys.join('、')}` };
    case z.ZodIssueCode.too_small:
      return { message: `數值或長度太小（最小 ${String(issue.minimum)}）` };
    case z.ZodIssueCode.too_big:
      return { message: `數值或長度太大（最大 ${String(issue.maximum)}）` };
    default:
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(zhErrorMap);

const finiteMs = z
  .number({ invalid_type_error: '時間必須是毫秒數值' })
  .finite('時間必須是有限數值（NaN / Infinity 不合法）');

const nonNegativeMs = finiteMs.min(0, '必須大於等於 0');

const enumFrom = <T extends string>(values: readonly T[], label: string) =>
  z.enum(values as unknown as [T, ...T[]], {
    errorMap: () => ({ message: `不支援的${label}` }),
  });

export const partyPositionSchema = enumFrom(PARTY_POSITIONS, '站位');
export const jobCodeSchema = enumFrom(JOB_CODES, '職業代號');
export const eventCategorySchema = enumFrom(EVENT_CATEGORIES, '事件分類');
export const cuePrioritySchema = enumFrom(CUE_PRIORITIES, '提示優先度');
export const trackTypeSchema = enumFrom(TIMELINE_TRACK_TYPES, '軌道類型');

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

export const trackPurposeSchema = enumFrom(TRACK_PURPOSES, '軌道用途');

/**
 * V2 event timing (spec §3.1). A discriminated union so an event can never
 * carry both an absolute time and a live reference.
 */
export const eventTimingSchema = z.discriminatedUnion(
  'kind',
  [
    z.object({ kind: z.literal('absolute'), atMs: finiteMs }).strict(),
    z
      .object({
        kind: z.literal('mechanic'),
        sourceTrackId: z.string().min(1, '來源軌道 ID 是必填的'),
        sourceEventId: z.string().min(1, '來源事件 ID 是必填的'),
      })
      .strict(),
  ],
  { errorMap: () => ({ message: 'timing 必須是 absolute 或 mechanic' }) },
);

export const timelineEventSchema = z
  .object({
    id: z.string().min(1),
    timing: eventTimingSchema,
    name: z.string(),
    phase: z.string().optional(),
    category: eventCategorySchema,
    cues: z.array(timelineCueSchema),
  })
  .strict();

export const trackSelectionRefSchema = z
  .object({
    groupId: z.string().min(1, '方案群組 ID 是必填的'),
    optionId: z.string().min(1, '方案選項 ID 是必填的'),
  })
  .strict();

export const timelineTrackSchema = z
  .object({
    id: z.string().min(1),
    type: trackTypeSchema,
    name: z.string(),
    enabledByDefault: z.boolean(),
    target: cueTargetSchema.optional(),
    selection: trackSelectionRefSchema.optional(),
    purpose: trackPurposeSchema.optional(),
    events: z.array(timelineEventSchema),
  })
  .strict();

export const selectionGroupSchema = z
  .object({
    id: z.string().min(1, '方案群組 ID 是必填的'),
    name: z.string(),
    options: z.array(
      z
        .object({ id: z.string().min(1, '方案選項 ID 是必填的'), name: z.string() })
        .strict(),
    ),
  })
  .strict();

export const timelineMetaSchema = z
  .object({
    name: z.string().min(1, '時間軸名稱是必填的'),
    encounterId: z.string().min(1, '副本代號是必填的'),
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
    schemaVersion: z.literal(2),
    id: z.string().min(1),
    meta: timelineMetaSchema,
    encounter: encounterSchema,
    selectionGroups: z.array(selectionGroupSchema).optional(),
    tracks: z.array(timelineTrackSchema),
  })
  .strict();

export type TimelinePackageInput = z.input<typeof timelinePackageSchema>;

// ---------------------------------------------------------------- V1 (legacy)

/**
 * Schema V1, kept verbatim so old documents are structurally validated *before*
 * migration runs (spec §3.3.1). Nothing but migration should use these.
 */
export const timelineEventV1Schema = z
  .object({
    id: z.string().min(1),
    atMs: finiteMs,
    name: z.string(),
    phase: z.string().optional(),
    category: eventCategorySchema,
    cues: z.array(timelineCueSchema),
  })
  .strict();

export const timelineTrackV1Schema = z
  .object({
    id: z.string().min(1),
    type: trackTypeSchema,
    name: z.string(),
    enabledByDefault: z.boolean(),
    target: cueTargetSchema.optional(),
    events: z.array(timelineEventV1Schema),
  })
  .strict();

export const timelinePackageV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    meta: timelineMetaSchema,
    encounter: encounterSchema,
    tracks: z.array(timelineTrackV1Schema),
  })
  .strict();

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

function toIssues(error: z.ZodError): SchemaIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/** Structural parse of a **V2** document. */
export function parseTimelinePackage(input: unknown): SchemaParseResult {
  const result = timelinePackageSchema.safeParse(input);
  if (result.success) {
    return { ok: true, timeline: result.data as TimelinePackage };
  }
  return { ok: false, issues: toIssues(result.error) };
}

export type SchemaParseV1Result =
  | { ok: true; timeline: TimelinePackageV1 }
  | { ok: false; issues: SchemaIssue[] };

/** Structural parse of a **V1** document, used as migration input. */
export function parseTimelinePackageV1(input: unknown): SchemaParseV1Result {
  const result = timelinePackageV1Schema.safeParse(input);
  if (result.success) {
    return { ok: true, timeline: result.data as TimelinePackageV1 };
  }
  return { ok: false, issues: toIssues(result.error) };
}
