/**
 * 舞台监督从断网控台带回的 GO 记录示例。
 * 示例一可成功合并（含临时提前、参数改动、同提示两份不同记录）；
 * 示例二包含冻结场次、缺失编号、找不到提示，触发整体拒绝与恢复。
 */

export const sampleGoLogSuccess = JSON.stringify(
  {
    exportedAt: '2026-10-04T22:31:00.000Z',
    console: '断网控台 A（主台）',
    records: [
      {
        id: 'GO-0401',
        planId: 'plan-main',
        sceneId: 'scene-1',
        cueNumber: 'Q2',
        firedAt: 9.5,
        fadeIn: 8,
        source: '断网控台 A · 主 GO 键',
        firedBy: 'programmer',
        note: '月幕指令被临时提前，抢拍 GO'
      },
      {
        id: 'GO-0402',
        planId: 'plan-main',
        sceneId: 'scene-1',
        cueNumber: 'Q2',
        firedAt: 11.0,
        fadeIn: 8,
        source: '断网控台 A · 舞台监督备份键',
        firedBy: 'stage-manager',
        note: '备份台记录的另一拍点，与主台不一致'
      },
      {
        id: 'GO-0403',
        planId: 'plan-main',
        sceneId: 'scene-1',
        cueNumber: 'Q3',
        firedAt: 45,
        brightness: 80,
        source: '断网控台 A · 主 GO 键',
        firedBy: 'programmer',
        note: '人物面光临场加亮至 80%'
      },
      {
        id: 'GO-0404',
        planId: 'plan-main',
        sceneId: 'scene-2',
        cueNumber: 'Q11',
        firedAt: 161.5,
        hold: 12,
        source: '断网控台 A · 主 GO 键',
        firedBy: 'programmer',
        note: '“我听见”停顿延长保持'
      }
    ]
  },
  null,
  2
);

export const sampleGoLogRejected = JSON.stringify(
  [
    {
      id: 'GO-0901',
      planId: 'plan-main',
      sceneId: 'scene-4',
      cueNumber: 'Q30',
      firedAt: 0.2,
      source: '断网控台 B',
      note: '终场已冻结，这条应被拒绝'
    },
    { id: 'GO-0902', planId: 'plan-main', sceneId: 'scene-2', cueNumber: 'Q99', firedAt: 12 },
    { id: 'GO-0903', planId: 'plan-main', sceneId: 'scene-1', firedAt: 30, note: '缺少提示编号' }
  ],
  null,
  2
);
