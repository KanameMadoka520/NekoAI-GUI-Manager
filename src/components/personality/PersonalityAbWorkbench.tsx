import { useEffect, useMemo, useState } from 'react';
import { Panel } from '../common/Panel';
import { SummaryCard } from '../common/SummaryCard';
import { SearchBar } from '../common/SearchBar';
import { ConfirmDialog } from '../common/ConfirmDialog';
import type {
  ApiNode,
  ApiParams,
  Personality,
  PersonalityAbMode,
  PersonalityAbRecord,
  PersonalityAbRunRequest,
  PersonalityAbTestSummary,
} from '../../lib/types';
import { deletePersonalityAbTest, getPersonalityAbTest, listPersonalityAbTests, runPersonalityAbTest } from '../../lib/tauri-commands';
import { useUiStore } from '../../stores/uiStore';

interface WorkbenchProps {
  groupList: Personality[];
  privateList: Personality[];
  runtimeApiIndex: number;
  apiNodes: (ApiNode & { index: number })[];
  apiParams: ApiParams;
}

export function PersonalityAbWorkbench({ groupList, privateList, runtimeApiIndex, apiNodes, apiParams }: WorkbenchProps) {
  const addToast = useUiStore((s) => s.addToast);
  const [mode, setMode] = useState<PersonalityAbMode>('group');
  const [apiIndex, setApiIndex] = useState(() => Math.max(0, Math.min(runtimeApiIndex, Math.max(0, apiNodes.length - 1))));
  const [candidateAIndex, setCandidateAIndex] = useState(0);
  const [candidateBIndex, setCandidateBIndex] = useState(1);
  const [contextText, setContextText] = useState('');
  const [latestUserMessage, setLatestUserMessage] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PersonalityAbRecord | null>(null);
  const [history, setHistory] = useState<PersonalityAbTestSummary[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyModeFilter, setHistoryModeFilter] = useState<'all' | PersonalityAbMode>('all');
  const [deleteTarget, setDeleteTarget] = useState<PersonalityAbTestSummary | null>(null);

  const personalities = useMemo(() => (mode === 'group' ? groupList : privateList), [mode, groupList, privateList]);
  const selectedApi = apiNodes[apiIndex];
  const currentA = personalities[candidateAIndex];
  const currentB = personalities[candidateBIndex];

  useEffect(() => {
    if (candidateAIndex >= personalities.length) setCandidateAIndex(0);
    if (candidateBIndex >= personalities.length) setCandidateBIndex(Math.min(1, Math.max(0, personalities.length - 1)));
  }, [candidateAIndex, candidateBIndex, personalities.length]);

  useEffect(() => {
    setApiIndex(Math.max(0, Math.min(runtimeApiIndex, Math.max(0, apiNodes.length - 1))));
  }, [runtimeApiIndex, apiNodes.length]);

  async function loadHistory() {
    setHistoryBusy(true);
    try {
      const items = await listPersonalityAbTests(8);
      setHistory(items);
    } catch (e: any) {
      addToast('error', `读取测试记录失败: ${e?.message ?? e}`);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function runTest() {
    if (!selectedApi || !currentA || !currentB) {
      addToast('warning', '请先选择 API 节点与人格 A/B');
      return;
    }
    if (!selectedApi.apiUrl || !selectedApi.apiKey || !selectedApi.modelName) {
      addToast('warning', '所选 API 节点信息不完整，无法执行测试');
      return;
    }
    if (!latestUserMessage.trim()) {
      addToast('warning', '请输入“最新用户消息”后再执行测试');
      return;
    }

    setRunning(true);
    try {
      const payload: PersonalityAbRunRequest = {
        mode,
        apiNode: selectedApi,
        apiParams,
        contextText,
        latestUserMessage,
        candidateA: {
          index: candidateAIndex,
          remark: currentA.remark,
          prompt: currentA.prompt,
        },
        candidateB: {
          index: candidateBIndex,
          remark: currentB.remark,
          prompt: currentB.prompt,
        },
      };
      const data = await runPersonalityAbTest(payload);
      setResult(data);
      addToast('success', '人格 A/B 测试已完成');
      await loadHistory();
    } catch (e: any) {
      addToast('error', `测试失败: ${e?.message ?? e}`);
    } finally {
      setRunning(false);
    }
  }

  async function openHistory(id: string) {
    try {
      const data = await getPersonalityAbTest(id);
      setResult(data);
      addToast('success', `已加载测试记录 ${id}`);
    } catch (e: any) {
      addToast('error', `读取记录失败: ${e?.message ?? e}`);
    }
  }

  async function deleteHistory(id: string) {
    try {
      await deletePersonalityAbTest(id);
      setHistory((items) => items.filter((item) => item.id !== id));
      setResult((prev) => (prev?.id === id ? null : prev));
      addToast('success', `已删除测试记录 ${id}`);
    } catch (e: any) {
      addToast('error', `删除记录失败: ${e?.message ?? e}`);
    }
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  const summaryHint = selectedApi
    ? `${selectedApi.remark || '未备注'} / ${selectedApi.modelName} / ${selectedApi.aiType}`
    : '尚未选择可用 API';
  const filteredHistory = history.filter((item) => {
    if (historyModeFilter !== 'all' && item.mode !== historyModeFilter) return false;
    const q = historySearch.trim().toLowerCase();
    if (!q) return true;
    return [item.pairLabel, item.apiLabel, item.latestUserMessagePreview].some((field) => field.toLowerCase().includes(q));
  });

  return (
    <Panel title="人格 A/B 测试台" subtitle="同一输入、同一 API 节点，对比两个人格输出差异。" icon="🧪" padding="sm">
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-5 gap-3 mb-4">
        <SummaryCard label="测试模式" value={mode === 'group' ? '群聊' : '私聊'} hint="同模式内进行 A/B 对比" tone="info" />
        <SummaryCard label="候选人格数" value={personalities.length} hint="当前模式下可选人格总数" />
        <SummaryCard label="固定 API" value={selectedApi ? `#${apiIndex}` : '未选择'} hint={summaryHint} tone={selectedApi ? 'success' : 'warning'} />
        <SummaryCard label="上下文长度" value={contextText.trim().length} hint="可选，用于模拟历史上下文" />
        <SummaryCard label="最新消息长度" value={latestUserMessage.trim().length} hint="必填，作为最终用户输入" tone={latestUserMessage.trim() ? 'info' : 'warning'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-4">
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-1 block">测试模式</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as PersonalityAbMode)}
                className="w-full px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
              >
                <option value="group">群聊人格</option>
                <option value="private">私聊人格</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-1 block">测试 API 节点</label>
              <select
                value={apiIndex}
                onChange={(e) => setApiIndex(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
              >
                {apiNodes.map((node, index) => (
                  <option key={index} value={index}>{`#${index} ${node.remark || '未备注'} / ${node.modelName}`}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-1 block">人格 A</label>
              <select
                value={candidateAIndex}
                onChange={(e) => setCandidateAIndex(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
              >
                {personalities.map((item, index) => (
                  <option key={`a-${index}`} value={index}>{`#${index} ${item.remark}`}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-1 block">人格 B</label>
              <select
                value={candidateBIndex}
                onChange={(e) => setCandidateBIndex(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
              >
                {personalities.map((item, index) => (
                  <option key={`b-${index}`} value={index}>{`#${index} ${item.remark}`}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] text-[var(--text-muted)] mb-1 block">上下文文本（可选）</label>
            <textarea
              value={contextText}
              onChange={(e) => setContextText(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] resize-y"
              placeholder="可选：填入测试前的对话背景、最近上下文或特殊场景设定。"
            />
          </div>

          <div>
            <label className="text-[10px] text-[var(--text-muted)] mb-1 block">最新用户消息（必填）</label>
            <textarea
              value={latestUserMessage}
              onChange={(e) => setLatestUserMessage(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] resize-y"
              placeholder="示例：请用轻松一点的语气解释一下为什么这次失败了？"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={runTest}
              disabled={running || !selectedApi || personalities.length === 0}
              className={`px-4 py-2 text-sm rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer ${running || !selectedApi || personalities.length === 0 ? 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed' : 'bg-[var(--accent-purple)] text-[var(--on-accent)] hover:opacity-90'}`}
            >
              {running ? '⏳ 测试中...' : '▶ 运行 A/B 测试'}
            </button>
            <button
              onClick={() => {
                setContextText('');
                setLatestUserMessage('');
                setResult(null);
              }}
              className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              清空输入与结果
            </button>
          </div>
        </div>

        <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">最近测试记录</p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">保存在 EXE 同级 `NekoAI-GUI-Data/personality-ab-tests/`。</p>
            </div>
            <button
              onClick={loadHistory}
              disabled={historyBusy}
              className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              {historyBusy ? '刷新中...' : '刷新'}
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
            <SearchBar value={historySearch} onChange={setHistorySearch} placeholder="搜索人格对比、API 或输入摘要..." />
            <select
              value={historyModeFilter}
              onChange={(e) => setHistoryModeFilter(e.target.value as 'all' | PersonalityAbMode)}
              className="w-full px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
            >
              <option value="all">全部模式</option>
              <option value="group">群聊</option>
              <option value="private">私聊</option>
            </select>
          </div>
          <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
            {filteredHistory.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">暂无匹配的测试记录。</p>
            ) : filteredHistory.map((item) => (
              <div
                key={item.id}
                className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    onClick={() => openHistory(item.id)}
                    className="flex-1 text-left min-w-0 hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[var(--text-primary)] truncate">{item.pairLabel}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">{item.mode === 'group' ? '群聊' : '私聊'}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-[var(--text-muted)] truncate">{item.apiLabel}</p>
                    <p className="mt-1 text-[11px] text-[var(--text-secondary)] line-clamp-2">{item.latestUserMessagePreview}</p>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(item);
                    }}
                    className="px-2 py-1 text-[10px] rounded-[var(--radius-sm)] border border-[var(--error-soft-border)] text-[var(--error)] bg-[var(--error-soft-bg)] hover:bg-[color-mix(in_srgb,var(--error)_28%,transparent)] transition-colors cursor-pointer"
                    title="删除测试记录"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ResultCard title="人格 A 输出" candidate={result?.candidateA} outcome={result?.resultA} />
        <ResultCard title="人格 B 输出" candidate={result?.candidateB} outcome={result?.resultB} />
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteHistory(deleteTarget.id);
        }}
        title="删除测试记录"
        message={deleteTarget ? `确定要删除测试记录「${deleteTarget.pairLabel}」吗？` : ''}
      />
    </Panel>
  );
}

function ResultCard({ title, candidate, outcome }: {
  title: string;
  candidate?: PersonalityAbRecord['candidateA'];
  outcome?: PersonalityAbRecord['resultA'];
}) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4" style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">{candidate ? `#${candidate.index} ${candidate.remark} · ${candidate.prompt.length} 字符` : '尚未执行测试'}</p>
        </div>
        {outcome ? (
          <span className={`text-[10px] px-2 py-1 rounded-[var(--radius-pill)] ${outcome.ok ? 'bg-[var(--success-soft-bg)] text-[var(--success)]' : 'bg-[var(--error-soft-bg)] text-[var(--error)]'}`}>
            {outcome.ok ? '成功' : '失败'}
          </span>
        ) : null}
      </div>
      {outcome ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
            <SummaryCard label="耗时" value={`${outcome.latencyMs} ms`} hint="本次请求总耗时" />
            <SummaryCard label="状态" value={outcome.httpStatus || '-'} hint="HTTP 状态码" tone={outcome.ok ? 'success' : 'warning'} />
            <SummaryCard label="回复长度" value={outcome.responseChars} hint="响应字符数" />
          </div>
          <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-3">
            <p className="text-[10px] text-[var(--text-muted)] mb-2">模型输出</p>
            <pre className="whitespace-pre-wrap break-words text-xs text-[var(--text-primary)] leading-relaxed">{outcome.responseText || outcome.error || '(空结果)'}</pre>
          </div>
        </>
      ) : (
        <p className="text-xs text-[var(--text-muted)]">执行一次测试后，这里会显示该人格在指定 API 节点下的输出结果。</p>
      )}
    </div>
  );
}
