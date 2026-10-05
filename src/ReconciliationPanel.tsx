import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  ButtonGroup,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  HStack,
  Input,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  Radio,
  RadioGroup,
  Select,
  SimpleGrid,
  Spacer,
  Stack,
  Tag,
  Text,
  Textarea,
  VStack
} from '@chakra-ui/react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileUp,
  History,
  Lock,
  RefreshCw,
  ShieldQuestion,
  Trash2,
  XCircle
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  canConfirmReconciliation,
  canImportGo,
  canManageReconciliation,
  formatTime
} from './state/useLightingDesk';
import { cueSignature, snapshotSignature } from './reconciliation';
import type {
  GoRecord,
  ImportReport,
  LightingPlan,
  ReconciliationView,
  UserRole
} from './types';

interface ReconciliationPanelProps {
  plan: LightingPlan;
  role: UserRole;
  views: ReconciliationView[];
  report?: ImportReport;
  onImportRaw: (raw: string) => void;
  onAddRecord: (record: Omit<GoRecord, 'id' | 'planId' | 'importedAt' | 'batchId'>) => void;
  onConfirm: (entryId: string, chosenRecordId?: string) => void;
  onRecalculate: (entryId: string) => void;
  onDiscard: (entryId: string) => void;
  onSelectCue: (sceneId: string, cueNumber: string) => void;
}

const effectiveMeta = {
  pending: { label: '待确认', color: 'orange' as const, icon: <ShieldQuestion size={14} /> },
  stale: { label: '已失效 · 待重算', color: 'red' as const, icon: <AlertTriangle size={14} /> },
  confirmed: { label: '已确认', color: 'green' as const, icon: <CheckCircle2 size={14} /> }
};

function deltaText(delta: number | undefined) {
  if (delta === undefined) return null;
  if (Math.abs(delta) <= 0.05) return null;
  const abs = Math.abs(delta).toFixed(1);
  return delta < 0 ? (
    <Tag colorScheme="red" size="sm">临时提前 {abs}s</Tag>
  ) : (
    <Tag colorScheme="purple" size="sm">推迟 {abs}s</Tag>
  );
}

function DiffTable({ fields }: { fields: ReconciliationView['diffs'][number]['fields'] }) {
  if (!fields.length) {
    return <Text fontSize="xs" color="green.300">与计划一致，无差异。</Text>;
  }
  return (
    <VStack align="stretch" spacing={1} role="table" aria-label="执行差异">
      {fields.map((field) => (
        <Flex
          key={field.key}
          role="row"
          gap={2}
          fontSize="xs"
          align="center"
          px={2}
          py={1}
          borderRadius="md"
          bg="blackAlpha.300"
        >
          <Text role="rowheader" w="56px" color="whiteAlpha.600" flexShrink={0}>{field.label}</Text>
          {field.key === 'firedAt' ? (
            <>
              <Text fontFamily="mono" color="whiteAlpha.500">计划 {formatTime(Number(field.planned ?? 0))}</Text>
              <Text color="whiteAlpha.400">→</Text>
              <Text fontFamily="mono" color="amber.300">实际 {formatTime(Number(field.actual ?? 0))}</Text>
              <Spacer />
              {deltaText(field.deltaSeconds)}
            </>
          ) : (
            <>
              <Text fontFamily="mono" color="whiteAlpha.500" wordBreak="break-all">{String(field.planned ?? '—')}</Text>
              <Text color="whiteAlpha.400">→</Text>
              <Text fontFamily="mono" color="orange.300" wordBreak="break-all">{String(field.actual ?? '—')}</Text>
              {field.key === 'brightness' && typeof field.actual === 'number' ? <Text>%</Text> : null}
              {field.key !== 'brightness' && field.key !== 'colorHex' ? <Text>s</Text> : null}
            </>
          )}
        </Flex>
      ))}
    </VStack>
  );
}

function RecordCard({
  record,
  fields,
  selectable,
  selected,
  onSelect
}: {
  record: GoRecord;
  fields: ReconciliationView['diffs'][number]['fields'];
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Box
      borderWidth="1px"
      borderRadius="lg"
      borderColor={selected ? 'amber.400' : 'whiteAlpha.100'}
      bg={selected ? 'amber.900' : 'blackAlpha.200'}
      p={3}
    >
      <Flex align="center" gap={2} mb={2}>
        {selectable ? (
          <Radio
            aria-label={`选择记录 ${record.id}`}
            value={record.id}
            colorScheme="amber"
            onChange={onSelect}
          />
        ) : null}
        <Badge fontFamily="mono" fontSize="10px">{record.id}</Badge>
        <Tag size="sm" variant="subtle">
          {record.firedBy === 'stage-manager' ? '舞台监督' : record.firedBy === 'programmer' ? '编程执行' : '未知操作人'}
        </Tag>
        <Spacer />
        <Text fontFamily="mono" fontSize="xs" color="amber.300">GO {formatTime(record.firedAt)}</Text>
      </Flex>
      <Text color="whiteAlpha.500" fontSize="11px" mb={2}>{record.source}</Text>
      <DiffTable fields={fields} />
      {record.note ? (
        <Text mt={2} fontSize="xs" color="whiteAlpha.600" fontStyle="italic">备注：{record.note}</Text>
      ) : null}
    </Box>
  );
}

function EntryCard({
  view,
  plan,
  role,
  chosen,
  setChosen,
  onConfirm,
  onRecalculate,
  onDiscard,
  onSelectCue
}: {
  view: ReconciliationView;
  plan: LightingPlan;
  role: UserRole;
  chosen: Record<string, string>;
  setChosen: (entryId: string, recordId: string) => void;
  onConfirm: (entryId: string, chosenRecordId?: string) => void;
  onRecalculate: (entryId: string) => void;
  onDiscard: (entryId: string) => void;
  onSelectCue: (sceneId: string, cueNumber: string) => void;
}) {
  const meta = effectiveMeta[view.effective];
  const scene = plan.scenes.find((item) => item.id === view.sceneId);
  const cue = scene?.cues.find((item) => item.number === view.cueNumber);
  const selectedRecordId = view.status === 'confirmed' ? view.chosenRecordId : (chosen[view.id] ?? view.chosenRecordId);
  const multiple = view.records.length > 1;

  // 已确认条目：快照之后计划又改动时，仅提示，不改变确认
  let drift = false;
  if (view.status === 'confirmed' && view.snapshot && cue && scene) {
    const orderIndex = scene.cues.findIndex((item) => item.number === cue.number);
    drift = cueSignature(cue, orderIndex) !== snapshotSignature(view.snapshot);
  }

  return (
    <Box
      borderWidth="1px"
      borderColor={view.effective === 'stale' ? 'red.700' : view.status === 'confirmed' ? 'green.800' : 'whiteAlpha.100'}
      borderRadius="xl"
      bg="whiteAlpha.50"
      p={4}
      role="group"
      aria-label={`${view.cueNumber} 执行记录，${meta.label}`}
    >
      <Flex align="center" gap={2} wrap="wrap">
        <Button
          size="xs"
          variant="ghost"
          fontFamily="mono"
          color="amber.300"
          fontWeight="700"
          onClick={() => onSelectCue(view.sceneId, view.cueNumber)}
        >
          {view.cueNumber}
        </Button>
        <Text fontWeight="650" fontSize="sm" noOfLines={1}>{cue?.label ?? '（计划中已找不到该提示）'}</Text>
        <Tag size="sm" colorScheme={meta.color}>{meta.icon}<Text ml={1}>{meta.label}</Text></Tag>
        {multiple && view.status === 'pending' ? <Tag size="sm" colorScheme="purple">{view.records.length} 份并列待选</Tag> : null}
        {view.sceneFrozen ? <Tag size="sm" colorScheme="green"><Lock size={11} /><Text ml={1}>冻结场次</Text></Tag> : null}
        <Spacer />
        <Text color="whiteAlpha.400" fontSize="10px">{scene?.name ?? '未知场次'}</Text>
      </Flex>

      {view.effective === 'stale' ? (
        <Alert status="error" borderRadius="lg" mt={3} py={2}>
          <AlertIcon />
          <AlertDescription fontSize="xs">{view.staleReason}</AlertDescription>
        </Alert>
      ) : null}

      {view.status === 'confirmed' ? (
        <Alert status={drift ? 'warning' : 'success'} borderRadius="lg" mt={3} py={2}>
          <History size={15} />
          <AlertDescription fontSize="xs">
            {view.confirmedAt
              ? `舞台监督已于 ${new Date(view.confirmedAt).toLocaleString('zh-CN')} 确认，保留当时计划快照`
              : '已确认，保留当时计划快照'}
            {drift ? '；确认后编号、顺序或渐变时长又有调整，当前计划已不同于快照。' : '。'}
          </AlertDescription>
        </Alert>
      ) : null}

      <RadioGroup
        value={selectedRecordId ?? ''}
        onChange={(value) => setChosen(view.id, value)}
        isDisabled={view.status !== 'pending' || !canConfirmReconciliation(role)}
      >
        <SimpleGrid columns={{ base: 1, lg: view.records.length > 1 ? 2 : 1 }} spacing={2} mt={3}>
          {view.records.map((record) => (
            <RecordCard
              key={record.id}
              record={record}
              fields={view.diffs.find((item) => item.recordId === record.id)?.fields ?? []}
              selectable={multiple && view.status === 'pending'}
              selected={record.id === selectedRecordId}
              onSelect={() => setChosen(view.id, record.id)}
            />
          ))}
        </SimpleGrid>
      </RadioGroup>

      {view.status === 'pending' ? (
        <Flex mt={3} gap={2} wrap="wrap">
          <Button
            size="sm"
            colorScheme="green"
            leftIcon={<CheckCircle2 size={15} />}
            isDisabled={!canConfirmReconciliation(role) || view.effective === 'stale' || view.sceneFrozen || (multiple && !selectedRecordId)}
            onClick={() => onConfirm(view.id, multiple ? selectedRecordId : undefined)}
          >
            确认（仅舞台监督，确认前不改全剧时间）
          </Button>
          {view.effective === 'stale' ? (
            <Button
              size="sm"
              variant="outline"
              colorScheme="red"
              leftIcon={<RefreshCw size={14} />}
              isDisabled={!canManageReconciliation(role)}
              onClick={() => onRecalculate(view.id)}
            >
              立即重算
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            colorScheme="red"
            leftIcon={<Trash2 size={14} />}
            isDisabled={!canManageReconciliation(role)}
            onClick={() => onDiscard(view.id)}
          >
            丢弃未确认条目
          </Button>
          {!canConfirmReconciliation(role) ? (
            <Text fontSize="xs" color="whiteAlpha.400" alignSelf="center">确认由舞台监督负责。</Text>
          ) : null}
        </Flex>
      ) : null}
    </Box>
  );
}

function AddRecordForm({
  plan,
  disabled,
  onAdd
}: {
  plan: LightingPlan;
  disabled: boolean;
  onAdd: ReconciliationPanelProps['onAddRecord'];
}) {
  const firstUnfrozen = plan.scenes.find((scene) => !scene.frozen) ?? plan.scenes[0];
  const [sceneId, setSceneId] = useState(firstUnfrozen.id);
  const scene = plan.scenes.find((item) => item.id === sceneId) ?? firstUnfrozen;
  const [cueNumber, setCueNumber] = useState(scene.cues[0]?.number ?? '');
  const [firedAt, setFiredAt] = useState(scene.cues[0]?.startTime ?? 0);
  const [brightness, setBrightness] = useState<string>('');
  const [fadeIn, setFadeIn] = useState<string>('');
  const [hold, setHold] = useState<string>('');
  const [fadeOut, setFadeOut] = useState<string>('');
  const [note, setNote] = useState('');

  function changeScene(nextSceneId: string) {
    const nextScene = plan.scenes.find((item) => item.id === nextSceneId);
    setSceneId(nextSceneId);
    const firstCue = nextScene?.cues[0];
    setCueNumber(firstCue?.number ?? '');
    setFiredAt(firstCue?.startTime ?? 0);
  }

  function changeCue(nextNumber: string) {
    setCueNumber(nextNumber);
    const cue = scene.cues.find((item) => item.number === nextNumber);
    if (cue) setFiredAt(cue.startTime ?? 0);
  }

  function submit() {
    if (!cueNumber || scene.frozen) return;
    onAdd({
      sceneId: scene.id,
      cueNumber,
      firedAt: Number(firedAt) || 0,
      brightness: brightness === '' ? undefined : Number(brightness),
      fadeIn: fadeIn === '' ? undefined : Number(fadeIn),
      hold: hold === '' ? undefined : Number(hold),
      fadeOut: fadeOut === '' ? undefined : Number(fadeOut),
      source: '编程执行手动补录',
      firedBy: 'programmer',
      note: note || undefined
    });
    setNote('');
  }

  return (
    <Box borderWidth="1px" borderColor="whiteAlpha.100" borderRadius="xl" bg="whiteAlpha.50" p={4}>
      <Flex align="center" mb={3}>
        <ClipboardList size={16} color="#f6c453" />
        <Heading size="sm" ml={2}>补录 GO 记录</Heading>
        <Spacer />
        <Tag size="sm" variant="subtle">编程执行可补记录，确认归舞台监督</Tag>
      </Flex>
      <SimpleGrid columns={{ base: 2, lg: 4 }} spacing={3}>
        <FormControl>
          <FormLabel htmlFor="add-scene">场次</FormLabel>
          <Select id="add-scene" value={sceneId} isDisabled={disabled} onChange={(event) => changeScene(event.target.value)}>
            {plan.scenes.map((item) => (
              <option key={item.id} value={item.id}>{item.name}{item.frozen ? '（冻结）' : ''}</option>
            ))}
          </Select>
        </FormControl>
        <FormControl>
          <FormLabel htmlFor="add-cue">提示编号</FormLabel>
          <Select id="add-cue" value={cueNumber} isDisabled={disabled || scene.frozen} onChange={(event) => changeCue(event.target.value)}>
            {scene.cues.map((item) => <option key={item.id} value={item.number}>{item.number} · {item.label}</option>)}
          </Select>
        </FormControl>
        <FormControl>
          <FormLabel htmlFor="add-fired">实际 GO 时间（秒）</FormLabel>
          <NumberInput id="add-fired" min={0} precision={1} value={firedAt} isDisabled={disabled || scene.frozen} onChange={(value) => setFiredAt(Number(value) || 0)}>
            <NumberInputField />
            <NumberInputStepper><NumberIncrementStepper /><NumberDecrementStepper /></NumberInputStepper>
          </NumberInput>
        </FormControl>
        <FormControl>
          <FormLabel htmlFor="add-brightness">实际亮度（可空）</FormLabel>
          <NumberInput id="add-brightness" min={0} max={100} value={brightness} isDisabled={disabled || scene.frozen} onChange={setBrightness}>
            <NumberInputField placeholder="同计划则留空" />
            <NumberInputStepper><NumberIncrementStepper /><NumberDecrementStepper /></NumberInputStepper>
          </NumberInput>
        </FormControl>
        <FormControl>
          <FormLabel htmlFor="add-fadein">实际渐入（秒）</FormLabel>
          <NumberInput id="add-fadein" min={0} step={0.5} value={fadeIn} isDisabled={disabled || scene.frozen} onChange={setFadeIn}>
            <NumberInputField placeholder="留空=未改" />
            <NumberInputStepper><NumberIncrementStepper /><NumberDecrementStepper /></NumberInputStepper>
          </NumberInput>
        </FormControl>
        <FormControl>
          <FormLabel htmlFor="add-hold">实际保持（秒）</FormLabel>
          <NumberInput id="add-hold" min={0} step={0.5} value={hold} isDisabled={disabled || scene.frozen} onChange={setHold}>
            <NumberInputField placeholder="留空=未改" />
            <NumberInputStepper><NumberIncrementStepper /><NumberDecrementStepper /></NumberInputStepper>
          </NumberInput>
        </FormControl>
        <FormControl>
          <FormLabel htmlFor="add-fadeout">实际渐出（秒）</FormLabel>
          <NumberInput id="add-fadeout" min={0} step={0.5} value={fadeOut} isDisabled={disabled || scene.frozen} onChange={setFadeOut}>
            <NumberInputField placeholder="留空=未改" />
            <NumberInputStepper><NumberIncrementStepper /><NumberDecrementStepper /></NumberInputStepper>
          </NumberInput>
        </FormControl>
        <FormControl gridColumn={{ base: 'span 2', lg: 'span 1' }}>
          <FormLabel htmlFor="add-note">现场备注</FormLabel>
          <Input id="add-note" value={note} isDisabled={disabled || scene.frozen} placeholder="提前/改动原因" onChange={(event) => setNote(event.target.value)} />
        </FormControl>
      </SimpleGrid>
      {scene.frozen ? (
        <Alert status="error" borderRadius="lg" mt={3} py={2}>
          <AlertIcon /><AlertDescription fontSize="xs">冻结场次不能写入，无法向该场次补录。</AlertDescription>
        </Alert>
      ) : null}
      <Flex mt={3}>
        <Button
          size="sm"
          colorScheme="amber"
          leftIcon={<ClipboardList size={15} />}
          isDisabled={disabled || scene.frozen || !cueNumber}
          onClick={submit}
        >
          补录并合并对账
        </Button>
      </Flex>
    </Box>
  );
}

function ReportBanner({ report }: { report: ImportReport }) {
  const tone = report.rejected.length || report.restored ? 'error' : 'success';
  return (
    <Alert status={tone} borderRadius="xl" role="status">
      {tone === 'error' ? <XCircle /> : <CheckCircle2 />}
      <AlertDescription fontSize="xs">
        {report.restored
          ? `合并失败，已恢复原方案与待处理清单（${report.rejected.join('；')}）。未写入任何记录。`
          : `批次 ${report.batchId.slice(-6)}：新增合并 ${report.merged} 条（新建条目 ${report.created}，并列差异 ${report.conflicts}），重复跳过 ${report.duplicated} 条。`}
      </AlertDescription>
    </Alert>
  );
}

export default function ReconciliationPanel({
  plan,
  role,
  views,
  report,
  onImportRaw,
  onAddRecord,
  onConfirm,
  onRecalculate,
  onDiscard,
  onSelectCue
}: ReconciliationPanelProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const stats = useMemo(() => {
    const pending = views.filter((view) => view.effective === 'pending').length;
    const stale = views.filter((view) => view.effective === 'stale').length;
    const confirmed = views.filter((view) => view.status === 'confirmed').length;
    const parallel = views.filter((view) => view.status === 'pending' && view.records.length > 1).length;
    return { pending, stale, confirmed, parallel };
  }, [views]);

  const grouped = useMemo(() => {
    const map = new Map<string, ReconciliationView[]>();
    for (const view of views) {
      map.set(view.sceneId, [...(map.get(view.sceneId) ?? []), view]);
    }
    return plan.scenes
      .map((scene) => ({ scene, items: map.get(scene.id) ?? [] }))
      .filter((group) => group.items.length);
  }, [plan, views]);

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onImportRaw(String(reader.result ?? ''));
    reader.readAsText(file);
    event.target.value = '';
  }

  return (
    <VStack align="stretch" spacing={4}>
      <Box borderWidth="1px" borderColor="whiteAlpha.100" borderRadius="xl" bg="whiteAlpha.50" p={4}>
        <Flex align="center" gap={3} wrap="wrap">
          <Box>
            <Heading size="md">执行对账 · {plan.name}</Heading>
            <Text color="whiteAlpha.500" fontSize="xs" mt={1}>
              按稳定编号把断网控台的 GO 记录接回计划；重复导入只合并一次，并列差异由舞台监督确认，确认前不改全剧时间。
            </Text>
          </Box>
          <Spacer />
          <ButtonGroup size="sm" variant="outline" flexWrap="wrap">
            <Button leftIcon={<FileUp size={15} />} isDisabled={!canImportGo(role)} onClick={() => fileRef.current?.click()}>
              导入 GO 记录
            </Button>
            <Input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              display="none"
              onChange={handleFile}
              aria-label="选择 GO 记录 JSON 文件"
            />
          </ButtonGroup>
        </Flex>
        <HStack mt={2} spacing={2}>
          <Button size="xs" variant="ghost" isDisabled={!canImportGo(role)} onClick={() => onImportRaw('__sample_success__')}>
            载入示例 GO 记录
          </Button>
          <Button size="xs" variant="ghost" colorScheme="red" isDisabled={!canImportGo(role)} onClick={() => onImportRaw('__sample_rejected__')}>
            载入应被整体拒绝的示例
          </Button>
        </HStack>
      </Box>

      {report ? <ReportBanner report={report} /> : null}

      <SimpleGrid columns={{ base: 2, lg: 4 }} spacing={3}>
        <Box p={3} borderRadius="lg" bg="whiteAlpha.50" borderWidth="1px" borderColor="orange.700">
          <Text fontSize="2xl" fontWeight="800" color="orange.300">{stats.pending}</Text>
          <Text color="whiteAlpha.500" fontSize="xs">待舞台监督确认</Text>
        </Box>
        <Box p={3} borderRadius="lg" bg="whiteAlpha.50" borderWidth="1px" borderColor="purple.700">
          <Text fontSize="2xl" fontWeight="800" color="purple.300">{stats.parallel}</Text>
          <Text color="whiteAlpha.500" fontSize="xs">同提示并列待选</Text>
        </Box>
        <Box p={3} borderRadius="lg" bg="whiteAlpha.50" borderWidth="1px" borderColor="red.700">
          <Text fontSize="2xl" fontWeight="800" color="red.300">{stats.stale}</Text>
          <Text color="whiteAlpha.500" fontSize="xs">失效待重算</Text>
        </Box>
        <Box p={3} borderRadius="lg" bg="whiteAlpha.50" borderWidth="1px" borderColor="green.700">
          <Text fontSize="2xl" fontWeight="800" color="green.300">{stats.confirmed}</Text>
          <Text color="whiteAlpha.500" fontSize="xs">已确认（保留快照）</Text>
        </Box>
      </SimpleGrid>

      <AddRecordForm plan={plan} disabled={!canImportGo(role)} onAdd={onAddRecord} />

      {!views.length ? (
        <Flex minH="220px" align="center" justify="center" direction="column" color="whiteAlpha.500" gap={2}>
          <ClipboardList size={36} />
          <Text>暂无执行记录。导入断网控台 GO 文件，或由编程执行手动补录。</Text>
        </Flex>
      ) : (
        grouped.map(({ scene, items }) => (
          <Box key={scene.id}>
            <Flex align="center" mb={2} gap={2}>
              <Text color="amber.300" fontFamily="mono" fontSize="xs">{scene.order.toString().padStart(2, '0')}</Text>
              <Text fontWeight="700" fontSize="sm">{scene.name}</Text>
              {scene.frozen ? <Tag size="sm" colorScheme="green"><Lock size={11} /><Text ml={1}>冻结</Text></Tag> : null}
            </Flex>
            <Stack spacing={3}>
              {items.map((view) => (
                <EntryCard
                  key={view.id}
                  view={view}
                  plan={plan}
                  role={role}
                  chosen={chosen}
                  setChosen={(entryId, recordId) => setChosen((current) => ({ ...current, [entryId]: recordId }))}
                  onConfirm={onConfirm}
                  onRecalculate={onRecalculate}
                  onDiscard={onDiscard}
                  onSelectCue={onSelectCue}
                />
              ))}
            </Stack>
          </Box>
        ))
      )}

      <Box p={3} borderRadius="lg" borderWidth="1px" borderStyle="dashed" borderColor="whiteAlpha.200" color="whiteAlpha.500" fontSize="xs" lineHeight="1.7">
        <Text color="whiteAlpha.700" fontWeight="700" mb={1}>对账规则</Text>
        记录按提示稳定编号配对；编号、顺序或渐变时长变化时，未确认记录立即失效重算，已确认记录保留其当时计划快照。
        冻结场次不能写入；编程执行只能补记录；确认是舞台监督的职责。合并任一条失败都会恢复原方案和待处理清单。
      </Box>
    </VStack>
  );
}
