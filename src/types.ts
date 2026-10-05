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

// 执行对账（断网控台 GO 记录与计划核对）
export type ReconciliationStatus = 'pending' | 'duplicate-pending' | 'baseline-changed' | 'confirmed';

export interface GoRecordInput {
  recordId?: string;
  scene?: string;
  sceneOrder?: number;
  cue?: string;
  cueNumber?: string;
  firedAt?: number;
  timeOffset?: number;
  brightness?: number;
  fadeIn?: number;
  hold?: number;
  fadeOut?: number;
  channel?: string;
  position?: string;
  colorHex?: string;
  note?: string;
  source?: string;
}

export interface ExecutionRecord {
  id: string;
  sceneId: string;
  cueNumber: string;
  firedAt: number;
  brightness?: number;
  fadeIn?: number;
  hold?: number;
  fadeOut?: number;
  channel?: string;
  position?: string;
  colorHex?: string;
  note: string;
  source: string;
  importedAt: string;
  fingerprint: string;
}

export interface PlanSnapshot {
  capturedAt: string;
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
  followCueNumber: string;
  targetNote: string;
  orderIndex: number;
  startTime: number;
  duration: number;
  endTime: number;
}

export interface ReconciliationEntry {
  id: string;
  planId: string;
  sceneId: string;
  cueNumber: string;
  status: ReconciliationStatus;
  records: ExecutionRecord[];
  baselineSignature: string;
  baseline: PlanSnapshot;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
  confirmedRecordId?: string;
  planSnapshot?: PlanSnapshot;
  history: Array<{
    confirmedAt: string;
    confirmedBy: string;
    recordId: string;
    source: string;
    firedAt: number;
    snapshot: PlanSnapshot;
  }>;
}

export interface PlanReconciliation {
  planId: string;
  entries: ReconciliationEntry[];
}

export interface ReconciliationState {
  plans: Record<string, PlanReconciliation>;
}

export interface Workspace {
  plans: LightingPlan[];
  activePlanId: string;
  comparePlanId: string;
  selectedSceneId: string;
  selectedCueId: string;
  role: UserRole;
  reconciliation: ReconciliationState;
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
