import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SearchBar } from '../components/common/SearchBar';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { useUiStore } from '../stores/uiStore';
import { useUndoRedo } from '../hooks/useUndoRedo';
import { getConfig, saveConfig, pingApi, batchPingApis } from '../lib/tauri-commands';
import type { ApiNode, RuntimeConfig, PingResult } from '../lib/types';

interface NodeState {
  nodes: ApiNode[];
  activeIndex: number;
}

export function ApiManager() {
  const addToast = useUiStore((s) => s.addToast);
  const { state, set, reset, undo, redo, canUndo, canRedo } = useUndoRedo<NodeState>({ nodes: [], activeIndex: 0 });
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pingResults, setPingResults] = useState<Map<number, PingResult>>(new Map());
  const [pinging, setPinging] = useState<Set<number>>(new Set());
  const [showKey, setShowKey] = useState<Set<number>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [batchPinging, setBatchPinging] = useState(false);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const { nodes, activeIndex } = state;
  const dirty = useMemo(() => JSON.stringify(state) !== original, [state, original]);

  useEffect(() => { load(); }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, state, original]);

  async function load() {
    setLoading(true);
    try {
      const [apiData, rt] = await Promise.all([
        getConfig<ApiNode[]>('api'),
        getConfig<RuntimeConfig>('runtime'),
      ]);
      const initial: NodeState = {
        nodes: apiData ?? [],
        activeIndex: rt?.activeApiIndex ?? 0,
      };
      reset(initial);
      setOriginal(JSON.stringify(initial));
      setSelected(new Set());
      setPingResults(new Map());
    } catch (e: any) {
      addToast('error', `加载失败: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  function updateNode(index: number, field: keyof ApiNode, value: string) {
    const next = [...nodes];
    next[index] = { ...next[index], [field]: value };
    set({ ...state, nodes: next });
  }

  function removeNode(index: number) {
    const next = nodes.filter((_, i) => i !== index);
    set({ ...state, nodes: next, activeIndex: Math.min(activeIndex, Math.max(0, next.length - 1)) });
  }

  function cloneNode(index: number) {
    const next = [...nodes];
    next.splice(index + 1, 0, { ...nodes[index], remark: `${nodes[index].remark} (副本)` });
    set({ ...state, nodes: next });
  }

  function insertAfter(index: number) {
    const next = [...nodes];
    next.splice(index + 1, 0, { apiUrl: '', apiKey: '', modelName: '', remark: '新节点', aiType: 'openai' });
    set({ ...state, nodes: next });
  }

  function deleteBulk() {
    const next = nodes.filter((_, i) => !selected.has(i));
    set({ ...state, nodes: next, activeIndex: Math.min(activeIndex, Math.max(0, next.length - 1)) });
    setSelected(new Set());
    setConfirmBulkDelete(false);
    addToast('success', `已删除 ${selected.size} 个节点`);
  }

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = Number(active.id);
    const newIndex = Number(over.id);
    const reordered = arrayMove(nodes, oldIndex, newIndex);
    // Adjust active index
    let newActive = activeIndex;
    if (activeIndex === oldIndex) newActive = newIndex;
    else if (oldIndex < activeIndex && newIndex >= activeIndex) newActive = activeIndex - 1;
    else if (oldIndex > activeIndex && newIndex <= activeIndex) newActive = activeIndex + 1;
    set({ nodes: reordered, activeIndex: newActive });
  }, [nodes, activeIndex, set]);

  async function testNode(index: number) {
    const node = nodes[index];
    if (!node.apiUrl || !node.apiKey || !node.modelName) {
      addToast('warning', '请先填写完整的 URL、Key 和模型名');
      return;
    }
    setPinging((p) => new Set(p).add(index));
    try {
      const result = await pingApi(node.apiUrl, node.apiKey, node.modelName, node.aiType);
      setPingResults((m) => new Map(m).set(index, { ...result, index }));
    } catch (e: any) {
      setPingResults((m) => new Map(m).set(index, { index, pass: false, latency_ms: 0, status: 0, error: String(e) }));
    } finally {
      setPinging((p) => { const n = new Set(p); n.delete(index); return n; });
    }
  }

  async function testAll() {
    if (nodes.length === 0) return;
    setBatchPinging(true);
    try {
      const payload = nodes.map((n, i) => ({
        index: i, api_url: n.apiUrl, api_key: n.apiKey, model_name: n.modelName, ai_type: n.aiType,
      }));
      const results = await batchPingApis(payload);
      const map = new Map<number, PingResult>();
      results.forEach((r) => map.set(r.index, r));
      setPingResults(map);
      const passed = results.filter((r) => r.pass).length;
      addToast('success', `批量测试完成: ${passed}/${results.length} 通过`);
    } catch (e: any) {
      addToast('error', `批量测试失败: ${e?.message ?? e}`);
    } finally {
      setBatchPinging(false);
    }
  }

  async function save() {
    if (!dirty) return;
    try {
      await saveConfig('api', nodes);
      // Also update active index in runtime config
      const rt = await getConfig<RuntimeConfig>('runtime');
      if (rt) {
        await saveConfig('runtime', { ...rt, activeApiIndex: activeIndex });
      }
      setOriginal(JSON.stringify(state));
      addToast('success', 'API 配置已保存');
    } catch (e: any) {
      addToast('error', `保存失败: ${e?.message ?? e}`);
    }
  }

  function scrollToNode(index: number) {
    cardRefs.current.get(index)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Duplicate detection
  const duplicates = useMemo(() => {
    const seen = new Map<string, number[]>();
    nodes.forEach((n, i) => {
      const key = `${n.apiUrl}|${n.modelName}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(i);
    });
    const dupes = new Set<number>();
    seen.forEach((indices) => { if (indices.length > 1) indices.forEach((i) => dupes.add(i)); });
    return dupes;
  }, [nodes]);

  // Search filtered indices
  const filteredIndices = useMemo(() => {
    if (!search.trim()) return nodes.map((_, i) => i);
    const q = search.toLowerCase();
    return nodes
      .map((n, i) => ({ n, i }))
      .filter(({ n }) =>
        n.modelName.toLowerCase().includes(q) ||
        n.remark.toLowerCase().includes(q) ||
        n.aiType.toLowerCase().includes(q)
      )
      .map(({ i }) => i);
  }, [nodes, search]);

  // Group by provider (from remark)
  const grouped = useMemo(() => {
    const groups = new Map<string, number[]>();
    filteredIndices.forEach((i) => {
      const remark = nodes[i].remark || '未分类';
      const provider = remark.split(/[-_/\\|]/).map(s => s.trim())[0] || '未分类';
      if (!groups.has(provider)) groups.set(provider, []);
      groups.get(provider)!.push(i);
    });
    return groups;
  }, [filteredIndices, nodes]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <span className="text-4xl block mb-3 animate-bounce">🐱</span>
          <p className="text-[var(--text-secondary)]">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-full">
      {/* Left navigation panel */}
      <div className="w-56 flex-shrink-0 flex flex-col bg-white rounded-[var(--radius)] overflow-hidden" style={{ boxShadow: 'var(--shadow-3d)' }}>
        <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
          <SearchBar value={search} onChange={setSearch} placeholder="搜索模型/备注..." />
          <div className="mt-2 flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>{filteredIndices.length}/{nodes.length} 个节点</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {Array.from(grouped.entries()).map(([provider, indices]) => (
            <div key={provider}>
              <p className="text-[10px] text-[var(--text-muted)] px-2 pt-2 pb-1 uppercase">{provider}</p>
              {indices.map((i) => {
                const n = nodes[i];
                const ping = pingResults.get(i);
                return (
                  <button
                    key={i}
                    onClick={() => scrollToNode(i)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-colors cursor-pointer
                      ${i === activeIndex
                        ? 'bg-[rgba(14,165,233,0.15)] text-[var(--accent-purple)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
                      }`}
                  >
                    <span className="text-[var(--text-muted)] mono w-5 text-right">#{i}</span>
                    <span className="flex-1 truncate">{n.modelName || '(空)'}</span>
                    {ping && (
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: ping.pass ? 'var(--success)' : 'var(--error)' }}
                        title={ping.pass ? `${ping.latency_ms}ms` : ping.error || `HTTP ${ping.status}`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Right content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs">
            <label className="text-[var(--text-muted)]">活跃节点:</label>
            <input
              type="number"
              value={activeIndex}
              onChange={(e) => set({ ...state, activeIndex: Math.max(0, Math.min(nodes.length - 1, Number(e.target.value))) })}
              min={0}
              max={Math.max(0, nodes.length - 1)}
              className="w-16 px-2 py-1 text-xs mono rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
            />
          </div>
          <div className="flex-1" />

          <button onClick={undo} disabled={!canUndo}
            className={`px-2 py-1 text-xs rounded-[var(--radius-sm)] cursor-pointer transition-colors ${canUndo ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]' : 'text-[var(--text-muted)] cursor-not-allowed opacity-40'}`}
            title="Ctrl+Z">↩ 撤销</button>
          <button onClick={redo} disabled={!canRedo}
            className={`px-2 py-1 text-xs rounded-[var(--radius-sm)] cursor-pointer transition-colors ${canRedo ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]' : 'text-[var(--text-muted)] cursor-not-allowed opacity-40'}`}
            title="Ctrl+Y">↪ 重做</button>

          <button onClick={testAll} disabled={batchPinging}
            className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
            {batchPinging ? '⏳ 测试中...' : '🔍 全部测试'}
          </button>

          <button onClick={() => set({ ...state, nodes: [...nodes, { apiUrl: '', apiKey: '', modelName: '', remark: '', aiType: 'openai' }] })}
            className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--accent-purple)] hover:bg-[var(--border-subtle)] transition-colors cursor-pointer">
            + 新增
          </button>

          {selected.size > 0 && (
            <>
              <span className="text-xs text-[var(--text-muted)]">选中 {selected.size}</span>
              <button onClick={() => setConfirmBulkDelete(true)}
                className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[rgba(255,82,82,0.15)] text-[var(--error)] hover:bg-[rgba(255,82,82,0.25)] transition-colors cursor-pointer">
                批量删除
              </button>
            </>
          )}

          <button onClick={save} disabled={!dirty}
            className={`px-4 py-1.5 text-xs rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer
              ${dirty ? 'bg-[var(--accent-purple)] text-white hover:opacity-90 pulse-dirty' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'}`}
            title="Ctrl+S">
            💾 保存
          </button>
        </div>

        {/* Node cards */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {nodes.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-[var(--text-muted)]">暂无 API 节点，点击"新增"添加</p>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={nodes.map((_, i) => i)} strategy={verticalListSortingStrategy}>
                {nodes.map((node, i) => (
                  <SortableNodeCard
                    key={i}
                    id={i}
                    node={node}
                    index={i}
                    isActive={i === activeIndex}
                    isDuplicate={duplicates.has(i)}
                    isSelected={selected.has(i)}
                    isPinging={pinging.has(i)}
                    pingResult={pingResults.get(i)}
                    showKey={showKey.has(i)}
                    onUpdate={updateNode}
                    onRemove={removeNode}
                    onClone={cloneNode}
                    onInsert={insertAfter}
                    onTest={testNode}
                    onSetActive={(idx) => set({ ...state, activeIndex: idx })}
                    onToggleSelect={(idx) => {
                      const next = new Set(selected);
                      if (next.has(idx)) next.delete(idx); else next.add(idx);
                      setSelected(next);
                    }}
                    onToggleKey={(idx) => {
                      const next = new Set(showKey);
                      if (next.has(idx)) next.delete(idx); else next.add(idx);
                      setShowKey(next);
                    }}
                    cardRef={(el) => { if (el) cardRefs.current.set(i, el); else cardRefs.current.delete(i); }}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      {/* Confirm bulk delete */}
      <ConfirmDialog
        open={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={deleteBulk}
        title="批量删除"
        message={`确定要删除选中的 ${selected.size} 个节点吗？`}
      />
    </div>
  );
}

// ===== Sortable Node Card =====

function SortableNodeCard({ id, node, index, isActive, isDuplicate, isSelected, isPinging, pingResult, showKey,
  onUpdate, onRemove, onClone, onInsert, onTest, onSetActive, onToggleSelect, onToggleKey, cardRef,
}: {
  id: number;
  node: ApiNode;
  index: number;
  isActive: boolean;
  isDuplicate: boolean;
  isSelected: boolean;
  isPinging: boolean;
  pingResult?: PingResult;
  showKey: boolean;
  onUpdate: (i: number, field: keyof ApiNode, value: string) => void;
  onRemove: (i: number) => void;
  onClone: (i: number) => void;
  onInsert: (i: number) => void;
  onTest: (i: number) => void;
  onSetActive: (i: number) => void;
  onToggleSelect: (i: number) => void;
  onToggleKey: (i: number) => void;
  cardRef: (el: HTMLDivElement | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={(el) => { setNodeRef(el); cardRef(el); }}
      style={{ ...style, boxShadow: 'var(--shadow-3d)', transitionTimingFunction: 'var(--ease-spring)' }}
      className={`bg-white rounded-[var(--radius)] p-5 transition-all duration-[400ms] overflow-hidden
        ${isActive ? 'ring-2 ring-[var(--accent-purple)]' : ''}
        ${isSelected ? 'bg-[rgba(14,165,233,0.04)]' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(index)}
          className="accent-[var(--accent-purple)] cursor-pointer"
        />
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          ⠿
        </div>
        <span className="text-xs mono text-[var(--text-muted)]">#{index}</span>
        <span className="text-sm font-medium text-[var(--text-primary)] flex-1 truncate">
          {node.modelName || '(未命名)'}
        </span>

        {/* Badges */}
        {isActive && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-purple)] text-white">活跃</span>
        )}
        {isDuplicate && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(255,171,64,0.2)] text-[var(--warning)]">重复</span>
        )}
        {pingResult && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background: pingResult.pass ? 'rgba(0,230,118,0.15)' : 'rgba(255,82,82,0.15)',
              color: pingResult.pass ? 'var(--success)' : 'var(--error)',
            }}
          >
            {pingResult.pass ? `${pingResult.latency_ms}ms` : `失败 ${pingResult.status || ''}`}
          </span>
        )}
        <span
          className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-elevated)]"
          style={{ color: node.aiType === 'openai' ? 'var(--success)' : node.aiType === 'gemini' ? 'var(--info)' : 'var(--accent-pink)' }}
        >
          {node.aiType}
        </span>
      </div>

      {/* Fields */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[10px] text-[var(--text-muted)] mb-1 block">接口类型</label>
          <select
            value={node.aiType}
            onChange={(e) => onUpdate(index, 'aiType', e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)] cursor-pointer"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-[var(--text-muted)] mb-1 block">备注</label>
          <input
            value={node.remark}
            onChange={(e) => onUpdate(index, 'remark', e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
            placeholder="备注"
          />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-[var(--text-muted)] mb-1 block">API URL</label>
          <input
            value={node.apiUrl}
            onChange={(e) => onUpdate(index, 'apiUrl', e.target.value)}
            className={`w-full px-2.5 py-1.5 text-xs mono rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]
              ${!node.apiUrl ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'}`}
            placeholder="https://api.example.com/v1/chat/completions"
          />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-[var(--text-muted)] mb-1 block">API Key</label>
          <div className="flex gap-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={node.apiKey}
              onChange={(e) => onUpdate(index, 'apiKey', e.target.value)}
              className="flex-1 px-2.5 py-1.5 text-xs mono rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
              placeholder="sk-..."
            />
            <button
              onClick={() => onToggleKey(index)}
              className="px-2 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              title={showKey ? '隐藏' : '显示'}
            >
              {showKey ? '🙈' : '👁'}
            </button>
          </div>
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-[var(--text-muted)] mb-1 block">模型名称</label>
          <input
            value={node.modelName}
            onChange={(e) => onUpdate(index, 'modelName', e.target.value)}
            className={`w-full px-2.5 py-1.5 text-xs mono rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]
              ${!node.modelName ? 'border-[var(--error)]' : 'border-[var(--border-subtle)]'}`}
            placeholder="gpt-4"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <button onClick={() => onTest(index)} disabled={isPinging}
          className="px-2.5 py-1 text-[10px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
          {isPinging ? '⏳' : '🔍'} 测试
        </button>
        <button onClick={() => onClone(index)}
          className="px-2.5 py-1 text-[10px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
          📋 克隆
        </button>
        <button onClick={() => onInsert(index)}
          className="px-2.5 py-1 text-[10px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
          ➕ 插入
        </button>
        {!isActive && (
          <button onClick={() => onSetActive(index)}
            className="px-2.5 py-1 text-[10px] rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--success)] hover:bg-[rgba(0,230,118,0.1)] transition-colors cursor-pointer">
            ⚡ 启用
          </button>
        )}
        <div className="flex-1" />
        <button onClick={() => onRemove(index)}
          className="px-2.5 py-1 text-[10px] rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[rgba(255,82,82,0.1)] transition-colors cursor-pointer">
          🗑 移除
        </button>
      </div>
    </div>
  );
}
