import assert from 'node:assert';
import { samplePlans, recalculatePlans } from '../src/data';
import {
  mergeGoRecords,
  selectPlanViews,
  parseGoLog,
  confirmEntry,
  recalculateEntry,
  emptyReconciliation
} from '../src/reconciliation';
import type { GoRecord, LightingPlan } from '../src/types';
import { sampleGoLogSuccess, sampleGoLogRejected } from '../src/goSamples';

const plans: LightingPlan[] = recalculatePlans(structuredClone(samplePlans));
const main = plans.find((p) => p.id === 'plan-main')!;
const scene1 = main.scenes.find((s) => s.id === 'scene-1')!;
const scene2 = main.scenes.find((s) => s.id === 'scene-2')!;
const frozenScene = main.scenes.find((s) => s.id === 'scene-4')!;
const q2 = scene1.cues.find((c) => c.number === 'Q2')!;

function record(partial: Partial<GoRecord>): GoRecord {
  return {
    id: 'R',
    planId: 'plan-main',
    sceneId: 'scene-1',
    cueNumber: 'Q2',
    firedAt: 10,
    source: 'test',
    firedBy: 'programmer',
    importedAt: new Date().toISOString(),
    batchId: 'b1',
    ...partial
  };
}

// 1. 解析示例文件
const parsed = parseGoLog(sampleGoLogSuccess, 'plan-main', 'scene-1');
assert.equal(parsed.errors.length, 0);
assert.equal(parsed.records.length, 4);

// 2. 合并成功示例：Q2 两份并列、Q3/Q11 各一条
let state = emptyReconciliation();
const r1 = mergeGoRecords(state, plans, parsed.records);
assert.ok(!('errors' in r1), '应成功合并');
if (!('state' in r1)) throw new Error('bad');
state = r1.state;
assert.equal(r1.report.imported, 4);
assert.equal(r1.report.merged, 4);
assert.equal(r1.report.conflicts, 1);
assert.equal(r1.report.created, 3, 'Q2 两份记录只建一个条目，共 3 个条目');
let views = selectPlanViews(state, plans, 'plan-main');
const q2entry = views.find((v) => v.cueNumber === 'Q2')!;
assert.equal(q2entry.records.length, 2, 'Q2 两份不同记录应并列');
assert.equal(q2entry.effective, 'pending');
const q2diff = q2entry.diffs.find((d) => d.recordId === 'GO-0401')!;
assert.ok(
  q2diff.fields.some((f) => f.key === 'firedAt' && f.deltaSeconds === Number((9.5 - q2.startTime!).toFixed(2))),
  'Q2 应显示临时提前的秒数'
);
assert.ok((q2diff.fields.find((f) => f.key === 'firedAt')?.deltaSeconds ?? 0) < 0);

// 3. 重复导入只合并一次（同 id 全部跳过）
const reparsed = parseGoLog(sampleGoLogSuccess, 'plan-main', 'scene-1');
const r2 = mergeGoRecords(state, plans, reparsed.records);
if (!('state' in r2)) throw new Error('bad');
assert.equal(r2.report.duplicated, 4);
assert.equal(r2.report.imported, 0);
state = r2.state;

// 3b. 内容完全一致但 id 不同：不并列，计重复
const q3start = scene1.cues.find((c) => c.number === 'Q3')!.startTime!;
const dupQ3 = record({ id: 'R-dup-q3', cueNumber: 'Q3', firedAt: q3start, brightness: 80 });
const r3 = mergeGoRecords(state, plans, [dupQ3]);
if (!('state' in r3)) throw new Error('bad');
assert.equal(r3.report.duplicated, 1);
assert.equal(r3.report.imported, 0);

// 4. 非舞台监督不能确认
const denied = confirmEntry(state, plans, q2entry.id, undefined, 'programmer');
assert.match(denied.error ?? '', /舞台监督/);
// 并列时未选择不能确认
const noPick = confirmEntry(state, plans, q2entry.id, undefined, 'stage-manager');
assert.match(noPick.error ?? '', /选定/);
// 选定 GO-0401 后确认
const confirmed = confirmEntry(state, plans, q2entry.id, 'GO-0401', 'stage-manager');
assert.ok(!confirmed.error, confirmed.error);
state = confirmed.state;
const confirmedView = selectPlanViews(state, plans, 'plan-main').find((v) => v.cueNumber === 'Q2')!;
assert.equal(confirmedView.status, 'confirmed');
assert.equal(confirmedView.snapshot?.fadeIn, q2.fadeIn);
assert.equal(confirmedView.chosenRecordId, 'GO-0401');

// 5. 确认不改计划时间
const q2StartTimeAfter = scene1.cues.find((c) => c.number === 'Q2')!.startTime;
assert.equal(q2StartTimeAfter, q2.startTime, '确认前后全剧时间不变');

// 6. 已确认条目再来记录：计重复，不改确认
const afterConfirmed = mergeGoRecords(state, plans, [record({ id: 'R-after', firedAt: 1, note: 'late' })]);
if (!('state' in afterConfirmed)) throw new Error('bad');
assert.equal(afterConfirmed.report.duplicated, 1);
state = afterConfirmed.state;

// 7. Q3 未确认：改渐入 -> 立即失效；确认的 Q2 不受影响
const q3 = scene1.cues.find((c) => c.number === 'Q3')!;
q3.fadeIn = 6;
recalculatePlans(plans);
views = selectPlanViews(state, plans, 'plan-main');
const q3view = views.find((v) => v.cueNumber === 'Q3')!;
assert.equal(q3view.effective, 'stale');
assert.match(q3view.staleReason ?? '', /渐变时长/);
assert.equal(views.find((v) => v.cueNumber === 'Q2')!.effective, 'confirmed');
// 失效时不能确认
const staleConfirm = confirmEntry(state, plans, q3view.id, undefined, 'stage-manager');
assert.match(staleConfirm.error ?? '', /失效/);
// 重算后恢复待确认
const recalc = recalculateEntry(state, plans, q3view.id);
assert.ok(!recalc.error);
state = recalc.state;
assert.equal(selectPlanViews(state, plans, 'plan-main').find((v) => v.cueNumber === 'Q3')!.effective, 'pending');

// 8. 编号变化导致失效
const q11entry = selectPlanViews(state, plans, 'plan-main').find((v) => v.cueNumber === 'Q11')!;
scene2.cues.find((c) => c.number === 'Q11')!.number = 'Q11A';
assert.equal(selectPlanViews(state, plans, 'plan-main').find((v) => v.cueNumber === 'Q11')!.effective, 'stale');
scene2.cues.find((c) => c.number === 'Q11A')!.number = 'Q11';
// 顺序变化导致失效（交换 Q3/Q4）
var sc1 = main.scenes.find((s) => s.id === 'scene-1')!;
const i3 = sc1.cues.findIndex((c) => c.number === 'Q3');
[sc1.cues[i3], sc1.cues[i3 + 1]] = [sc1.cues[i3 + 1], sc1.cues[i3]];
const viewsReorder = selectPlanViews(state, plans, 'plan-main');
assert.equal(viewsReorder.find((v) => v.cueNumber === 'Q3')!.effective, 'stale');
// 恢复顺序
[sc1.cues[i3], sc1.cues[i3 + 1]] = [sc1.cues[i3 + 1], sc1.cues[i3]];
assert.equal(selectPlanViews(state, plans, 'plan-main').find((v) => v.cueNumber === 'Q3')!.effective, 'pending');

// 9. 冻结场次不能写入 -> 整体拒绝、原状态不动
const frozenRec = record({ id: 'R-frozen', sceneId: 'scene-4', cueNumber: 'Q30' });
const before = JSON.stringify(state);
const rejected = mergeGoRecords(state, plans, [frozenRec]);
assert.ok('errors' in rejected);
if (!('errors' in rejected)) throw new Error('bad');
assert.ok(rejected.errors[0].includes('冻结'));
assert.equal(JSON.stringify(state), before, '被拒后待处理清单与方案不变');

// 10. 混合批次：一条冻结 + 一条合法 => 整体回滚，合法的也不写入
const mixed = mergeGoRecords(state, plans, [
  frozenRec,
  record({ id: 'R-valid-mixed', cueNumber: 'Q3', firedAt: 99 })
]);
assert.ok('errors' in mixed);
assert.equal(state.records.some((r) => r.id === 'R-valid-mixed'), false);

// 11. 示例拒绝文件：冻结 + 找不到编号 + 缺编号
const parsedBad = parseGoLog(sampleGoLogRejected, 'plan-main', 'scene-1');
assert.ok(parsedBad.errors.length >= 1, '缺编号行解析报错');
const badMerge = mergeGoRecords(state, plans, parsedBad.records);
assert.ok('errors' in badMerge);
assert.equal(JSON.stringify(state), before);

// 12. 找不到提示/场次也拒绝
assert.ok('errors' in mergeGoRecords(state, plans, [record({ id: 'R-x', cueNumber: 'QX' })]));
assert.ok('errors' in mergeGoRecords(state, plans, [record({ id: 'R-y', sceneId: 'nope' })]));

// 13. 快照可独立用于差异对比（确认后计划变化）
const snap = confirmedView.snapshot!;
assert.equal(snap.fadeIn, 8);
// 模拟修改计划 Q2 fadeIn
scene1.cues.find((c) => c.number === 'Q2')!.fadeIn = 20;
const stillConfirmed = selectPlanViews(state, plans, 'plan-main').find((v) => v.cueNumber === 'Q2')!;
assert.equal(stillConfirmed.status, 'confirmed');
assert.equal(stillConfirmed.snapshot?.fadeIn, 8, '快照保留当时计划');
assert.equal(stillConfirmed.effective, 'confirmed');

console.log('全部对账逻辑断言通过 ✔');
