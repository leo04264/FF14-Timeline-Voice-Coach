import type { VisibilityState } from '../audio/AudioBackend';
import type { DebugRecordStatus } from '../debug/types';
import type { EngineState } from '../engine/TimelineEngine';
import type { SaveStatus } from '../hooks/useEditorState';
import type {
  CuePriority,
  EventCategory,
  JobCode,
  JobRole,
  TimelineTrackType,
} from '../timeline/types';

/**
 * 介面顯示用的中文標籤。
 *
 * 網站介面一律使用繁體中文，只有站名保持原文。Party Position（MT/ST/H1…）
 * 維持團隊常用代號；Job Code 則只作為資料格式，介面顯示繁體中文職業名稱。
 */

export const ENGINE_STATE_LABEL: Record<EngineState, string> = {
  idle: '待機',
  countdown: '倒數中',
  running: '進行中',
  paused: '已暫停',
  completed: '已結束',
};

export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  mechanic: '機制',
  raidwide: '全體攻擊',
  tankbuster: '坦克死刑',
  tankswap: '換坦',
  mitigation: '減傷',
  heal: '補血',
  shield: '上盾',
  movement: '移動',
  job: '職業技能',
  custom: '自訂',
};

export const CUE_PRIORITY_LABEL: Record<CuePriority, string> = {
  low: '低',
  normal: '一般',
  high: '高',
};

export const TRACK_TYPE_LABEL: Record<TimelineTrackType, string> = {
  encounter: '戰鬥',
  role: '職責',
  job: '職業',
  party: '團隊',
  custom: '自訂',
};

export const JOB_ROLE_LABEL: Record<JobRole, string> = {
  tank: '坦克',
  healer: '補師',
  melee: '近戰',
  ranged: '遠程',
  caster: '魔法',
};

export const JOB_NAME_LABEL: Record<JobCode, string> = {
  PLD: '騎士',
  WAR: '戰士',
  DRK: '暗黑騎士',
  GNB: '絕槍戰士',
  WHM: '白魔法師',
  SCH: '學者',
  AST: '占星術士',
  SGE: '賢者',
  MNK: '武僧',
  DRG: '龍騎士',
  NIN: '忍者',
  SAM: '武士',
  RPR: '鐮刀師',
  VPR: '蝰蛇劍士',
  BRD: '吟遊詩人',
  MCH: '機工士',
  DNC: '舞者',
  BLM: '黑魔法師',
  SMN: '召喚師',
  RDM: '赤魔法師',
  PCT: '繪靈法師',
};

export const VISIBILITY_LABEL: Record<VisibilityState, string> = {
  visible: '前景',
  hidden: '背景',
};

export const DEBUG_STATUS_LABEL: Record<DebugRecordStatus, string> = {
  pending: '等待中',
  played: '已播放',
  skipped: '已略過',
  error: '錯誤',
};

export const SAVE_STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '待機',
  editing: '編輯中…',
  saving: '儲存中…',
  saved: '已儲存',
  failed: '儲存失敗',
};
