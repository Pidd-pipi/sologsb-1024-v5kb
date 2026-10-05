import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Heading,
  Spacer,
  Tag,
  Text,
  Tooltip,
  VStack
} from '@chakra-ui/react';
import {
  CheckCircle2,
  ClipboardList,
  FileUp,
  GitCompareArrows,
  History,
  Lock,
  Radio,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { useRef } from 'react';
import { formatSignedTime, statusLabel } from './reconciliation';
import type {
  ReconciliationEntry,
  ReconciliationStatus,
  UserRole,
  Workspace
} from './types';
import { formatTime, findActivePlan } from './state/useLightingDesk';

export const reconciliationStatusColors: Record<ReconciliationStatus, string> = {
  pending: 'blue',
  'duplicate-pending': 'orange',
  'baseline-changed': 'red',
  confirmed: 'green'
};

export function ReconciliationBadge({ status, size = 'sm' }: { status: ReconciliationStatus; size?: 'sm' | 'md' }) {
  return (
    <Tag size={size} colorScheme={reconciliationStatusColors[status]} variant={status === 'confirmed' ? 'solid' : 'subtle'}>
      {statusLabel(status)}
    </Tag>
  );
}

function DiffChips({
  timeDelta,
  timeFields,
  paramFields
}: {
  timeDelta: number;
  timeFields: Array<{ label: string; actual: string; expected: string }>;
  paramFields: Array<{ label: string; actual: string; expected: string }>;
}) {
  return (
    <Flex wrap="wrap" gap={1} mt={1}>
      {timeFields.length ? (
        <Tag size="sm" colorScheme={timeDelta < 0 ? 'orange' : 'purple'} variant="subtle">
          GO {formatSignedTime(timeDelta)}
        </Tag>
      ) : (
        <Tag size="sm" colorScheme="green" variant="subtle">GO 准点</Tag>
      )}
      {paramFields.map((field) => (
        <Tooltip key={field.label} label={`${field.label}：计划 ${field.expected} → 执行 ${field.actual}`}>
          <Tag size="sm" colorScheme="red" variant="subtle">
            {field.label} {field.expected}→{field.actual}
          </Tag>
        </Tooltip>
      ))}
    </Flex>
  );
}

export interface EntryCardProps {
  resolved: ResolvedEntryView;
  role: UserRole;
  onSelectCue?: () => void;
  onConfirm: (entryId: string, recordId: string) => void;
  onDiscard: (entryId: string) => void;
  onRecalibrate: (entryId: string) => void;
}

export interface ResolvedEntryView {
  entry: ReconciliationEntry;
  cueMissing: boolean;
  frozen: boolean;
  sceneName: string;
  cueLabel: string;
  diffs: Array<{
    recordId: string;
    source: string;
    firedAt: number;
    note: string;
    importedAt: string;
    timeDelta: number;
    timeFields: Array<{ label: string; actual: string; expected: string }>;
    paramFields: Array<{ label: string; actual: string; expected: string }>;
    changed: boolean;
    chosen: boolean;
    appendedAfterConfirm: boolean;
  }>;
  plannedStart: number;
  confirmedRecordId?: string;
}

export function EntryCard({ resolved, role, onSelectCue, onConfirm, onDiscard, onRecalibrate }: EntryCardProps) {
  const { entry } = resolved;
  const isStageManager = role === 'stage-manager';
  const canRecalibrate = role === 'designer' || role === 'stage-manager';
  const invalid = entry.status === 'baseline-changed';
  const duplicate = entry.status === 'duplicate-pending';

  return (
    <Box
      p={3}
      borderRadius="lg"
      borderWidth="1px"
      borderColor={
        invalid ? 'red.600' : duplicate ? 'orange.500' : entry.status === 'confirmed' ? 'green.700' : 'whiteAlpha.200'
      }
      bg="blackAlpha.300"
    >
      <Flex align="center" gap={2} wrap="wrap">
        <Text fontFamily="mono" fontWeight="800" color="amber.300">{entry.cueNumber}</Text>
        <Text fontSize="sm" fontWeight="650" noOfLines={1}>{resolved.cueLabel || '计划中找不到该提示'}</Text>
        <Text color="whiteAlpha.500" fontSize="10px">{resolved.sceneName}</Text>
        <Spacer />
        <ReconciliationBadge status={entry.status} />
      </Flex>

      {invalid ? (
        <Alert status="error" mt={2} py={2} borderRadius="md">
          <AlertIcon />
          <AlertDescription fontSize="xs">
            {resolved.cueMissing
              ? '计划中已找不到该编号提示；未确认记录已失效，重编号或恢复顺序后可按新计划重算。'
              : '提示编号、顺序或渐变时长已变化，未确认记录立即失效并等待重算；确认前不会改动全剧时间。'}
          </AlertDescription>
        </Alert>
      ) : null}
      {duplicate ? (
        <Alert status="warning" mt={2} py={2} borderRadius="md">
          <AlertIcon />
          <AlertDescription fontSize="xs">
            同一提示出现 {entry.records.length} 份不同 GO 记录，已并列保留；请舞台监督核对后选择一份确认。
          </AlertDescription>
        </Alert>
      ) : null}
      {entry.status === 'confirmed' && resolved.diffs.some((item) => item.appendedAfterConfirm) ? (
        <Alert status="info" mt={2} py={2} borderRadius="md">
          <AlertIcon />
          <AlertDescription fontSize="xs">
            确认后又有新 GO 记录补入，已确认快照保持不变，新记录并列等待舞台监督再次确认。
          </AlertDescription>
        </Alert>
      ) : null}
      {entry.status !== 'confirmed' && entry.planSnapshot ? (
        <Alert status="info" mt={2} py={2} borderRadius="md">
          <AlertIcon />
          <AlertDescription fontSize="xs">
            确认之后又补入了不同的 GO 记录，已重新进入待确认；上次确认的计划快照与历史继续保留，再次确认会叠加新快照而不改动全剧时间。
          </AlertDescription>
        </Alert>
      ) : null}

      <VStack align="stretch" spacing={2} mt={2}>
        {resolved.diffs.map((item) => (
          <Box
            key={item.recordId}
            p={2}
            borderRadius="md"
            bg={item.chosen ? 'green.900' : 'whiteAlpha.50'}
            borderWidth="1px"
            borderColor={item.chosen ? 'green.600' : 'whiteAlpha.100'}
          >
            <Flex align="center" gap={2} wrap="wrap">
              <Radio size={13} color={item.chosen ? '#9ae6b4' : '#a0aec0'} />
              <Text fontFamily="mono" fontSize="xs">
                GO {formatTime(item.firedAt)}（计划 {formatTime(resolved.plannedStart)}）
              </Text>
              {item.chosen ? <Tag size="sm" colorScheme="green">确认采用</Tag> : null}
              {item.appendedAfterConfirm ? <Tag size="sm" colorScheme="blue">确认后补记</Tag> : null}
              <Spacer />
              <Text color="whiteAlpha.500" fontSize="10px">{item.source} · 导入 {new Date(item.importedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</Text>
            </Flex>
            {item.note ? <Text mt={1} fontSize="xs" color="whiteAlpha.700">备注：{item.note}</Text> : null}
            <DiffChips timeDelta={item.timeDelta} timeFields={item.timeFields} paramFields={item.paramFields} />
            <Flex mt={2} gap={2} wrap="wrap">
              {entry.status !== 'confirmed' ? (
                <Tooltip
                  label={
                    !isStageManager
                      ? '只有舞台监督负责确认'
                      : invalid
                        ? '记录已失效，需先按新计划重算'
                        : resolved.frozen
                          ? '冻结场次不能写入'
                          : '确认该 GO 记录并锁定当时计划快照'
                  }
                >
                  <Button
                    size="xs"
                    colorScheme="green"
                    leftIcon={<CheckCircle2 size={13} />}
                    isDisabled={!isStageManager || invalid || resolved.frozen}
                    onClick={() => onConfirm(entry.id, item.recordId)}
                  >
                    确认此记录
                  </Button>
                </Tooltip>
              ) : null}
            </Flex>
          </Box>
        ))}
      </VStack>

      {entry.planSnapshot ? (
        <Box mt={2} p={2} borderRadius="md" bg={entry.status === 'confirmed' ? 'green.900' : 'blue.900'} borderWidth="1px" borderColor={entry.status === 'confirmed' ? 'green.700' : 'blue.700'}>
          <Flex align="center" gap={2}>
            <History size={13} color={entry.status === 'confirmed' ? '#9ae6b4' : '#90cdf4'} />
            <Text fontSize="xs" color={entry.status === 'confirmed' ? 'green.200' : 'blue.200'}>
              {entry.status === 'confirmed' ? '计划快照' : '上次确认的计划快照（继续保留）'} · {entry.confirmedAt ? new Date(entry.confirmedAt).toLocaleString('zh-CN') : ''} 由 {entry.confirmedBy} 确认
            </Text>
          </Flex>
          <Text mt={1} fontSize="11px" color="whiteAlpha.600">
            快照参数：顺序 {entry.planSnapshot.orderIndex + 1} · 开始 {formatTime(entry.planSnapshot.startTime)} ·
            {' '}亮度 {entry.planSnapshot.brightness}% · 渐入 {entry.planSnapshot.fadeIn}s · 保持 {entry.planSnapshot.hold}s · 渐出 {entry.planSnapshot.fadeOut}s
          </Text>
          {entry.history.length > 1 ? (
            <Text mt={1} fontSize="10px" color="whiteAlpha.500">历史确认共 {entry.history.length} 次，均保留各自快照。</Text>
          ) : null}
        </Box>
      ) : null}

      <Flex mt={2} gap={2} wrap="wrap">
        {entry.status !== 'confirmed' ? (
          <>
            <Tooltip label={!canRecalibrate ? '编程执行只能补记录，重算需灯光设计/舞台监督' : '按当前编号、顺序与渐变时长重新建立基线'}>
              <Button
                size="xs"
                variant="outline"
                leftIcon={<RotateCcw size={13} />}
                isDisabled={!canRecalibrate || !invalid || resolved.frozen}
                onClick={() => onRecalibrate(entry.id)}
              >
                按新计划重算
              </Button>
            </Tooltip>
            <Tooltip label={!isStageManager ? '只有舞台监督可以废弃' : resolved.frozen ? '冻结场次不能写入' : '废弃整组未确认记录（已确认快照不可删除）'}>
              <Button
                size="xs"
                variant="ghost"
                colorScheme="red"
                leftIcon={<Trash2 size={13} />}
                isDisabled={!isStageManager || resolved.frozen}
                onClick={() => onDiscard(entry.id)}
              >
                废弃
              </Button>
            </Tooltip>
          </>
        ) : null}
        {onSelectCue && !resolved.cueMissing ? (
          <Button size="xs" variant="ghost" ml="auto" onClick={onSelectCue}>查看提示 →</Button>
        ) : null}
      </Flex>
    </Box>
  );
}

export interface ReconciliationSummary {
  total: number;
  pending: number;
  duplicate: number;
  invalid: number;
  confirmed: number;
}

interface ReconciliationPanelProps {
  workspace: Workspace;
  sceneId: string;
  entries: ResolvedEntryView[];
  summary: ReconciliationSummary;
  onConfirm: (entryId: string, recordId: string) => void;
  onDiscard: (entryId: string) => void;
  onRecalibrate: (entryId: string) => void;
  onImportFile: (file: File) => void;
  onLoadSample: (variant: 'first-show' | 'second-show') => void;
  onSelectCue: (cueNumber: string) => void;
}

export function ReconciliationPanel({
  workspace,
  sceneId,
  entries,
  summary,
  onConfirm,
  onDiscard,
  onRecalibrate,
  onImportFile,
  onLoadSample,
  onSelectCue
}: ReconciliationPanelProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const plan = findActivePlan(workspace);
  const scene = plan.scenes.find((item) => item.id === sceneId);
  const sceneEntries = entries;
  const canImport = workspace.role === 'designer' || workspace.role === 'programmer';

  return (
    <Box borderWidth="1px" borderColor="whiteAlpha.100" borderRadius="xl" bg="whiteAlpha.50" p={4}>
      <Flex align="center" gap={3} wrap="wrap">
        <Flex w="34px" h="34px" borderRadius="lg" align="center" justify="center" bg="purple.400" color="stage.950">
          <ClipboardList size={18} />
        </Flex>
        <Box>
          <Heading size="sm">执行对账 · GO 记录核对</Heading>
          <Text color="whiteAlpha.500" fontSize="xs">
            按稳定编号（场次 + 提示编号）配对断网控台记录；确认前不改动全剧时间
          </Text>
        </Box>
        <Spacer />
        <HStack spacing={2} wrap="wrap">
          <Tooltip label="待确认记录数（含冲突与失效）">
            <Badge colorScheme={summary.pending + summary.duplicate + summary.invalid ? 'orange' : 'green'} variant="subtle" px={2} py={1} borderRadius="md">
              <HStack spacing={1}><GitCompareArrows size={12} /><Text>{summary.pending + summary.duplicate + summary.invalid} 待处理</Text></HStack>
            </Badge>
          </Tooltip>
          <Badge colorScheme="green" variant="subtle" px={2} py={1} borderRadius="md">
            <HStack spacing={1}><CheckCircle2 size={12} /><Text>{summary.confirmed} 已确认</Text></HStack>
          </Badge>
        </HStack>
      </Flex>

      <Flex mt={3} gap={2} wrap="wrap">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          aria-label="导入断网控台 GO 记录 JSON"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImportFile(file);
            event.target.value = '';
          }}
        />
        <Tooltip label={canImport ? '编程执行/灯光设计可把断网控台 GO 记录补入对账；冻结场次会被拒绝' : '当前角色只能查看，编程执行负责补记录'}>
          <Button size="sm" colorScheme="purple" leftIcon={<FileUp size={15} />} isDisabled={!canImport} onClick={() => fileRef.current?.click()}>
            导入 GO 记录
          </Button>
        </Tooltip>
        <Tooltip label="载入模拟的首场 GO 记录（含提前、改参、冻结拒绝、编号缺失样例）">
          <Button size="sm" variant="outline" leftIcon={<Radio size={14} />} isDisabled={!canImport} onClick={() => onLoadSample('first-show')}>
            示例：首场 GO
          </Button>
        </Tooltip>
        <Tooltip label="再次导入同批记录只合并一次；对同一提示的不同记录会并列保留">
          <Button size="sm" variant="ghost" leftIcon={<Radio size={14} />} isDisabled={!canImport} onClick={() => onLoadSample('second-show')}>
            示例：次场 GO
          </Button>
        </Tooltip>
      </Flex>

      {scene?.frozen ? (
        <Alert status="warning" mt={3} borderRadius="lg">
          <Lock size={15} />
          <AlertDescription fontSize="sm" ml={2}>
            场次《{scene.name}》已冻结：对账记录只读，不能导入、确认、废弃或重算。
          </AlertDescription>
        </Alert>
      ) : null}

      {workspace.role === 'stage-manager' ? (
        <Text mt={2} color="whiteAlpha.500" fontSize="11px">
          舞台监督负责确认：存在多份不同记录时请先核对备注与差异，再选择一份确认；确认时锁定当时计划快照。
        </Text>
      ) : workspace.role === 'programmer' ? (
        <Text mt={2} color="whiteAlpha.500" fontSize="11px">
          编程执行只能把控台 GO 记录补入对账，不能确认或修改全剧时间；确认与重算由舞台监督/灯光设计完成。
        </Text>
      ) : null}

      <Box mt={4}>
        {sceneEntries.length ? (
          <VStack align="stretch" spacing={3}>
            {sceneEntries.map((resolved) => (
              <EntryCard
                key={resolved.entry.id}
                resolved={resolved}
                role={workspace.role}
                onSelectCue={() => onSelectCue(resolved.entry.cueNumber)}
                onConfirm={onConfirm}
                onDiscard={onDiscard}
                onRecalibrate={onRecalibrate}
              />
            ))}
          </VStack>
        ) : (
          <Flex
            minH="120px"
            align="center"
            justify="center"
            borderRadius="lg"
            borderWidth="1px"
            borderStyle="dashed"
            borderColor="whiteAlpha.200"
            color="whiteAlpha.500"
            textAlign="center"
            fontSize="sm"
          >
            <Box>
              <ClipboardList size={22} style={{ margin: '0 auto 8px' }} />
              本场暂无 GO 对账记录。导入断网控台记录后，将按提示稳定编号在此核对差异。
            </Box>
          </Flex>
        )}
      </Box>
    </Box>
  );
}
