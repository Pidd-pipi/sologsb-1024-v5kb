import type {
  Cue,
  ExecutionRecord,
  GoRecordInput,
  LightingPlan,
  PlanSnapshot,
  ReconciliationEntry,
  ReconciliationState,
  ReconciliationStatus,
  Scene,
  UserRole,
  Workspace
} from './types';

/* ---------------------------------- 工具 ---------------------------------- */

/** djb2 稳定短哈希：用于记录指纹与编号派生键，保证重复导入可判定。 */
export function hash32(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) | 0;
  }
  return `h${(hash >>> 0).toString(36)}`;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

/** 按稳定编号配对：场次 + 提示编号（计划内稳定键，与内部 id 无关）。 */
export function entryKey(planId: string, sceneId: string, cueNumber: string): string {
  return `${planId}::${sceneId}::${cueNumber.trim()}`;
}

/**
 * 记录指纹：同一 GO 记录再次导入时判定为“只合并一次”的依据。
 * 仅基于记录自身内容（场次、编号、GO 时刻、参数、备注），与导入批次标题无关，
 * 保证同一条控台记录无论分几次带回都只合并一次。
 */
export function recordFingerprint(record: GoRecordInput): string {
  const time = record.firedAt ?? record.timeOffset ?? 0;
  const canonical = [
    String(record.scene ?? '').trim(),
    String(record.sceneOrder ?? '').trim(),
    String(record.cue ?? record.cueNumber ?? '').trim(),
    round(Number(time) || 0),
    record.brightness ?? '',
    record.fadeIn ?? '',
    record.hold ?? '',
    record.fadeOut ?? '',
    String(record.channel ?? '').trim(),
    String(record.position ?? '').trim(),
    String(record.colorHex ?? '').trim(),
    String(record.note ?? '').trim()
  ].join('|');
  return hash32(canonical);
}

function recordIdFor(record: GoRecordInput, fingerprint: string): string {
  const raw = String(record.recordId ?? '').trim();
  return raw ? `go-${hash32(raw)}` : `go-${fingerprint}`;
}

/**
 * 提示基线签名：编号、顺序或渐变时长一旦变化，签名立即不同，
 * 未确认对账记录随即失效（baseline-changed）并等待重算确认。
 */
export function cueSignature(cue: Cue, orderIndex: number): string {
  return hash32([cue.number.trim(), orderIndex, round(cue.fadeIn), round(cue.fadeOut)].join('|'));
}

function followCueNumber(cue: Cue, scene: Scene): string {
  if (!cue.followCueId) return '';
  return scene.cues.find((item) => item.id === cue.followCueId)?.number ?? '';
}

export function snapshotCue(cue: Cue, scene: Scene, orderIndex: number, capturedAt: string): PlanSnapshot {
  return {
    capturedAt,
    number: cue.number,
    label: cue.label,
    position: cue.position,
    channel: cue.channel,
    color: cue.color,
    colorHex: cue.colorHex,
    brightness: cue.brightness,
    fadeIn: cue.fadeIn,
    hold: cue.hold,
    fadeOut: cue.fadeOut,
    followCueNumber: followCueNumber(cue, scene),
    targetNote: cue.targetNote,
    orderIndex,
    startTime: round(cue.startTime ?? 0),
    duration: round(cue.duration ?? 0),
    endTime: round(cue.endTime ?? 0)
  };
}

/* --------------------------------- 数据访问 -------------------------------- */

export function ensureReconciliation(state: ReconciliationState | undefined): ReconciliationState {
  return state && state.plans ? state : { plans: {} };
}

export function getPlanEntries(workspace: Workspace, planId: string): ReconciliationEntry[] {
  return workspace.reconciliation.plans[planId]?.entries ?? [];
}

export function findEntry(
  workspace: Workspace,
  planId: string,
  sceneId: string,
  cueNumber: string
): ReconciliationEntry | undefined {
  const id = entryKey(planId, sceneId, cueNumber);
  return getPlanEntries(workspace, planId).find((entry) => entry.id === id);
}

function locateCue(plan: LightingPlan, record: GoRecordInput): { scene?: Scene; cue?: Cue } {
  const wantedNumber = String(record.cue ?? record.cueNumber ?? '').trim();
  const wantedScene = String(record.scene ?? '').trim();
  const wantedOrder = typeof record.sceneOrder === 'number' ? record.sceneOrder : undefined;
  for (const scene of [...plan.scenes].sort((a, b) => a.order - b.order)) {
    const sceneNameHit = wantedScene && scene.name.trim() === wantedScene;
    const orderHit = wantedOrder !== undefined && scene.order === wantedOrder;
    if (!wantedScene && wantedOrder === undefined) {
      const cue = scene.cues.find((item) => item.number.trim() === wantedNumber);
      if (cue) return { scene, cue };
      continue;
    }
    if (sceneNameHit || orderHit) {
      const cue = scene.cues.find((item) => item.number.trim() === wantedNumber);
      if (cue) return { scene, cue };
    }
  }
  return {};
}

/* -------------------------------- 差异计算 -------------------------------- */

export interface FieldDiff {
  key: string;
  label: string;
  actual: string;
  expected: string;
}

export interface ReconciliationDiff {
  timeDelta: number;
  timeFields: FieldDiff[];
  paramFields: FieldDiff[];
  changed: boolean;
}

export function formatSignedTime(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${round(value)}s`;
}

function formatSigned(value: number): string {
  return formatSignedTime(value);
}

function compareParam(
  diffs: FieldDiff[],
  label: string,
  actual: unknown,
  expected: unknown,
  format: (value: unknown) => string
) {
  if (actual === undefined || actual === null || actual === '') return;
  const actualText = format(actual);
  const expectedText = format(expected);
  if (actualText !== expectedText) {
    diffs.push({ key: label, label, actual: actualText, expected: expectedText });
  }
}

export function diffRecord(record: ExecutionRecord, baseline: PlanSnapshot, plannedStart: number): ReconciliationDiff {
  const timeDelta = round(record.firedAt - plannedStart);
  const timeFields: FieldDiff[] = [];
  if (Math.abs(timeDelta) >= 0.05) {
    timeFields.push({
      key: 'GO 时间',
      label: 'GO 时间',
      actual: formatSigned(timeDelta),
      expected: '与计划一致 (0.0s)'
    });
  }

  const paramFields: FieldDiff[] = [];
  compareParam(paramFields, '亮度', record.brightness, baseline.brightness, (value) => `${value}%`);
  compareParam(paramFields, '渐入', record.fadeIn, baseline.fadeIn, (value) => `${value}s`);
  compareParam(paramFields, '保持', record.hold, baseline.hold, (value) => `${value}s`);
  compareParam(paramFields, '渐出', record.fadeOut, baseline.fadeOut, (value) => `${value}s`);
  compareParam(paramFields, '通道', record.channel, baseline.channel, String);
  compareParam(paramFields, '灯位', record.position, baseline.position, String);
  compareParam(paramFields, '色值', record.colorHex, baseline.colorHex, String);

  return {
    timeDelta,
    timeFields,
    paramFields,
    changed: timeFields.length > 0 || paramFields.length > 0
  };
}

export interface ResolvedEntry {
  entry: ReconciliationEntry;
  scene?: Scene;
  cue?: Cue;
  orderIndex: number;
  signature: string;
  liveBaseline?: PlanSnapshot;
  diffs: Array<ReconciliationDiff & { record: ExecutionRecord }>;
}

/** 解析一条对账记录在当前计划下的提示、签名与差异（确认记录以快照为基线）。 */
export function resolveEntry(
  entry: ReconciliationEntry,
  plan: LightingPlan,
  nowIso: string
): ResolvedEntry {
  const scene = plan.scenes.find((item) => item.id === entry.sceneId);
  const cue = scene?.cues.find((item) => item.number.trim() === entry.cueNumber.trim());
  const orderIndex = cue && scene ? scene.cues.indexOf(cue) : -1;
  const signature = cue && orderIndex >= 0 ? cueSignature(cue, orderIndex) : '';
  const liveBaseline = cue && scene && orderIndex >= 0 ? snapshotCue(cue, scene, orderIndex, nowIso) : undefined;
  const plannedStart = entry.status === 'confirmed'
    ? entry.planSnapshot?.startTime ?? entry.baseline.startTime
    : liveBaseline?.startTime ?? entry.baseline.startTime;
  const baseline = entry.status === 'confirmed'
    ? entry.planSnapshot ?? entry.baseline
    : liveBaseline ?? entry.baseline;
  const diffs = entry.records.map((record) => ({ record, ...diffRecord(record, baseline, plannedStart) }));
  return { entry, scene, cue, orderIndex, signature, liveBaseline, diffs };
}

/* ------------------------------ 导入合并（原子） ------------------------------ */

export interface MergeReport {
  merged: number;
  appended: number;
  duplicates: number;
  rejected: number;
  rejectedItems: Array<{ recordId: string; cue: string; reason: string }>;
  createdEntries: number;
}

export class ReconciliationError extends Error {}

/**
 * 解析断网控台导出的 GO 记录文件。
 * 支持顶层数组或 { source, records: [...] }。无法解析时抛出，调用方放弃整批写入。
 */
export function parseGoLog(raw: string): { records: GoRecordInput[]; source: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ReconciliationError('GO 记录不是有效的 JSON，已放弃导入：原方案与待处理清单保持不变。');
  }
  const container = parsed as { source?: unknown; records?: unknown };
  let list: unknown[];
  let source = '断网控台文件';
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray(container.records)) {
    list = container.records;
    if (typeof container.source === 'string' && container.source.trim()) source = container.source.trim();
  } else {
    throw new ReconciliationError('GO 记录缺少 records 列表，已放弃导入：原方案与待处理清单保持不变。');
  }

  const records = list
    .map((item) => item as GoRecordInput)
    .filter((item) => item && typeof item === 'object');
  if (!records.length) {
    throw new ReconciliationError('GO 记录文件中没有任何记录，已放弃导入：原方案与待处理清单保持不变。');
  }
  return { records, source };
}

function toExecutionRecord(
  input: GoRecordInput,
  scene: Scene,
  source: string,
  importedAt: string
): ExecutionRecord {
  const cueNumber = String(input.cue ?? input.cueNumber ?? '').trim();
  const fingerprint = recordFingerprint(input);
  const numberOrEmpty = (value: unknown) => (typeof value === 'number' ? value : undefined);
  const textOrEmpty = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  return {
    id: recordIdFor(input, fingerprint),
    sceneId: scene.id,
    cueNumber,
    firedAt: round(Number(input.firedAt ?? input.timeOffset ?? 0) || 0),
    brightness: numberOrEmpty(input.brightness),
    fadeIn: numberOrEmpty(input.fadeIn),
    hold: numberOrEmpty(input.hold),
    fadeOut: numberOrEmpty(input.fadeOut),
    channel: textOrEmpty(input.channel),
    position: textOrEmpty(input.position),
    colorHex: textOrEmpty(input.colorHex),
    note: typeof input.note === 'string' ? input.note : '',
    source: typeof input.source === 'string' && input.source.trim() ? input.source.trim() : source,
    importedAt,
    fingerprint
  };
}

function deriveStatus(entry: ReconciliationEntry, liveSignature: string): ReconciliationStatus {
  const distinct = new Set(entry.records.map((record) => record.fingerprint)).size;
  if (distinct > 1) return 'duplicate-pending';
  return liveSignature && entry.baselineSignature !== liveSignature ? 'baseline-changed' : 'pending';
}

/**
 * 把一批 GO 记录合并进执行对账。
 * 纯函数：先在克隆上运行，任何致命错误抛出后调用方的原方案与待处理清单不变。
 * - 按稳定编号（场次 + 提示编号）配对
 * - 同指纹记录全局只合并一次（重复导入 / 批次内重复均跳过）
 * - 同一提示出现两份不同记录：并列保留为“待确认冲突”，等待舞台监督确认
 * - 冻结场次拒绝写入
 */
export function mergeGoLog(
  workspace: Workspace,
  planId: string,
  inputs: GoRecordInput[],
  source: string,
  importedAt: string
): MergeReport {
  const plan = workspace.plans.find((item) => item.id === planId);
  if (!plan) throw new ReconciliationError('当前方案不存在，无法合并 GO 记录。');

  const reconciliation = ensureReconciliation(workspace.reconciliation);
  if (!reconciliation.plans[planId]) reconciliation.plans[planId] = { planId, entries: [] };
  const planState = reconciliation.plans[planId];
  workspace.reconciliation = reconciliation;

  const report: MergeReport = {
    merged: 0,
    appended: 0,
    duplicates: 0,
    rejected: 0,
    rejectedItems: [],
    createdEntries: 0
  };
  const batchFingerprints = new Set<string>();

  for (const input of inputs) {
    const wantedNumber = String(input.cue ?? input.cueNumber ?? '').trim();
    if (!wantedNumber) {
      report.rejected += 1;
      report.rejectedItems.push({ recordId: String(input.recordId ?? ''), cue: '（无编号）', reason: '缺少提示编号' });
      continue;
    }
    const { scene, cue } = locateCue(plan, input);
    if (!scene || !cue) {
      report.rejected += 1;
      report.rejectedItems.push({ recordId: String(input.recordId ?? ''), cue: wantedNumber, reason: '在该方案中找不到对应场次/提示，未写入' });
      continue;
    }
    if (scene.frozen) {
      report.rejected += 1;
      report.rejectedItems.push({ recordId: String(input.recordId ?? ''), cue: wantedNumber, reason: `场次《${scene.name}》已冻结，禁止写入` });
      continue;
    }

    const fingerprint = recordFingerprint(input);
    if (batchFingerprints.has(fingerprint)) {
      report.duplicates += 1;
      continue;
    }
    batchFingerprints.add(fingerprint);

    const id = entryKey(planId, scene.id, wantedNumber);
    let entry = planState.entries.find((item) => item.id === id);
    if (entry) {
      if (entry.records.some((record) => record.fingerprint === fingerprint)) {
        report.duplicates += 1;
        continue;
      }
    } else {
      const orderIndex = scene.cues.indexOf(cue);
      entry = {
        id,
        planId,
        sceneId: scene.id,
        cueNumber: wantedNumber,
        status: 'pending',
        records: [],
        baselineSignature: cueSignature(cue, orderIndex),
        baseline: snapshotCue(cue, scene, orderIndex, importedAt),
        createdAt: importedAt,
        updatedAt: importedAt,
        history: []
      };
      planState.entries.push(entry);
      report.createdEntries += 1;
    }

    const record = toExecutionRecord(input, scene, source, importedAt);
    if (entry.records.some((existing) => existing.id === record.id)) {
      report.duplicates += 1;
      continue;
    }

    entry.records.push(record);
    report.merged += 1;
    const distinctCount = new Set(entry.records.map((item) => item.fingerprint)).size;
    if (entry.records.length > 1 && distinctCount > 1) {
      report.appended += 1;
    }
    entry.updatedAt = importedAt;
    if (entry.status === 'confirmed') {
      // 已确认提示又补入不同 GO 记录：保留确认快照与历史，同时把新记录重新送入待确认队列。
      entry.status = 'duplicate-pending';
    } else {
      const orderIndex = scene.cues.indexOf(cue);
      entry.status = deriveStatus(entry, cueSignature(cue, orderIndex));
    }
  }

  if (!report.merged && !report.createdEntries && report.duplicates === 0) {
    throw new ReconciliationError(
      `GO 记录全部被拒绝（${report.rejectedItems.map((item) => `${item.cue}：${item.reason}`).join('；')}），原方案与待处理清单保持不变。`
    );
  }
  return report;
}

/* ------------------------------ 确认 / 废弃 / 重算 ------------------------------ */

function guardEntry(
  workspace: Workspace,
  planId: string,
  entryId: string
): { entry: ReconciliationEntry; plan: LightingPlan; scene?: Scene; cue?: Cue; orderIndex: number } {
  const plan = workspace.plans.find((item) => item.id === planId);
  if (!plan) throw new ReconciliationError('当前方案不存在。');
  const entry = getPlanEntries(workspace, planId).find((item) => item.id === entryId);
  if (!entry) throw new ReconciliationError('对账记录不存在。');
  const scene = plan.scenes.find((item) => item.id === entry.sceneId);
  const cue = scene?.cues.find((item) => item.number.trim() === entry.cueNumber.trim());
  return { entry, plan, scene, cue, orderIndex: cue && scene ? scene.cues.indexOf(cue) : -1 };
}

/** 舞台监督确认一份 GO 记录：锁定当时的计划快照；确认前后均不改动全剧时间。 */
export function confirmEntry(
  workspace: Workspace,
  planId: string,
  entryId: string,
  recordId: string,
  role: UserRole,
  actor: string,
  nowIso: string
): void {
  if (role !== 'stage-manager') {
    throw new ReconciliationError('只有舞台监督可以确认 GO 对账记录。');
  }
  const { entry, scene, cue, orderIndex } = guardEntry(workspace, planId, entryId);
  if (entry.status === 'confirmed') throw new ReconciliationError('该提示已确认；历史确认保留在快照中。');
  if (entry.status === 'baseline-changed') {
    throw new ReconciliationError('提示编号、顺序或渐变时长已变化，记录已失效，请先按新计划重算再确认。');
  }
  if (!scene || !cue || orderIndex < 0) throw new ReconciliationError('计划中已找不到该提示，无法确认。');
  if (scene.frozen) throw new ReconciliationError(`场次《${scene.name}》已冻结，不能写入确认。`);
  const record = entry.records.find((item) => item.id === recordId);
  if (!record) throw new ReconciliationError('待确认的 GO 记录不存在。');

  const snapshot = snapshotCue(cue, scene, orderIndex, nowIso);
  entry.planSnapshot = snapshot;
  entry.confirmedAt = nowIso;
  entry.confirmedBy = actor;
  entry.confirmedRecordId = recordId;
  entry.status = 'confirmed';
  entry.updatedAt = nowIso;
  entry.history.push({
    confirmedAt: nowIso,
    confirmedBy: actor,
    recordId,
    source: record.source,
    firedAt: record.firedAt,
    snapshot
  });
}

/** 舞台监督废弃未确认记录（已确认记录的快照必须保留，不可删除）。 */
export function discardEntry(workspace: Workspace, planId: string, entryId: string, role: UserRole): void {
  if (role !== 'stage-manager') {
    throw new ReconciliationError('只有舞台监督可以废弃对账记录。');
  }
  const plan = workspace.plans.find((item) => item.id === planId);
  const reconciliation = ensureReconciliation(workspace.reconciliation);
  const planState = reconciliation.plans[planId];
  if (!plan || !planState) throw new ReconciliationError('对账记录不存在。');
  const index = planState.entries.findIndex((item) => item.id === entryId);
  if (index < 0) throw new ReconciliationError('对账记录不存在。');
  const entry = planState.entries[index];
  if (entry.status === 'confirmed') throw new ReconciliationError('已确认记录的计划快照必须保留，不能删除。');
  const scene = plan.scenes.find((item) => item.id === entry.sceneId);
  if (scene?.frozen) throw new ReconciliationError(`场次《${scene.name}》已冻结，不能写入。`);
  planState.entries.splice(index, 1);
}

/** 编号/顺序/渐变变化导致失效后，按当前计划重新建立基线（编程执行只能补记录，不能重算）。 */
export function recalibrateEntry(
  workspace: Workspace,
  planId: string,
  entryId: string,
  role: UserRole,
  nowIso: string
): void {
  if (role !== 'designer' && role !== 'stage-manager') {
    throw new ReconciliationError('编程执行只能补充 GO 记录，重算需由灯光设计或舞台监督处理。');
  }
  const { entry, plan, scene, cue, orderIndex } = guardEntry(workspace, planId, entryId);
  if (entry.status === 'confirmed') throw new ReconciliationError('已确认记录保留当时的计划快照，无需重算。');
  if (!scene || !cue || orderIndex < 0) throw new ReconciliationError('计划中已找不到该提示，无法重算。');
  if (scene.frozen) throw new ReconciliationError(`场次《${scene.name}》已冻结，不能写入。`);
  const signature = cueSignature(cue, orderIndex);
  entry.baselineSignature = signature;
  entry.baseline = snapshotCue(cue, scene, orderIndex, nowIso);
  entry.cueNumber = cue.number;
  entry.status = deriveStatus(entry, signature);
  entry.updatedAt = nowIso;
}

/**
 * 计划每次变更后同步对账状态：
 * - 未确认记录：编号/顺序/渐变签名一变立即失效（baseline-changed），重新编号后按新编号挂接
 * - 已确认记录：保持其当时计划快照，不再受后续改动影响
 */
export function syncReconciliation(workspace: Workspace, _nowIso: string): void {
  const reconciliation = ensureReconciliation(workspace.reconciliation);
  for (const plan of workspace.plans) {
    const planState = reconciliation.plans[plan.id];
    if (!planState) continue;
    for (const entry of planState.entries) {
      if (entry.status === 'confirmed') continue;
      const scene = plan.scenes.find((item) => item.id === entry.sceneId);
      const cue = scene?.cues.find((item) => item.number.trim() === entry.cueNumber.trim());
      if (!scene || !cue) {
        entry.status = 'baseline-changed';
        continue;
      }
      const orderIndex = scene.cues.indexOf(cue);
      const signature = cueSignature(cue, orderIndex);
      if (signature !== entry.baselineSignature) {
        entry.status = 'baseline-changed';
      } else {
        entry.status = deriveStatus(entry, signature);
      }
    }
  }
  // 清理已经不存在的方案对应的对账数据
  const validPlanIds = new Set(workspace.plans.map((plan) => plan.id));
  for (const key of Object.keys(reconciliation.plans)) {
    if (!validPlanIds.has(key)) delete reconciliation.plans[key];
  }
  workspace.reconciliation = reconciliation;
}

/* --------------------------------- 示例数据 --------------------------------- */

/** 构造示例 GO 批次（用当前计划时间派生，确保时间差异有真实参照）。 */
export function buildSampleBatch(
  plan: LightingPlan,
  variant: 'first-show' | 'second-show'
): { records: GoRecordInput[]; source: string } {
  const sceneByName = (name: string) => plan.scenes.find((scene) => scene.name === name);
  const cueAt = (sceneName: string, number: string) => {
    const scene = sceneByName(sceneName);
    const cue = scene?.cues.find((item) => item.number === number);
    if (!scene || !cue) throw new Error(`示例数据缺少 ${sceneName} ${number}`);
    return { scene, cue };
  };

  const note = (text: string) => (variant === 'second-show' ? text : text);

  if (variant === 'first-show') {
    const q2 = cueAt('序章 · 入梦', 'Q2');
    const q3 = cueAt('序章 · 入梦', 'Q3');
    const q4 = cueAt('序章 · 入梦', 'Q4');
    const q10 = cueAt('独白 · 失语', 'Q10');
    const q12 = cueAt('独白 · 失语', 'Q12');
    const q20 = cueAt('群舞 · 潮汐', 'Q20');
    const q22 = cueAt('群舞 · 潮汐', 'Q22');
    const q23 = cueAt('群舞 · 潮汐', 'Q23');
    return {
      source: '断网控台 · 首场 GO 记录',
      records: [
        { scene: q2.scene.name, cue: 'Q2', firedAt: (q2.cue.startTime ?? 0) - 3, note: note('月幕提前升起，演员抢拍 3 秒') },
        { scene: q3.scene.name, cue: 'Q3', firedAt: q3.cue.startTime ?? 0, note: note('按点 GO') },
        { scene: q4.scene.name, cue: 'Q4', firedAt: (q4.cue.startTime ?? 0) + 1.5, brightness: 64, note: note('雾门临场提亮到 64%') },
        { scene: q10.scene.name, cue: 'Q10', firedAt: (q10.cue.startTime ?? 0) + 2, fadeIn: 9, fadeOut: 12, note: note('渐入渐出临时放慢') },
        { scene: q12.scene.name, cue: 'Q12', firedAt: q12.cue.startTime ?? 0, note: note('正常执行') },
        { scene: q20.scene.name, cue: 'Q20', firedAt: (q20.cue.startTime ?? 0) - 1.5, note: note('群舞起光提前一拍') },
        { scene: q22.scene.name, cue: 'Q22', firedAt: q22.cue.startTime ?? 0, brightness: 100, fadeIn: 0.5, note: note('爆闪加至满亮') },
        { scene: q23.scene.name, cue: 'Q23', firedAt: (q23.cue.startTime ?? 0) + 4, note: note('尾奏 GO 延后') },
        { scene: q23.scene.name, cue: 'Q99', firedAt: 999, note: note('控台临时插入，计划中无此编号') },
        { scene: '终场 · 归岸', cue: 'Q30', firedAt: 0, note: note('冻结场次的 GO，应被拒绝') }
      ]
    };
  }

  const q2 = cueAt('序章 · 入梦', 'Q2');
  const q3 = cueAt('序章 · 入梦', 'Q3');
  const q11 = cueAt('独白 · 失语', 'Q11');
  const q21 = cueAt('群舞 · 潮汐', 'Q21');
  return {
    source: '断网控台 · 次场 GO 记录',
    records: [
      { scene: q2.scene.name, cue: 'Q2', firedAt: (q2.cue.startTime ?? 0) - 6, note: note('次场月幕提前 6 秒，与首场记录不同') },
      { scene: q3.scene.name, cue: 'Q3', firedAt: q3.cue.startTime ?? 0, note: note('按点 GO') },
      { scene: q11.scene.name, cue: 'Q11', firedAt: (q11.cue.startTime ?? 0) + 2.5, brightness: 78, note: note('呼吸点临场提亮') },
      { scene: q21.scene.name, cue: 'Q21', firedAt: (q21.cue.startTime ?? 0) - 1, note: note('潮线提前') }
    ]
  };
}

/* --------------------------------- 导出 --------------------------------- */

export function buildReconciliationExport(workspace: Workspace, planId: string, exportedAt: string) {
  const plan = workspace.plans.find((item) => item.id === planId);
  const nowIso = exportedAt;
  const entries = getPlanEntries(workspace, planId).map((entry) => {
    const resolved = plan ? resolveEntry(entry, plan, nowIso) : undefined;
    return {
      id: entry.id,
      sceneId: entry.sceneId,
      cueNumber: entry.cueNumber,
      status: entry.status,
      statusLabel: statusLabel(entry.status),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      confirmedAt: entry.confirmedAt,
      confirmedBy: entry.confirmedBy,
      confirmedRecordId: entry.confirmedRecordId,
      records: entry.records,
      planSnapshot: entry.planSnapshot ?? null,
      baselineAtImport: entry.baseline,
      diffs:
        resolved?.diffs.map((item) => ({
          recordId: item.record.id,
          source: item.record.source,
          firedAt: item.record.firedAt,
          timeDelta: item.timeDelta,
          timeFields: item.timeFields,
          paramFields: item.paramFields,
          changed: item.changed
        })) ?? [],
      invalidReason:
        entry.status === 'baseline-changed'
          ? '提示编号、顺序或渐变时长已变化，未确认记录已失效，等待按新计划重算'
          : entry.status === 'duplicate-pending'
            ? '同一提示存在两份不同 GO 记录，并列保留，等待舞台监督确认'
            : null,
      history: entry.history
    };
  });
  return {
    exportedAt,
    planId,
    entries,
    summary: {
      total: entries.length,
      pending: entries.filter((entry) => entry.status === 'pending').length,
      duplicatePending: entries.filter((entry) => entry.status === 'duplicate-pending').length,
      baselineChanged: entries.filter((entry) => entry.status === 'baseline-changed').length,
      confirmed: entries.filter((entry) => entry.status === 'confirmed').length
    }
  };
}

export function statusLabel(status: ReconciliationStatus): string {
  return {
    pending: '待确认',
    'duplicate-pending': '待确认冲突',
    'baseline-changed': '已失效待重算',
    confirmed: '已确认'
  }[status];
}
