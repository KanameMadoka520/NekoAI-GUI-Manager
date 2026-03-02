import { useState, useEffect, useMemo } from 'react';
import { StatCard } from '../components/common/StatCard';
import { SearchBar } from '../components/common/SearchBar';
import { Modal } from '../components/common/Modal';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { useUiStore } from '../stores/uiStore';
import { getConfig, saveConfig } from '../lib/tauri-commands';
import type { Personality, RuntimeConfig } from '../lib/types';

export function PersonalityManager() {
  const addToast = useUiStore((s) => s.addToast);
  const [groupList, setGroupList] = useState<Personality[]>([]);
  const [privateList, setPrivateList] = useState<Personality[]>([]);
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null);
  const [origGroup, setOrigGroup] = useState<string>('');
  const [origPrivate, setOrigPrivate] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Edit modal state
  const [editTarget, setEditTarget] = useState<{ side: 'group' | 'private'; index: number } | null>(null);
  const [editRemark, setEditRemark] = useState('');
  const [editPrompt, setEditPrompt] = useState('');

  // Confirm delete
  const [deleteTarget, setDeleteTarget] = useState<{ side: 'group' | 'private'; index: number } | null>(null);

  const dirtyGroup = useMemo(() => JSON.stringify(groupList) !== origGroup, [groupList, origGroup]);
  const dirtyPrivate = useMemo(() => JSON.stringify(privateList) !== origPrivate, [privateList, origPrivate]);
  const dirty = dirtyGroup || dirtyPrivate;

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [gp, pp, rt] = await Promise.all([
        getConfig<Personality[]>('groupPersonality'),
        getConfig<Personality[]>('privatePersonality'),
        getConfig<RuntimeConfig>('runtime'),
      ]);
      const g = gp ?? [];
      const p = pp ?? [];
      setGroupList(g);
      setPrivateList(p);
      setOrigGroup(JSON.stringify(g));
      setOrigPrivate(JSON.stringify(p));
      setRuntime(rt);
    } catch (e: any) {
      addToast('error', `加载失败: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  function openEdit(side: 'group' | 'private', index: number) {
    const list = side === 'group' ? groupList : privateList;
    setEditTarget({ side, index });
    setEditRemark(list[index].remark);
    setEditPrompt(list[index].prompt);
  }

  function saveEdit() {
    if (!editTarget) return;
    const { side, index } = editTarget;
    const updated: Personality = { remark: editRemark, prompt: editPrompt };
    if (side === 'group') {
      const next = [...groupList];
      next[index] = updated;
      setGroupList(next);
    } else {
      const next = [...privateList];
      next[index] = updated;
      setPrivateList(next);
    }
    setEditTarget(null);
  }

  function addPersonality(side: 'group' | 'private') {
    const newP: Personality = { remark: '新人格', prompt: '' };
    if (side === 'group') {
      setGroupList([...groupList, newP]);
    } else {
      setPrivateList([...privateList, newP]);
    }
  }

  function clonePersonality(side: 'group' | 'private', index: number) {
    const list = side === 'group' ? groupList : privateList;
    const cloned = { ...list[index], remark: `${list[index].remark} (副本)` };
    if (side === 'group') {
      const next = [...groupList];
      next.splice(index + 1, 0, cloned);
      setGroupList(next);
    } else {
      const next = [...privateList];
      next.splice(index + 1, 0, cloned);
      setPrivateList(next);
    }
  }

  function confirmDeletePersonality() {
    if (!deleteTarget) return;
    const { side, index } = deleteTarget;
    if (side === 'group') {
      setGroupList(groupList.filter((_, i) => i !== index));
    } else {
      setPrivateList(privateList.filter((_, i) => i !== index));
    }
    setDeleteTarget(null);
  }

  async function setActive(side: 'group' | 'private', index: number) {
    if (!runtime) return;
    const key = side === 'group' ? 'activeGroupPersonalityIndex' : 'activePrivatePersonalityIndex';
    const updated = { ...runtime, [key]: index };
    try {
      await saveConfig('runtime', updated);
      setRuntime(updated);
      addToast('success', `已切换${side === 'group' ? '群聊' : '私聊'}活跃人格为 #${index}`);
    } catch (e: any) {
      addToast('error', `切换失败: ${e?.message ?? e}`);
    }
  }

  async function save() {
    try {
      if (dirtyGroup) await saveConfig('groupPersonality', groupList);
      if (dirtyPrivate) await saveConfig('privatePersonality', privateList);
      setOrigGroup(JSON.stringify(groupList));
      setOrigPrivate(JSON.stringify(privateList));
      addToast('success', '人格列表已保存');
    } catch (e: any) {
      addToast('error', `保存失败: ${e?.message ?? e}`);
    }
  }

  function filterList(list: Personality[]): { item: Personality; origIndex: number }[] {
    if (!search.trim()) return list.map((item, origIndex) => ({ item, origIndex }));
    const q = search.toLowerCase();
    return list
      .map((item, origIndex) => ({ item, origIndex }))
      .filter(({ item }) =>
        item.remark.toLowerCase().includes(q) || item.prompt.toLowerCase().includes(q)
      );
  }

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

  const activeGroupIdx = runtime?.activeGroupPersonalityIndex ?? 0;
  const activePrivateIdx = runtime?.activePrivatePersonalityIndex ?? 0;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="群聊人格数" value={groupList.length} icon="👥" color="var(--accent-purple)" />
        <StatCard label="私聊人格数" value={privateList.length} icon="👤" color="var(--accent-pink)" />
        <StatCard label="群聊活跃" value={`#${activeGroupIdx}`} icon="⚡" color="var(--success)" />
        <StatCard label="私聊活跃" value={`#${activePrivateIdx}`} icon="⚡" color="var(--info)" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <SearchBar value={search} onChange={setSearch} placeholder="搜索人格名称或提示词..." />
        </div>
        <button
          onClick={save}
          disabled={!dirty}
          className={`px-4 py-2 text-sm rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer
            ${dirty
              ? 'bg-[var(--accent-purple)] text-white hover:opacity-90 pulse-dirty'
              : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'
            }`}
        >
          💾 保存
        </button>
      </div>

      {/* Dual column */}
      <div className="grid grid-cols-2 gap-4">
        <PersonalityColumn
          title="群聊人格"
          icon="👥"
          items={filterList(groupList)}
          activeIndex={activeGroupIdx}
          side="group"
          onEdit={openEdit}
          onClone={clonePersonality}
          onDelete={(i) => setDeleteTarget({ side: 'group', index: i })}
          onSetActive={setActive}
          onAdd={() => addPersonality('group')}
        />
        <PersonalityColumn
          title="私聊人格"
          icon="👤"
          items={filterList(privateList)}
          activeIndex={activePrivateIdx}
          side="private"
          onEdit={openEdit}
          onClone={clonePersonality}
          onDelete={(i) => setDeleteTarget({ side: 'private', index: i })}
          onSetActive={setActive}
          onAdd={() => addPersonality('private')}
        />
      </div>

      {/* Edit modal */}
      <Modal
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title={`编辑人格 #${editTarget?.index ?? 0}`}
        width="560px"
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">名称/备注</label>
            <input
              value={editRemark}
              onChange={(e) => setEditRemark(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-[var(--text-muted)]">系统提示词</label>
              <span className="text-xs text-[var(--text-muted)] mono">{editPrompt.length} 字符</span>
            </div>
            <textarea
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              rows={18}
              className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)] resize-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditTarget(null)}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={saveEdit}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 transition-colors cursor-pointer"
            >
              确定
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeletePersonality}
        title="删除人格"
        message={deleteTarget
          ? `确定要删除 #${deleteTarget.index} "${(deleteTarget.side === 'group' ? groupList : privateList)[deleteTarget.index]?.remark ?? ''}" 吗？`
          : ''
        }
      />
    </div>
  );
}

// ===== Sub-components =====

function PersonalityColumn({ title, icon, items, activeIndex, side, onEdit, onClone, onDelete, onSetActive, onAdd }: {
  title: string;
  icon: string;
  items: { item: Personality; origIndex: number }[];
  activeIndex: number;
  side: 'group' | 'private';
  onEdit: (side: 'group' | 'private', index: number) => void;
  onClone: (side: 'group' | 'private', index: number) => void;
  onDelete: (index: number) => void;
  onSetActive: (side: 'group' | 'private', index: number) => void;
  onAdd: () => void;
}) {
  return (
    <div className="bg-white rounded-[var(--radius)] p-6 overflow-hidden" style={{ boxShadow: 'var(--shadow-3d)' }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{icon} {title}</h3>
        <button
          onClick={onAdd}
          className="text-xs px-2.5 py-1 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--accent-purple)] hover:bg-[var(--border-subtle)] transition-colors cursor-pointer"
        >
          + 添加
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] text-center py-6">暂无人格</p>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {items.map(({ item, origIndex }) => {
            const isActive = origIndex === activeIndex;
            return (
              <div
                key={origIndex}
                onClick={() => onEdit(side, origIndex)}
                className={`p-4 rounded-[var(--radius-sm)] transition-all duration-[400ms] cursor-pointer
                  ${isActive
                    ? 'bg-[rgba(14,165,233,0.08)] ring-1 ring-[var(--accent-purple)]'
                    : 'bg-[var(--bg-elevated)] hover:ring-1 hover:ring-[var(--accent-purple)]'
                  }`}
                style={{ transitionTimingFunction: 'var(--ease-spring)' }}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-[var(--text-muted)]">#{origIndex}</span>
                    <span className="text-sm font-medium text-[var(--text-primary)]">{item.remark}</span>
                    {isActive && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-purple)] text-white">
                        当前使用
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {!isActive && (
                      <button
                        onClick={() => onSetActive(side, origIndex)}
                        className="text-[10px] px-1.5 py-0.5 rounded text-[var(--text-muted)] hover:text-[var(--success)] hover:bg-[rgba(0,230,118,0.1)] transition-colors cursor-pointer"
                        title="设为活跃"
                      >
                        启用
                      </button>
                    )}
                    <button
                      onClick={() => onClone(side, origIndex)}
                      className="text-[10px] px-1.5 py-0.5 rounded text-[var(--text-muted)] hover:text-[var(--info)] hover:bg-[rgba(147,197,253,0.1)] transition-colors cursor-pointer"
                      title="克隆"
                    >
                      克隆
                    </button>
                    <button
                      onClick={() => onDelete(origIndex)}
                      className="text-[10px] px-1.5 py-0.5 rounded text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[rgba(255,82,82,0.1)] transition-colors cursor-pointer"
                      title="删除"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                  {item.prompt ? item.prompt.slice(0, 100) + (item.prompt.length > 100 ? '...' : '') : '(空提示词)'}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
