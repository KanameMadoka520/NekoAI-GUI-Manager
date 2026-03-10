import { useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Panel } from '../components/common/Panel';
import { SearchBar } from '../components/common/SearchBar';
import { SummaryCard } from '../components/common/SummaryCard';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { useUiStore } from '../stores/uiStore';
import {
  getConfig,
  runPersonalityEvalExperimentStream,
  listPersonalityEvalExperiments,
  getPersonalityEvalExperiment,
  setPersonalityEvalScore,
  deletePersonalityEvalExperiment,
} from '../lib/tauri-commands';
import type {
  ApiNode,
  RuntimeConfig,
  Personality,
  PersonalityEvalCase,
  PersonalityEvalCandidate,
  PersonalityEvalExperimentRecord,
  PersonalityEvalExperimentSummary,
  PersonalityEvalMode,
  PersonalityEvalRunRecord,
  PersonalityEvalDimensionKey,
  EvalProgressEvent,
  EvalDoneEvent,
} from '../lib/types';
import { PERSONA_EVAL_DIMENSIONS } from '../lib/types';

const MAX_API_COUNT = 5;
const MAX_CANDIDATE_COUNT = 6;
const MAX_CASE_COUNT = 20;
const MAX_ROUNDS = 5;
const MAX_TOTAL_RUNS = 320;

function makeCase(): PersonalityEvalCase {
  const id = `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: '新用例',
    tags: [],
    contextText: '',
    latestUserMessage: '',
  };
}

function createSessionId() {
  return `eval-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultCandidateIndexes(list: Personality[]) {
  return list.slice(0, Math.min(2, list.length)).map((_, index) => index);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function runKeyString(run: PersonalityEvalRunRecord) {
  return `${run.key.apiIndex}::${run.key.candidateIndex}::${run.key.caseId}::${run.key.round}`;
}

function totalScore(run: PersonalityEvalRunRecord) {
  if (!run.score) return null;
  return PERSONA_EVAL_DIMENSIONS.reduce((sum, dim) => sum + (run.score?.dims[dim.key] ?? 0), 0);
}

export function EvaluationLab() {
  const addToast = useUiStore((s) => s.addToast);
  const settings = useUiStore((s) => s.settings);

  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<PersonalityEvalMode>('group');
  const [groupList, setGroupList] = useState<Personality[]>([]);
  const [privateList, setPrivateList] = useState<Personality[]>([]);
  const [apiNodes, setApiNodes] = useState<(ApiNode & { index: number })[]>([]);
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null);

  const [selectedCandidateIndexes, setSelectedCandidateIndexes] = useState<number[]>([]);
  const [selectedApiIndexes, setSelectedApiIndexes] = useState<number[]>([]);
  const [rounds, setRounds] = useState(2);
  const [cases, setCases] = useState<PersonalityEvalCase[]>([makeCase()]);

  const [history, setHistory] = useState<PersonalityEvalExperimentSummary[]>([]);
  const [activeExperiment, setActiveExperiment] = useState<PersonalityEvalExperimentRecord | null>(null);
  const [selectedRunKey, setSelectedRunKey] = useState('');
  const [runSearch, setRunSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PersonalityEvalExperimentSummary | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<EvalProgressEvent | null>(null);
  const [runningSessionId, setRunningSessionId] = useState('');

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (!runningSessionId) return;
    let disposed = false;
    let offProgress: null | (() => void) = null;
    let offDone: null | (() => void) = null;

    void (async () => {
      offProgress = await listen<EvalProgressEvent>('eval-progress', (event) => {
        if (disposed) return;
        if (event.payload.sessionId !== runningSessionId) return;
        setProgress(event.payload);
      });
      offDone = await listen<EvalDoneEvent>('eval-done', (event) => {
        if (disposed) return;
        if (event.payload.sessionId !== runningSessionId) return;
        setBusy(null);
        setProgress(null);
        setRunningSessionId('');
        if (!event.payload.experimentId) {
          addToast('error', '评测实验执行失败');
          return;
        }
        addToast('success', `评测实验已完成：${event.payload.experimentId}`);
        void loadExperiment(event.payload.experimentId);
        void loadHistory();
      });
    })();

    return () => {
      disposed = true;
      offProgress?.();
      offDone?.();
    };
  }, [runningSessionId, addToast]);

  useEffect(() => {
    const list = mode === 'group' ? groupList : privateList;
    setSelectedCandidateIndexes((prev) => {
      const next = prev.filter((index) => index >= 0 && index < list.length);
      return next.length >= 2 ? next : defaultCandidateIndexes(list);
    });
  }, [mode, groupList, privateList]);

  async function loadAll() {
    setLoading(true);
    try {
      const [gp, pp, rt, api] = await Promise.all([
        getConfig<Personality[]>('groupPersonality'),
        getConfig<Personality[]>('privatePersonality'),
        getConfig<RuntimeConfig>('runtime'),
        getConfig<ApiNode[]>('api'),
      ]);
      const group = gp ?? [];
      const priv = pp ?? [];
      const nodes = (api ?? []).map((node, index) => ({ ...node, index }));
      setGroupList(group);
      setPrivateList(priv);
      setApiNodes(nodes);
      setRuntime(rt);
      setSelectedApiIndexes(nodes.slice(0, 1).map((x) => x.index));
      const initialList = group.length > 0 ? group : priv;
      setSelectedCandidateIndexes(defaultCandidateIndexes(initialList));
      await loadHistory();
    } catch (e: any) {
      addToast('error', `加载评测实验室失败: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    try {
      const rows = await listPersonalityEvalExperiments(30);
      setHistory(rows ?? []);
    } catch (e: any) {
      addToast('error', `加载实验列表失败: ${e?.message ?? e}`);
    }
  }

  async function loadExperiment(id: string) {
    try {
      const record = await getPersonalityEvalExperiment(id);
      setActiveExperiment(record);
      setMode(record.mode as PersonalityEvalMode);
      setSelectedApiIndexes(record.apis.map((item) => item.index));
      setSelectedCandidateIndexes(record.candidates.map((item) => item.index));
      setRounds(record.rounds);
      setCases(record.cases.map((item) => ({ ...item })));
      setSelectedRunKey(record.runs[0] ? runKeyString(record.runs[0]) : '');
    } catch (e: any) {
      addToast('error', `加载实验失败: ${e?.message ?? e}`);
    }
  }

  const personalityList = mode === 'group' ? groupList : privateList;
  const densityClass = settings.contentDensity === 'spacious' ? 'gap-5' : settings.contentDensity === 'compact' ? 'gap-3' : 'gap-4';

  const selectedCandidates: PersonalityEvalCandidate[] = selectedCandidateIndexes
    .map((index) => personalityList[index] ? ({ index, remark: personalityList[index].remark, prompt: personalityList[index].prompt }) : null)
    .filter(Boolean) as PersonalityEvalCandidate[];

  const selectedApis = selectedApiIndexes
    .map((index) => apiNodes.find((node) => node.index === index) ?? null)
    .filter(Boolean) as (ApiNode & { index: number })[];

  const matrixTotal = selectedCandidates.length * selectedApis.length * cases.length * rounds;

  const scaleWarnings: string[] = [];
  if (selectedApis.length > MAX_API_COUNT) scaleWarnings.push(`API 数量超限（${selectedApis.length}/${MAX_API_COUNT}）`);
  if (selectedCandidates.length > MAX_CANDIDATE_COUNT) scaleWarnings.push(`人格数量超限（${selectedCandidates.length}/${MAX_CANDIDATE_COUNT}）`);
  if (cases.length > MAX_CASE_COUNT) scaleWarnings.push(`用例数量超限（${cases.length}/${MAX_CASE_COUNT}）`);
  if (rounds > MAX_ROUNDS) scaleWarnings.push(`轮次数超限（${rounds}/${MAX_ROUNDS}）`);
  if (matrixTotal > MAX_TOTAL_RUNS) scaleWarnings.push(`总任务数超限（${matrixTotal}/${MAX_TOTAL_RUNS}）`);
  const scaleBlocked = scaleWarnings.length > 0;

  const filteredHistory = history.filter((item) => {
    if (!historySearch.trim()) return true;
    const q = historySearch.toLowerCase();
    return item.id.toLowerCase().includes(q) || item.mode.toLowerCase().includes(q);
  });

  const filteredRuns = useMemo(() => {
    const runs = activeExperiment?.runs ?? [];
    if (!runSearch.trim()) return runs;
    const q = runSearch.toLowerCase();
    const caseMap = new Map((activeExperiment?.cases ?? []).map((item) => [item.id, item]));
    return runs.filter((run) => {
      const caseItem = caseMap.get(run.caseId);
      return run.candidate.remark.toLowerCase().includes(q)
        || run.apiNode.remark.toLowerCase().includes(q)
        || run.apiNode.modelName.toLowerCase().includes(q)
        || (caseItem?.name.toLowerCase().includes(q) ?? false)
        || run.result.responseText.toLowerCase().includes(q);
    });
  }, [activeExperiment, runSearch]);

  const activeRun = filteredRuns.find((run) => runKeyString(run) === selectedRunKey) ?? filteredRuns[0] ?? null;

  const stats = useMemo(() => {
    const runs = activeExperiment?.runs ?? [];
    const byCandidate = new Map<string, { total: number; count: number }>();
    const byApi = new Map<string, { total: number; count: number }>();
    const byCombo = new Map<string, { total: number; count: number }>();
    const duelGroups = new Map<string, Array<{ label: string; score: number }>>();

    for (const run of runs) {
      const score = totalScore(run);
      if (score == null) continue;
      const candidateLabel = `#${run.candidate.index} ${run.candidate.remark}`;
      const apiLabel = `#${run.apiNode.index} ${run.apiNode.remark}`;
      const comboLabel = `${candidateLabel} × ${apiLabel}`;
      const groupKey = `${run.caseId}::${run.key.apiIndex}::${run.round}`;

      const c = byCandidate.get(candidateLabel) ?? { total: 0, count: 0 };
      c.total += score;
      c.count += 1;
      byCandidate.set(candidateLabel, c);

      const a = byApi.get(apiLabel) ?? { total: 0, count: 0 };
      a.total += score;
      a.count += 1;
      byApi.set(apiLabel, a);

      const combo = byCombo.get(comboLabel) ?? { total: 0, count: 0 };
      combo.total += score;
      combo.count += 1;
      byCombo.set(comboLabel, combo);

      const duel = duelGroups.get(groupKey) ?? [];
      duel.push({ label: candidateLabel, score });
      duelGroups.set(groupKey, duel);
    }

    const wins = new Map<string, number>();
    for (const group of duelGroups.values()) {
      const sorted = [...group].sort((a, b) => b.score - a.score);
      if (sorted.length < 2) continue;
      if (sorted[0].score === sorted[1].score) continue;
      wins.set(sorted[0].label, (wins.get(sorted[0].label) ?? 0) + 1);
    }

    return {
      byCandidate: Array.from(byCandidate.entries()).map(([label, v]) => ({ label, avg: v.total / v.count, count: v.count, wins: wins.get(label) ?? 0 })).sort((a, b) => b.avg - a.avg),
      byApi: Array.from(byApi.entries()).map(([label, v]) => ({ label, avg: v.total / v.count, count: v.count })).sort((a, b) => b.avg - a.avg),
      byCombo: Array.from(byCombo.entries()).map(([label, v]) => ({ label, avg: v.total / v.count, count: v.count })).sort((a, b) => b.avg - a.avg),
    };
  }, [activeExperiment]);

  function toggleIndex(target: number, current: number[], setter: (value: number[]) => void) {
    setter(current.includes(target) ? current.filter((x) => x !== target) : [...current, target].sort((a, b) => a - b));
  }

  function updateCase(caseId: string, patch: Partial<PersonalityEvalCase>) {
    setCases((items) => items.map((item) => (item.id === caseId ? { ...item, ...patch } : item)));
  }

  function duplicateCase(caseId: string) {
    setCases((items) => {
      const target = items.find((item) => item.id === caseId);
      if (!target) return items;
      return [...items, { ...target, id: makeCase().id, name: `${target.name} 副本` }];
    });
  }

  async function runExperiment() {
    if (busy) return;
    if (selectedApis.length === 0) {
      addToast('warning', '请至少选择一个 API 节点');
      return;
    }
    if (selectedCandidates.length < 2) {
      addToast('warning', '请至少选择两个人格');
      return;
    }
    if (scaleBlocked) {
      addToast('warning', `当前实验规模超限：${scaleWarnings.join('；')}`);
      return;
    }
    if (cases.length === 0 || cases.some((item) => !item.latestUserMessage.trim())) {
      addToast('warning', '请至少保留一个测试用例，并填写最新用户消息');
      return;
    }

    const sid = createSessionId();
    setRunningSessionId(sid);
    setBusy('run');
    setProgress({ sessionId: sid, done: 0, total: matrixTotal, ok: 0, failed: 0 });

    try {
      await runPersonalityEvalExperimentStream(sid, {
        mode,
        apis: selectedApis,
        apiParams: runtime?.apiParams ?? {},
        candidates: selectedCandidates,
        cases,
        rounds,
      });
      addToast('success', `已启动评测实验，共 ${matrixTotal} 条任务`);
    } catch (e: any) {
      setBusy(null);
      setRunningSessionId('');
      setProgress(null);
      addToast('error', `启动实验失败: ${e?.message ?? e}`);
    }
  }

  async function saveScore(run: PersonalityEvalRunRecord, dims: Record<PersonalityEvalDimensionKey, number>, note: string) {
    if (!activeExperiment) return;
    try {
      await setPersonalityEvalScore({
        experimentId: activeExperiment.id,
        runKey: run.key,
        score: {
          dims,
          note,
          scoredAt: new Date().toISOString(),
        },
      });
      addToast('success', '评分已保存');
      await loadExperiment(activeExperiment.id);
    } catch (e: any) {
      addToast('error', `保存评分失败: ${e?.message ?? e}`);
    }
  }

  async function deleteExperiment(id: string) {
    try {
      await deletePersonalityEvalExperiment(id);
      const nextHistory = history.filter((item) => item.id !== id);
      if (activeExperiment?.id === id) {
        setActiveExperiment(null);
        setSelectedRunKey('');
      }
      setHistory(nextHistory);
      addToast('success', `已删除实验 ${id}`);
      if (activeExperiment?.id === id && nextHistory[0]) {
        await loadExperiment(nextHistory[0].id);
      }
    } catch (e: any) {
      addToast('error', `删除实验失败: ${e?.message ?? e}`);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <span className="text-4xl block mb-3 animate-bounce">📊</span>
          <p className="text-[var(--text-secondary)]">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <SummaryCard label="评测模式" value={mode === 'group' ? '群聊' : '私聊'} hint="人格集合会随模式切换。" />
        <SummaryCard label="参评人格" value={selectedCandidates.length} hint="建议至少 2 个，便于看胜率。" />
        <SummaryCard label="API 节点" value={selectedApis.length} hint="MVP 启用规模硬限制，避免矩阵爆炸。" />
        <SummaryCard label="测试矩阵" value={matrixTotal} hint="公式：人格 × API × 用例 × 轮次。" tone={matrixTotal > 100 ? 'warning' : 'neutral'} />
        <SummaryCard label="最近实验" value={history.length} hint="可回看、评分与删除。" />
      </div>

      <div className={`grid grid-cols-1 xl:grid-cols-2 ${densityClass}`}>
        <Panel title="实验配置" subtitle="先选模式、人格、API 与轮次。MVP 默认 4 维打分：风格一致性 / 稳定性 / 任务完成度 / 拟人感。" icon="🧪">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setMode('group')} className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] border cursor-pointer ${mode === 'group' ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)] border-[var(--accent-purple)]' : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>群聊人格</button>
              <button onClick={() => setMode('private')} className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] border cursor-pointer ${mode === 'private' ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)] border-[var(--accent-purple)]' : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>私聊人格</button>
              <label className="ml-auto text-xs text-[var(--text-secondary)] flex items-center gap-2">
                轮次
                <input type="number" min={1} max={5} value={rounds} onChange={(e) => setRounds(Math.max(1, Math.min(5, Number(e.target.value) || 1)))} className="w-20 px-2 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] text-[var(--text-primary)]" />
              </label>
            </div>

            <div>
              <p className="text-xs text-[var(--text-muted)] mb-2">参评人格（至少 2 个）</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                {personalityList.map((item, index) => (
                  <label key={`${mode}-${index}`} className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] cursor-pointer">
                    <input type="checkbox" checked={selectedCandidateIndexes.includes(index)} onChange={() => toggleIndex(index, selectedCandidateIndexes, setSelectedCandidateIndexes)} />
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--text-primary)] truncate">#{index} {item.remark}</p>
                      <p className="text-[11px] text-[var(--text-muted)] line-clamp-2">{item.prompt || '（空提示词）'}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs text-[var(--text-muted)] mb-2">API 节点（固定节点，不走智能路由）</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                {apiNodes.map((item) => (
                  <label key={item.index} className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] cursor-pointer">
                    <input type="checkbox" checked={selectedApiIndexes.includes(item.index)} onChange={() => toggleIndex(item.index, selectedApiIndexes, setSelectedApiIndexes)} />
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--text-primary)] truncate">#{item.index} {item.remark}</p>
                      <p className="text-[11px] text-[var(--text-muted)] truncate">{item.modelName} / {item.aiType}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="测试用例集" subtitle="每个用例包含名称、标签、上下文（可选）与最新用户消息（必填）。" icon="📝">
          <div className="space-y-3">
            {cases.map((item) => (
              <div key={item.id} className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-2">
                <div className="flex gap-2">
                  <input value={item.name} onChange={(e) => updateCase(item.id, { name: e.target.value })} placeholder="用例名称" className="flex-1 px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] text-sm text-[var(--text-primary)]" />
                  <button onClick={() => duplicateCase(item.id)} className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] cursor-pointer">复制</button>
                  <button onClick={() => setCases((items) => items.length <= 1 ? items : items.filter((x) => x.id !== item.id))} className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[rgba(255,82,82,0.12)] text-[var(--error)] cursor-pointer">删除</button>
                </div>
                <input value={item.tags.join(', ')} onChange={(e) => updateCase(item.id, { tags: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="标签，逗号分隔" className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] text-sm text-[var(--text-primary)]" />
                <textarea value={item.contextText ?? ''} onChange={(e) => updateCase(item.id, { contextText: e.target.value })} placeholder="上下文文本（可选）" rows={3} className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] text-sm text-[var(--text-primary)] resize-y" />
                <textarea value={item.latestUserMessage} onChange={(e) => updateCase(item.id, { latestUserMessage: e.target.value })} placeholder="最新用户消息（必填）" rows={3} className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] text-sm text-[var(--text-primary)] resize-y" />
              </div>
            ))}
            <button onClick={() => setCases((items) => [...items, makeCase()])} className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white cursor-pointer">+ 新增用例</button>
          </div>
        </Panel>
      </div>

      <div className={`grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] ${densityClass}`}>
        <Panel title="执行与进度" subtitle="运行后会按受控并发批量执行，并把实验结果落盘到 EXE 同级数据目录。" icon="⚙️">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
              <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">人格 {selectedCandidates.length}</span>
              <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">API {selectedApis.length}</span>
              <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">用例 {cases.length}</span>
              <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">轮次 {rounds}</span>
              <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">总任务 {matrixTotal}</span>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-xs space-y-1 text-[var(--text-secondary)]">
              <p>规模限制：API ≤ {MAX_API_COUNT}、人格 ≤ {MAX_CANDIDATE_COUNT}、用例 ≤ {MAX_CASE_COUNT}、轮次 ≤ {MAX_ROUNDS}、总任务 ≤ {MAX_TOTAL_RUNS}</p>
              {scaleBlocked ? (
                <p className="text-[var(--warning)]">当前不可运行：{scaleWarnings.join('；')}</p>
              ) : (
                <p className="text-[var(--text-muted)]">当前规模在可执行范围内。</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button onClick={runExperiment} disabled={busy === 'run' || scaleBlocked} className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white disabled:opacity-60 cursor-pointer">{busy === 'run' ? '运行中...' : '开始实验'}</button>
              {progress && <span className="text-xs text-[var(--text-muted)]">已完成 {progress.done}/{progress.total} · 成功 {progress.ok} · 失败 {progress.failed}</span>}
            </div>

            {progress && (
              <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-2">
                <div className="h-2 rounded-full bg-[var(--surface-card)] overflow-hidden">
                  <div className="h-full bg-[var(--accent-purple)]" style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }} />
                </div>
                {progress.last && (
                  <p className="text-xs text-[var(--text-secondary)]">
                    最近完成：{progress.last.candidateLabel} @ {progress.last.apiLabel} · {progress.last.caseName} · 第 {progress.last.round} 轮 · {progress.last.ok ? '成功' : '失败'} · {progress.last.latencyMs}ms
                  </p>
                )}
              </div>
            )}
          </div>
        </Panel>

        <Panel title="实验记录" subtitle="最近实验可直接回看与删除；进入后可继续补打分。" icon="🗂️">
          <div className="space-y-3">
            <SearchBar value={historySearch} onChange={setHistorySearch} placeholder="搜索实验 ID 或模式..." />
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {filteredHistory.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">暂无实验记录。</p>
              ) : filteredHistory.map((item) => (
                <div key={item.id} className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--text-primary)] truncate">{item.id}</p>
                      <p className="text-[11px] text-[var(--text-muted)] mt-1">{item.mode} · API {item.apiCount} · 人格 {item.candidateCount} · 用例 {item.caseCount}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">任务 {item.totalRuns} · 已评分 {item.scoredRuns} · {formatTime(item.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => void loadExperiment(item.id)} className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] cursor-pointer">加载</button>
                      <button onClick={() => setDeleteTarget(item)} className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[rgba(255,82,82,0.12)] text-[var(--error)] cursor-pointer">删除</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <div className={`grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] ${densityClass}`}>
        <Panel title="评分与结果" subtitle="按单条输出打分。每维 1~5 分，保存后会写回实验记录。" icon="⭐">
          {!activeExperiment ? (
            <p className="text-sm text-[var(--text-muted)]">先从右侧“实验记录”加载一个实验。</p>
          ) : (
            <div className="space-y-3">
              <SearchBar value={runSearch} onChange={setRunSearch} placeholder="搜索人格 / API / 用例 / 输出内容..." />
              <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-3">
                <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                  {filteredRuns.map((run) => {
                    const caseItem = activeExperiment.cases.find((item) => item.id === run.caseId);
                    const isActive = runKeyString(run) === runKeyString(activeRun ?? run);
                    return (
                      <button
                        key={runKeyString(run)}
                        onClick={() => setSelectedRunKey(runKeyString(run))}
                        className={`w-full text-left rounded-[var(--radius-sm)] border p-3 cursor-pointer ${isActive ? 'border-[var(--accent-purple)] bg-[var(--nav-active-bg)]' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'}`}
                      >
                        <p className="text-sm text-[var(--text-primary)] truncate">{run.candidate.remark} @ {run.apiNode.remark}</p>
                        <p className="text-[11px] text-[var(--text-muted)] mt-1">{caseItem?.name ?? run.caseId} · 第 {run.round} 轮 · {run.result.ok ? '成功' : '失败'}</p>
                      </button>
                    );
                  })}
                </div>

                <div>
                  {activeRun ? (
                    <RunScoreEditor
                      run={activeRun}
                      caseName={activeExperiment.cases.find((item) => item.id === activeRun.caseId)?.name ?? activeRun.caseId}
                      onSave={saveScore}
                    />
                  ) : (
                    <p className="text-sm text-[var(--text-muted)]">没有匹配的运行记录。</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="统计摘要" subtitle="当前先提供 MVP 基础统计：按人格、按 API、按人格×API 的平均分与人格胜场。仅统计已评分输出。" icon="📈">
          {!activeExperiment ? (
            <p className="text-sm text-[var(--text-muted)]">加载实验后即可查看统计摘要。</p>
          ) : (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-2">按人格</h4>
                <div className="space-y-2">
                  {stats.byCandidate.length === 0 ? <p className="text-sm text-[var(--text-muted)]">暂无已评分结果。</p> : stats.byCandidate.map((item) => (
                    <div key={item.label} className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-[var(--text-primary)] truncate">{item.label}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">样本 {item.count} · 胜场 {item.wins}</p>
                      </div>
                      <span className="text-sm font-semibold text-[var(--accent-purple)]">{item.avg.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-2">按 API</h4>
                <div className="space-y-2">
                  {stats.byApi.length === 0 ? <p className="text-sm text-[var(--text-muted)]">暂无已评分结果。</p> : stats.byApi.map((item) => (
                    <div key={item.label} className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-[var(--text-primary)] truncate">{item.label}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">样本 {item.count}</p>
                      </div>
                      <span className="text-sm font-semibold text-[var(--accent-purple)]">{item.avg.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-2">人格 × API 组合</h4>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {stats.byCombo.length === 0 ? <p className="text-sm text-[var(--text-muted)]">暂无已评分结果。</p> : stats.byCombo.map((item) => (
                    <div key={item.label} className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-[var(--text-primary)] truncate">{item.label}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">样本 {item.count}</p>
                      </div>
                      <span className="text-sm font-semibold text-[var(--accent-purple)]">{item.avg.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) void deleteExperiment(deleteTarget.id); }}
        title="删除评测实验"
        message={`确认删除实验 ${deleteTarget?.id ?? ''} 吗？此操作不可撤销。`}
        confirmText="删除"
      />
    </div>
  );
}

function RunScoreEditor({
  run,
  caseName,
  onSave,
}: {
  run: PersonalityEvalRunRecord;
  caseName: string;
  onSave: (run: PersonalityEvalRunRecord, dims: Record<PersonalityEvalDimensionKey, number>, note: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [dims, setDims] = useState<Record<PersonalityEvalDimensionKey, number>>({
    style: run.score?.dims.style ?? 3,
    stability: run.score?.dims.stability ?? 3,
    completion: run.score?.dims.completion ?? 3,
    humanlikeness: run.score?.dims.humanlikeness ?? 3,
  });
  const [note, setNote] = useState(run.score?.note ?? '');

  useEffect(() => {
    setDims({
      style: run.score?.dims.style ?? 3,
      stability: run.score?.dims.stability ?? 3,
      completion: run.score?.dims.completion ?? 3,
      humanlikeness: run.score?.dims.humanlikeness ?? 3,
    });
    setNote(run.score?.note ?? '');
    setSaving(false);
  }, [run]);

  return (
    <div className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">{run.candidate.remark} @ {run.apiNode.remark}</p>
        <p className="text-[11px] text-[var(--text-muted)] mt-1">{caseName} · 第 {run.round} 轮 · HTTP {run.result.httpStatus || 0} · {run.result.latencyMs}ms</p>
      </div>

      <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3 max-h-64 overflow-y-auto">
        <pre className="whitespace-pre-wrap text-xs text-[var(--text-secondary)] leading-relaxed">{run.result.responseText || run.result.error || '（无输出）'}</pre>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {PERSONA_EVAL_DIMENSIONS.map((dim) => (
          <label key={dim.key} className="text-xs text-[var(--text-secondary)] space-y-1">
            <span>{dim.label}</span>
            <input
              type="number"
              min={1}
              max={5}
              value={dims[dim.key]}
              onChange={(e) => setDims((prev) => ({ ...prev, [dim.key]: Math.max(1, Math.min(5, Number(e.target.value) || 1)) }))}
              className="w-full px-2 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] text-[var(--text-primary)]"
            />
          </label>
        ))}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="备注（可选）"
        rows={4}
        className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] text-sm text-[var(--text-primary)] resize-y"
      />

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--text-muted)]">总分：{PERSONA_EVAL_DIMENSIONS.reduce((sum, dim) => sum + dims[dim.key], 0)}</span>
        <button
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(run, dims, note);
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving}
          className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white cursor-pointer disabled:opacity-60"
        >
          {saving ? '保存中...' : '保存评分'}
        </button>
      </div>
    </div>
  );
}
