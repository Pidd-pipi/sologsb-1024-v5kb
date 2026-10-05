import type {
  Cue,
  FieldDiff,
  GoRecord,
  ImportReport,
  LightingPlan,
  PlanSnapshot,
  ReconciliationEntry,
  ReconciliationState,
  ReconciliationView,
  Scene,
  UserRole
} from './types';

/** 提示的“稳定指纹”：编号、顺序、渐变时长一变，未确认记录立即失效 */
export function cueSignature(cue: Cue, orderIndex: number) {
  return [cue.number.trim(), orderIndex, cue.fadeIn, cue.fadeOut].join('|');
}

/** 已确认快照对应的稳定指纹，用于提示确认后计划是否漂移 */
export function snapshotSignature(snapshot: PlanSnapshot) {
  return [snapshot.cueNumber.trim(), snapshot.orderIndex, snapshot.fadeIn, snapshot.fadeOut].join('|');
}

export function recordSignature(record: GoRecord) {
  return [
    record.planId,
    record.sceneId,
    record.cueNumber.trim(),
    record.firedAt,
    record.fadeIn ?? '',
    record.hold ?? '',
    record.fadeOut ?? '',
    record.brightness ?? '',
    record.colorHex ?? ''
  ].join('|');
}

export function findPlanSceneCue(plans: LightingPlan[], planId: string, sceneId: string, cueNumber: string) {
  const plan = plans.find((item) => item.id === planId);
  const scene = plan?.scenes.find((item) => item.id === sceneId);
  const cue = scene?.cues.find((item) => item.number.trim() === cueNumber.trim());
  return { plan, scene, cue };
}

function round(value: number | undefined) {
  return typeof value === 'number' ? Number(value.toFixed(2)) : undefined;
}

export function captureSnapshot(cue: Cue, scene: Scene, orderIndex: number): PlanSnapshot {
  return {
    cueNumber: cue.number,
    label: cue.label,
    channel: cue.channel,
    position: cue.position,
    brightness: cue.brightness,
    colorHex: cue.colorHex,
    fadeIn: cue.fadeIn,
    hold: cue.hold,
    fadeOut: cue.fadeOut,
    orderIndex,
    startTime: cue.startTime,
    duration: cue.duration,
    endTime: cue.endTime,
    frozen: scene.frozen,
    capturedAt: new Date().toISOString()
  };
}

/** 用一条 GO 记录对比计划（或确认时快照），列出字段差异 */
export function diffRecord(record: GoRecord, cue: Cue | undefined, snapshot?: PlanSnapshot): FieldDiff[] {
  const plannedStart = snapshot?.startTime ?? cue?.startTime;
  const fields: FieldDiff[] = [];

  if (cue || snapshot) {
    if (typeof plannedStart === 'number' && Math.abs(record.firedAt - plannedStart) > 0.05) {
      fields.push({
        key: 'firedAt',
        label: 'GO 时间',
        planned: round(plannedStart),
        actual: round(record.firedAt),
        deltaSeconds: round(record.firedAt - plannedStart)
      });
    }
  } else {
    fields.push({ key: 'firedAt', label: 'GO 时间', actual: round(record.firedAt) });
  }

  const compare = (
    key: FieldDiff['key'],
    label: string,
    actual: number | string | undefined,
    planned: number | string | undefined
  ) => {
    if (actual === undefined || actual === '') return;
    if (planned === undefined || planned === '') {
      fields.push({ key, label, actual });
      return;
    }
    if (typeof actual === 'number' && typeof planned === 'number') {
      if (Math.abs(actual - planned) > 0.05) fields.push({ key, label, planned, actual: round(actual) });
    } else if (String(actual).toUpperCase() !== String(planned).toUpperCase()) {
      fields.push({ key, label, planned, actual });
    }
  };

  compare('fadeIn', '渐入', record.fadeIn, snapshot?.fadeIn ?? cue?.fadeIn);
  compare('hold', '保持', record.hold, snapshot?.hold ?? cue?.hold);
  compare('fadeOut', '渐出', record.fadeOut, snapshot?.fadeOut ?? cue?.fadeOut);
  compare('brightness', '亮度', record.brightness, snapshot?.brightness ?? cue?.brightness);
  compare('colorHex', '色值', record.colorHex, snapshot?.colorHex ?? cue?.colorHex);

  return fields;
}

export interface ParseResult {
  records: GoRecord[];
  errors: string[];
}

/**
 * 解析控台带回的 GO 记录文件。
 * 支持：数组 或 { records: [...] }；缺少批次/来源时补默认值。
 */
export function parseGoLog(raw: string, fallbackPlanId: string, fallbackSceneId: string): ParseResult {
  const errors: string[] = [];
  const records: GoRecord[] = [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { records, errors: ['文件不是合法 JSON'] };
  }
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { records?: unknown[] })?.records)
      ? (data as { records: unknown[] }).records
      : null;
  if (!list) return { records, errors: ['文件结构应为 GO 记录数组或含 records 字段的对象'] };

  const batchId = `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const seen = new Set<string>();

  list.forEach((item, index) => {
    const row = (item ?? {}) as Partial<GoRecord>;
    const where = `第 ${index + 1} 条`;
    const id = String(row.id ?? `${batchId}-${index}`).trim();
    const cueNumber = String(row.cueNumber ?? '').trim();
    const firedAt = Number(row.firedAt);
    if (!cueNumber) {
      errors.push(`${where}：缺少提示编号`);
      return;
    }
    if (!Number.isFinite(firedAt) || firedAt < 0) {
      errors.push(`${where}（${cueNumber}）：GO 时间缺失或不是非负秒数`);
      return;
    }
    if (seen.has(id)) {
      errors.push(`${where}：文件内记录编号 ${id} 重复`);
      return;
    }
    seen.add(id);
    records.push({
      id,
      planId: String(row.planId ?? fallbackPlanId).trim() || fallbackPlanId,
      sceneId: String(row.sceneId ?? fallbackSceneId).trim() || fallbackSceneId,
      cueNumber,
      firedAt: round(firedAt) ?? 0,
      fadeIn: typeof row.fadeIn === 'number' ? row.fadeIn : undefined,
      hold: typeof row.hold === 'number' ? row.hold : undefined,
      fadeOut: typeof row.fadeOut === 'number' ? row.fadeOut : undefined,
      brightness: typeof row.brightness === 'number' ? row.brightness : undefined,
      colorHex: row.colorHex ? String(row.colorHex) : undefined,
      source: String(row.source ?? '断网控台 GO 记录'),
      firedBy: row.firedBy === 'programmer' || row.firedBy === 'stage-manager' ? row.firedBy : 'unknown',
      note: row.note ? String(row.note) : undefined,
      importedAt: now,
      batchId
    });
  });

  return { records, errors };
}

/**
 * 合并导入：全程在草稿上操作，任何一条被拒即整体放弃，恢复原方案与待处理清单。
 * - 按记录稳定编号去重，重复导入只合并一次
 * - 同一提示出现两份不同记录时并列保留，等待舞台监督确认
 * - 冻结场次不能写入
 * - 已确认条目的提示再来记录：不改动确认，记为重复
 */
export function mergeGoRecords(current: ReconciliationState, plans: LightingPlan[], incoming: GoRecord[]): {
  state: ReconciliationState;
  report: Omit<ImportReport, 'restored'>;
} | { errors: string[] } {
  const draft: ReconciliationState = {
    records: current.records.map((item) => ({ ...item })),
    entries: current.entries.map((item) => ({ ...item, recordIds: [...item.recordIds] }))
  };

  const errors: string[] = [];
  const knownIds = new Set(draft.records.map((item) => item.id));

  // 1) 预校验：找不到计划/场次/提示、冻结场次、跨场次重号，一律整体拒绝
  for (const record of incoming) {
    if (knownIds.has(record.id)) continue;
    const { plan, scene, cue } = findPlanSceneCue(plans, record.planId, record.sceneId, record.cueNumber);
    if (!plan) {
      errors.push(`记录 ${record.id}（${record.cueNumber}）找不到方案`);
      continue;
    }
    if (!scene) {
      errors.push(`记录 ${record.id}（${record.cueNumber}）找不到场次`);
      continue;
    }
    if (scene.frozen) {
      errors.push(`记录 ${record.id}（${record.cueNumber}）属于冻结场次「${scene.name}」，不能写入`);
      continue;
    }
    if (!cue) {
      errors.push(`记录 ${record.id}（${record.cueNumber}）在场次「${scene.name}」中找不到对应提示编号`);
    }
  }
  if (errors.length) return { errors };

  const report = {
    batchId: incoming[0]?.batchId ?? '',
    imported: 0,
    duplicated: 0,
    merged: 0,
    created: 0,
    conflicts: 0,
    rejected: [] as string[]
  };

  for (const record of incoming) {
    if (knownIds.has(record.id)) {
      report.duplicated += 1;
      continue;
    }

    const { scene, cue } = findPlanSceneCue(plans, record.planId, record.sceneId, record.cueNumber);
    if (!scene || !cue) continue; // 预校验已拦截

    let entry = draft.entries.find(
      (item) => item.planId === record.planId && item.sceneId === record.sceneId && item.cueNumber === record.cueNumber
    );

    if (entry?.status === 'confirmed') {
      // 已确认记录保持当时快照；同编号新记录不覆盖，计为重复
      report.duplicated += 1;
      continue;
    }

    draft.records.push(record);
    knownIds.add(record.id);
    report.imported += 1;

    if (!entry) {
      entry = {
        id: `recon-${record.planId}-${record.sceneId}-${record.cueNumber}-${draft.entries.length + 1}`,
        planId: record.planId,
        sceneId: record.sceneId,
        cueNumber: record.cueNumber,
        recordIds: [],
        status: 'pending'
      };
      draft.entries.push(entry);
      report.created += 1;
    }

    const orderIndex = scene.cues.findIndex((item) => item.number === record.cueNumber);
    const signature = cueSignature(cue, orderIndex);
    const signatureExisting = entry.recordIds
      .map((rid) => draft.records.find((r) => r.id === rid))
      .filter((r): r is GoRecord => Boolean(r))
      .map(recordSignature);

    if (!entry.recordIds.length) {
      entry.recordIds.push(record.id);
      entry.baselineSignature = signature;
      report.merged += 1;
      continue;
    }

    if (signatureExisting.includes(recordSignature(record))) {
      // 内容完全一致：重复导入只合并一次（不并列）
      report.duplicated += 1;
      draft.records.pop();
      knownIds.delete(record.id);
      report.imported -= 1;
      continue;
    }

    // 同一提示出现不同记录：并列保留并等待确认
    entry.recordIds.push(record.id);
    entry.chosenRecordId = undefined;
    entry.baselineSignature = signature;
    entry.status = 'pending';
    report.merged += 1;
    report.conflicts += 1;
  }

  return { state: draft, report };
}

/** 把对账条目投影成运行态视图：实时判定失效、计算差异 */
export function selectEntryView(
  entry: ReconciliationEntry,
  reconciliation: ReconciliationState,
  plans: LightingPlan[]
): ReconciliationView {
  const { scene, cue } = findPlanSceneCue(plans, entry.planId, entry.sceneId, entry.cueNumber);
  const records = entry.recordIds
    .map((id) => reconciliation.records.find((record) => record.id === id))
    .filter((record): record is GoRecord => Boolean(record));

  let effective: ReconciliationView['effective'] = entry.status;
  let staleReason: string | undefined;

  if (entry.status === 'pending') {
    if (!scene) {
      effective = 'stale';
      staleReason = '场次已不存在，待重算';
    } else if (!cue) {
      effective = 'stale';
      staleReason = `场次中找不到编号 ${entry.cueNumber}，待重算`;
    } else {
      const orderIndex = scene.cues.findIndex((item) => item.number === entry.cueNumber);
      const signature = cueSignature(cue, orderIndex);
      if (entry.baselineSignature && signature !== entry.baselineSignature) {
        effective = 'stale';
        staleReason = '编号、顺序或渐变时长已变，未确认记录失效，待重算';
      }
    }
  }

  const diffs = records.map((record) => ({
    recordId: record.id,
    fields: diffRecord(record, entry.status === 'confirmed' ? undefined : cue, entry.snapshot)
  }));

  return {
    ...entry,
    recordIds: [...entry.recordIds],
    effective,
    staleReason,
    cueExists: Boolean(cue),
    sceneExists: Boolean(scene),
    sceneFrozen: scene?.frozen ?? false,
    records,
    diffs
  };
}

export function selectPlanViews(reconciliation: ReconciliationState, plans: LightingPlan[], planId: string) {
  return reconciliation.entries
    .filter((entry) => entry.planId === planId)
    .map((entry) => selectEntryView(entry, reconciliation, plans))
    .sort((a, b) => {
      const sceneOrder = (sceneId: string) =>
        plans.find((plan) => plan.id === planId)?.scenes.find((scene) => scene.id === sceneId)?.order ?? 999;
      const sceneDiff = sceneOrder(a.sceneId) - sceneOrder(b.sceneId);
      if (sceneDiff) return sceneDiff;
      return a.cueNumber.localeCompare(b.cueNumber, 'zh-CN', { numeric: true });
    });
}

/** 舞台监督确认：确认前不改全剧时间，只锁定快照 */
export function confirmEntry(
  current: ReconciliationState,
  plans: LightingPlan[],
  entryId: string,
  chosenRecordId: string | undefined,
  role: UserRole
): { state: ReconciliationState; error?: string } {
  if (role !== 'stage-manager') {
    return { state: current, error: '只有舞台监督可以确认执行记录' };
  }
  const entry = current.entries.find((item) => item.id === entryId);
  if (!entry) return { state: current, error: '待确认记录不存在' };
  if (entry.status === 'confirmed') return { state: current, error: '该提示已确认' };
  const { scene, cue } = findPlanSceneCue(plans, entry.planId, entry.sceneId, entry.cueNumber);
  if (scene?.frozen) return { state: current, error: '冻结场次不能写入确认' };
  if (!cue || !scene) return { state: current, error: '计划提示已不存在，无法确认' };

  const view = selectEntryView(entry, current, plans);
  if (view.effective === 'stale') return { state: current, error: '记录已失效，请先重算后再确认' };

  const chosen = entry.recordIds.length === 1 ? entry.recordIds[0] : chosenRecordId;
  if (!chosen || !entry.recordIds.includes(chosen)) {
    return { state: current, error: '存在并列记录，请先选定一条再确认' };
  }

  const orderIndex = scene.cues.findIndex((item) => item.number === entry.cueNumber);
  const next: ReconciliationState = {
    records: current.records.map((item) => ({ ...item })),
    entries: current.entries.map((item) =>
      item.id === entryId
        ? {
            ...item,
            recordIds: [...item.recordIds],
            status: 'confirmed' as const,
            chosenRecordId: chosen,
            snapshot: captureSnapshot(cue, scene, orderIndex),
            confirmedAt: new Date().toISOString(),
            confirmedByRole: role
          }
        : { ...item, recordIds: [...item.recordIds] }
    )
  };
  return { state: next };
}

/** 失效记录重算：以当前计划重建基线，差异即时刷新；未确认才可重算 */
export function recalculateEntry(
  current: ReconciliationState,
  plans: LightingPlan[],
  entryId: string
): { state: ReconciliationState; error?: string } {
  const entry = current.entries.find((item) => item.id === entryId);
  if (!entry) return { state: current, error: '记录不存在' };
  if (entry.status === 'confirmed') return { state: current, error: '已确认记录保留当时快照，不参与重算' };
  const { scene, cue } = findPlanSceneCue(plans, entry.planId, entry.sceneId, entry.cueNumber);
  if (!scene || !cue) return { state: current, error: '提示仍未在计划中恢复，无法重算' };

  const orderIndex = scene.cues.findIndex((item) => item.number === entry.cueNumber);
  return {
    state: {
      records: current.records,
      entries: current.entries.map((item) =>
        item.id === entryId ? { ...item, baselineSignature: cueSignature(cue, orderIndex) } : item
      )
    }
  };
}

/** 丢弃失效/未确认条目（仅清条目，保留已导入原始记录以便追溯） */
export function discardEntry(current: ReconciliationState, entryId: string, role: UserRole): ReconciliationState {
  if (role !== 'stage-manager' && role !== 'designer') return current;
  const entry = current.entries.find((item) => item.id === entryId);
  if (!entry || entry.status === 'confirmed') return current;
  return { ...current, entries: current.entries.filter((item) => item.id !== entryId) };
}

export function emptyReconciliation(): ReconciliationState {
  return { records: [], entries: [] };
}
