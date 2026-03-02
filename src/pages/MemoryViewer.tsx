import { useState, useEffect, useMemo } from 'react';
import { StatCard } from '../components/common/StatCard';
import { ProgressBar } from '../components/common/ProgressBar';
import { Modal } from '../components/common/Modal';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { SearchBar } from '../components/common/SearchBar';
import { useUiStore } from '../stores/uiStore';
import { getConfig, listMemory, getMemory, saveMemory, deleteMemory } from '../lib/tauri-commands';
import type { MemoryMeta, RuntimeConfig } from '../lib/types';

const MEMORY_CAPACITY = 50;

interface MemoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export function MemoryViewer() {
  const addToast = useUiStore((s) => s.addToast);
  const [loading, setLoading] = useState(true);
  const [groupMemories, setGroupMemories] = useState<MemoryMeta[]>([]);
  const [privateMemories, setPrivateMemories] = useState<MemoryMeta[]>([]);
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null);

  // Detail modal
  const [detail, setDetail] = useState<{ type: 'group' | 'private'; meta: MemoryMeta } | null>(null);
  const [messages, setMessages] = useState<MemoryMessage[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [detailSearch, setDetailSearch] = useState('');
  const [detailDirty, setDetailDirty] = useState(false);

  // Confirm dialogs
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<{ type: 'group' | 'private'; meta: MemoryMeta } | null>(null);
  const [confirmDeleteMsg, setConfirmDeleteMsg] = useState<number | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [gm, pm, rt] = await Promise.all([
        listMemory('group'),
        listMemory('private'),
        getConfig<RuntimeConfig>('runtime'),
      ]);
      setGroupMemories(gm ?? []);
      setPrivateMemories(pm ?? []);
      setRuntime(rt);
    } catch (e: any) {
      addToast('error', `加载失败: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(type: 'group' | 'private', meta: MemoryMeta) {
    try {
      const data = await getMemory(type, meta.id);
      setMessages(Array.isArray(data) ? data : []);
      setDetail({ type, meta });
      setDetailDirty(false);
      setEditingIdx(null);
      setDetailSearch('');
    } catch (e: any) {
      addToast('error', `读取记忆失败: ${e?.message ?? e}`);
    }
  }

  function startEdit(idx: number) {
    setEditingIdx(idx);
    setEditContent(messages[idx].content);
  }

  function saveEditMsg() {
    if (editingIdx === null) return;
    const next = [...messages];
    next[editingIdx] = { ...next[editingIdx], content: editContent };
    setMessages(next);
    setEditingIdx(null);
    setDetailDirty(true);
  }

  function deleteMsg(idx: number) {
    setMessages(messages.filter((_, i) => i !== idx));
    setDetailDirty(true);
    setConfirmDeleteMsg(null);
  }

  function clearAll() {
    setMessages([]);
    setDetailDirty(true);
    setConfirmClear(false);
  }

  async function saveDetail() {
    if (!detail) return;
    try {
      await saveMemory(detail.type, detail.meta.id, messages);
      setDetailDirty(false);
      addToast('success', '记忆已保存');
      load(); // refresh list
    } catch (e: any) {
      addToast('error', `保存失败: ${e?.message ?? e}`);
    }
  }

  async function doDeleteFile() {
    if (!confirmDeleteFile) return;
    try {
      await deleteMemory(confirmDeleteFile.type, confirmDeleteFile.meta.id);
      addToast('success', `已删除记忆 ${confirmDeleteFile.meta.id}`);
      setConfirmDeleteFile(null);
      if (detail?.meta.id === confirmDeleteFile.meta.id) setDetail(null);
      load();
    } catch (e: any) {
      addToast('error', `删除失败: ${e?.message ?? e}`);
    }
  }

  const filteredMessages = useMemo(() => {
    if (!detailSearch.trim()) return messages.map((m, i) => ({ msg: m, idx: i }));
    const q = detailSearch.toLowerCase();
    return messages
      .map((msg, idx) => ({ msg, idx }))
      .filter(({ msg }) => msg.content.toLowerCase().includes(q));
  }, [messages, detailSearch]);

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

  const totalSessions = groupMemories.length + privateMemories.length;
  const totalMsgs = [...groupMemories, ...privateMemories].reduce((s, m) => s + m.count, 0);
  const memorySummary = runtime?.memorySummary;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="总会话数" value={totalSessions} icon="🧠" color="var(--accent-purple)" />
        <StatCard label="总消息数" value={totalMsgs} icon="💬" color="var(--accent-pink)" />
        <StatCard
          label="记忆压缩"
          value={memorySummary?.enabled ? '开启' : '关闭'}
          icon="📦"
          color={memorySummary?.enabled ? 'var(--success)' : 'var(--text-muted)'}
        />
        <StatCard
          label="压缩阈值"
          value={memorySummary?.threshold ?? '-'}
          icon="📏"
          color="var(--info)"
        />
      </div>

      {/* Dual columns */}
      <div className="grid grid-cols-2 gap-4">
        <MemoryList
          title="群聊记忆"
          icon="👥"
          memories={groupMemories}
          type="group"
          onOpen={openDetail}
          onDelete={(meta) => setConfirmDeleteFile({ type: 'group', meta })}
        />
        <MemoryList
          title="私聊记忆"
          icon="👤"
          memories={privateMemories}
          type="private"
          onOpen={openDetail}
          onDelete={(meta) => setConfirmDeleteFile({ type: 'private', meta })}
        />
      </div>

      {/* Detail modal */}
      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.type === 'group' ? '群聊' : '私聊'}记忆 — ${detail.meta.id}` : ''}
        width="680px"
      >
        {detail && (
          <div className="space-y-3">
            {/* Toolbar */}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <SearchBar value={detailSearch} onChange={setDetailSearch} placeholder="搜索消息内容..." />
              </div>
              <button
                onClick={() => setConfirmClear(true)}
                className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[rgba(255,82,82,0.15)] text-[var(--error)] hover:bg-[rgba(255,82,82,0.25)] transition-colors cursor-pointer"
              >
                清空全部
              </button>
              {detailDirty && (
                <button
                  onClick={saveDetail}
                  className="px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 transition-colors cursor-pointer pulse-dirty"
                >
                  💾 保存
                </button>
              )}
            </div>

            {/* Message list */}
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {filteredMessages.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-6">
                  {detailSearch ? '没有匹配的消息' : '暂无消息'}
                </p>
              ) : (
                filteredMessages.map(({ msg, idx }) => {
                  const roleStyle = msg.role === 'user'
                    ? { bg: 'rgba(147,197,253,0.1)', border: 'var(--info)', label: 'user' }
                    : msg.role === 'assistant'
                      ? { bg: 'rgba(14,165,233,0.1)', border: 'var(--accent-purple)', label: 'assistant' }
                      : { bg: 'rgba(124,106,154,0.1)', border: 'var(--text-muted)', label: 'system' };

                  return (
                    <div
                      key={idx}
                      className="p-3 rounded-[var(--radius-sm)] border"
                      style={{ background: roleStyle.bg, borderColor: roleStyle.border }}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                          style={{ color: roleStyle.border, background: `${roleStyle.border}20` }}
                        >
                          {roleStyle.label}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEdit(idx)}
                            className="text-[10px] px-1.5 py-0.5 rounded text-[var(--text-muted)] hover:text-[var(--accent-purple)] hover:bg-[rgba(14,165,233,0.1)] transition-colors cursor-pointer"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => setConfirmDeleteMsg(idx)}
                            className="text-[10px] px-1.5 py-0.5 rounded text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[rgba(255,82,82,0.1)] transition-colors cursor-pointer"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      {editingIdx === idx ? (
                        <div className="space-y-2">
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            rows={4}
                            className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)] resize-none"
                          />
                          <div className="flex gap-1.5">
                            <button
                              onClick={saveEditMsg}
                              className="text-[10px] px-2 py-1 rounded bg-[var(--accent-purple)] text-white hover:opacity-90 cursor-pointer"
                            >
                              确定
                            </button>
                            <button
                              onClick={() => setEditingIdx(null)}
                              className="text-[10px] px-2 py-1 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] cursor-pointer"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                          {msg.content}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <p className="text-xs text-[var(--text-muted)] text-center">
              共 {messages.length} 条消息
            </p>
          </div>
        )}
      </Modal>

      {/* Confirm clear */}
      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearAll}
        title="清空记忆"
        message="确定要清空所有消息吗？保存后才会生效。"
      />

      {/* Confirm delete message */}
      <ConfirmDialog
        open={confirmDeleteMsg !== null}
        onClose={() => setConfirmDeleteMsg(null)}
        onConfirm={() => { if (confirmDeleteMsg !== null) deleteMsg(confirmDeleteMsg); }}
        title="删除消息"
        message="确定要删除这条消息吗？保存后才会生效。"
      />

      {/* Confirm delete file */}
      <ConfirmDialog
        open={confirmDeleteFile !== null}
        onClose={() => setConfirmDeleteFile(null)}
        onConfirm={doDeleteFile}
        title="删除记忆文件"
        message={confirmDeleteFile ? `确定要删除记忆 "${confirmDeleteFile.meta.id}" 吗？此操作不可撤销。` : ''}
      />
    </div>
  );
}

// ===== Sub-components =====

function MemoryList({ title, icon, memories, type, onOpen, onDelete }: {
  title: string;
  icon: string;
  memories: MemoryMeta[];
  type: 'group' | 'private';
  onOpen: (type: 'group' | 'private', meta: MemoryMeta) => void;
  onDelete: (meta: MemoryMeta) => void;
}) {
  const totalMsgs = memories.reduce((s, m) => s + m.count, 0);

  return (
    <div className="bg-white rounded-[var(--radius)] overflow-hidden p-6" style={{ boxShadow: 'var(--shadow-3d)' }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{icon} {title}</h3>
        <span className="text-xs text-[var(--text-muted)]">{memories.length} 个 · {totalMsgs} 条</span>
      </div>

      {memories.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] text-center py-6">暂无记忆数据</p>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {memories.map((m) => (
            <div
              key={m.id}
              className="px-5 py-4 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] hover:border-[var(--accent-purple)] transition-colors cursor-pointer"
              onClick={() => onOpen(type, m)}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-[var(--text-primary)] font-medium">{m.id}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(m); }}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--error)] transition-colors cursor-pointer"
                >
                  删除
                </button>
              </div>
              <ProgressBar value={m.count} max={MEMORY_CAPACITY} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
