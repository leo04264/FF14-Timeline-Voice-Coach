import type { VisibilityState } from '../audio/AudioBackend';
import type { DebugRecordStatus } from '../debug/types';
import type { EngineState } from '../engine/TimelineEngine';
import type { SaveStatus } from '../hooks/useEditorState';
import type {
  CuePriority,
  EventCategory,
  JobRole,
  TimelineTrackType,
} from '../timeline/types';

/**
 * 介面顯示用的中文標籤。
 *
 * 網站介面一律使用繁體中文，只有站名保持原文。Party Position（MT/ST/H1…）與
 * Job Code（PLD/WAR…）是 FF14 通用代號，維持原樣不翻譯。
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
