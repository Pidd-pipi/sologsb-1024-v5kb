export type CueStatus = 'draft' | 'ready' | 'confirmed';
export type UserRole = 'designer' | 'programmer' | 'stage-manager' | 'readonly';
export type ConflictSeverity = 'error' | 'warning';

export interface Cue {
  id: string;
  number: string;
  label: string;
  position: string;
  channel: string;
  color: string;
  colorHex: string;
  brightness: number;
  fadeIn: number;
  hold: number;
  fadeOut: number;
  followCueId: string;
  targetNote: string;
  notes: string;
  status: CueStatus;
  startTime?: number;
  duration?: number;
  endTime?: number;
}

export interface Scene {
  id: string;
  name: string;
  order: number;
  frozen: boolean;
  startTime?: number;
  duration?: number;
  cues: Cue[];
}

export interface LightingPlan {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  scenes: Scene[];
}

export interface CueConflict {
  id: string;
  planId: string;
  cueId: string;
  sceneId: string;
  severity: ConflictSeverity;
  type: 'channel-overlap' | 'follow-order' | 'missing-data' | 'duplicate-position' | 'duration';
  message: string;
}

// ── 执行对账：断网控台带回的 GO 记录 ──────────────────────────────

export type GoFiredBy = 'programmer' | 'stage-manager' | 'unknown';

export interface GoRecord {
  /** 控台导出的稳定编号（同一文件内唯一，去重依据） */
  id: string;
  /** 方案稳定编号 */
  planId: string;
  /** 场次稳定编号 */
  sceneId: string;
  /** 提示稳定编号，按它与计划配对 */
  cueNumber: string;
  /** 实际 GO 时间（相对开演的秒） */
  firedAt: number;
  /** 实际渐入秒数 */
  fadeIn?: number;
  /** 实际保持秒数 */
  hold?: number;
  /** 实际渐出秒数 */
  fadeOut?: number;
  /** 实际亮度 */
  brightness?: number;
  /** 实际色值 */
  colorHex?: string;
  source: string;
  firedBy: GoFiredBy;
  note?: string;
  importedAt: string;
  batchId: string;
}

/** 单字段差异 */
export interface FieldDiff {
  key: 'firedAt' | 'fadeIn' | 'hold' | 'fadeOut' | 'brightness' | 'colorHex';
  label: string;
  planned?: string | number;
  actual?: string | number;
  /** 秒数差，实际减计划（提前为负） */
  deltaSeconds?: number;
}

/** 确认时保留的“当时计划快照”，之后不受重算影响 */
export interface PlanSnapshot {
  cueNumber: string;
  label: string;
  channel: string;
  position: string;
  brightness: number;
  colorHex: string;
  fadeIn: number;
  hold: number;
  fadeOut: number;
  orderIndex: number;
  startTime?: number;
  duration?: number;
  endTime?: number;
  frozen: boolean;
  capturedAt: string;
}

export type ReconcileStatus = 'pending' | 'confirmed' | 'stale';

export interface ReconciliationEntry {
  id: string;
  planId: string;
  sceneId: string;
  cueNumber: string;
  /** 同一提示出现多份不同记录时并列保留，全部等待舞台监督确认 */
  recordIds: string[];
  /** 多份并列时被选中的那一条 */
  chosenRecordId?: string;
  status: Exclude<ReconcileStatus, 'stale'>;
  /** 导入/重算时的提示签名（编号 + 顺序 + 渐入/渐出），用于判定未确认记录是否失效 */
  baselineSignature?: string;
  /** 确认时的计划快照；未确认为空，确认后计划再变也保留 */
  snapshot?: PlanSnapshot;
  confirmedAt?: string;
  confirmedByRole?: UserRole;
  note?: string;
}

/** 运行态视图（由选择器根据当前计划实时推导，不持久化） */
export interface ReconciliationView extends ReconciliationEntry {
  /** pending 记录在编号/顺序/渐变时长变化后立即失效，等待重算 */
  effective: ReconcileStatus;
  staleReason?: string;
  cueExists: boolean;
  sceneExists: boolean;
  sceneFrozen: boolean;
  records: GoRecord[];
  /** 每条并列记录各自对当前（或快照）计划的差异 */
  diffs: { recordId: string; fields: FieldDiff[] }[];
}

export interface ReconciliationState {
  records: GoRecord[];
  entries: ReconciliationEntry[];
}

export interface ImportReport {
  batchId: string;
  imported: number;
  duplicated: number;
  merged: number;
  created: number;
  conflicts: number;
  rejected: string[];
  restored: boolean;
}

export interface Workspace {
  plans: LightingPlan[];
  activePlanId: string;
  comparePlanId: string;
  selectedSceneId: string;
  selectedCueId: string;
  role: UserRole;
  reconciliation: ReconciliationState;
  lastImportReport?: ImportReport;
}

export interface EditorState {
  workspace: Workspace;
  past: Workspace[];
  future: Workspace[];
  lastAction: string;
}

export interface PersistedState {
  workspace: Workspace;
}
