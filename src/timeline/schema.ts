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
