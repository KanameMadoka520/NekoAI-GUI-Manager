import { useState, useEffect, useMemo } from 'react';
import { StatCard } from '../components/common/StatCard';
import { SearchBar } from '../components/common/SearchBar';
import { Modal } from '../components/common/Modal';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { ImportExportActions } from '../components/common/ImportExportActions';
import { Panel } from '../components/common/Panel';
import { SummaryCard } from '../components/common/SummaryCard';
import { useUiStore } from '../stores/uiStore';
import { getConfig, saveConfig } from '../lib/tauri-commands';
import { downloadJsonWithTimestamp, pickJsonAndParse } from '../lib/json-transfer';
import type { Personality, RuntimeConfig } from '../lib/types';

export function PersonalityManager() {
  const addToast = useUiStore((s) => s.addToast);
  const settings = useUiStore((s) => s.settings);
  const [groupList, setGroupList] = useState<Personality[]>([]);
  const [privateList, setPrivateList] = useState<Personality[]>([]);
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null);
  const [origGroup, setOrigGroup] = useState<string>('');
  const [origPrivate, setOrigPrivate] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showImportExport, setShowImportExport] = useState(false);

  const [editTarget, setEditTarget] = useState<{ side: 'group' | 'private'; index: number } | null>(null);
  const [editRemark, setEditRemark] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
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
    if (side === 'group') setGroupList([...groupList, newP]);
    else setPrivateList([...privateList, newP]);
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
      const next = groupList.filter((_, i) => i !== index);
      setGroupList(next);
      if (runtime) {
        const current = runtime.activeGroupPersonalityIndex ?? 0;
        const adjusted = current === index ? Math.max(0, Math.min(current, next.length - 1)) : current > index ? current - 1 : current;
        setRuntime({ ...runtime, activeGroupPersonalityIndex: Math.max(0, Math.min(adjusted, Math.max(0, next.length - 1))) });
      }
    } else {
      const next = privateList.filter((_, i) => i !== index);
      setPrivateList(next);
      if (runtime) {
        const current = runtime.activePrivatePersonalityIndex ?? 0;
        const adjusted = current === index ? Math.max(0, Math.min(current, next.length - 1)) : current > index ? current - 1 : current;
        setRuntime({ ...runtime, activePrivatePersonalityIndex: Math.max(0, Math.min(adjusted, Math.max(0, next.length - 1))) });
      }
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
      if (runtime) await saveConfig('runtime', runtime);
      setOrigGroup(JSON.stringify(groupList));
      setOrigPrivate(JSON.stringify(privateList));
      addToast('success', '人格列表已保存');
    } catch (e: any) {
      addToast('error', `保存失败: ${e?.message ?? e}`);
    }
  }

  function exportPersonality(side: 'group' | 'private') {
    const list = side === 'group' ? groupList : privateList;
    const filename = side === 'group' ? 'group_personality.json' : 'private_personality.json';
    downloadJsonWithTimestamp(list, filename);
    addToast('success', `已导出${side === 'group' ? '群聊' : '私聊'}人格配置`);
  }

  async function importPersonality(side: 'group' | 'private') {
    try {
      const picked = await pickJsonAndParse();
      if (!picked) return;
      if (!Array.isArray(picked.data)) {
        addToast('error', '导入失败：JSON 必须是数组');
        return;
      }

      const list = (picked.data as Array<any>).map((it) => ({
        remark: typeof it?.remark === 'string' ? it.remark : '未命名人格',
        prompt: typeof it?.prompt === 'string' ? it.prompt : '',
      }));

      if (side === 'group') {
        setGroupList(list);
        if (runtime) {
          setRuntime({
            ...runtime,
            activeGroupPersonalityIndex: Math.max(0, Math.min(runtime.activeGroupPersonalityIndex ?? 0, Math.max(0, list.length - 1))),
          });
        }
      } else {
        setPrivateList(list);
        if (runtime) {
          setRuntime({
            ...runtime,
            activePrivatePersonalityIndex: Math.max(0, Math.min(runtime.activePrivatePersonalityIndex ?? 0, Math.max(0, list.length - 1))),
          });
        }
      }

      addToast('success', `已导入${side === 'group' ? '群聊' : '私聊'}人格 ${list.length} 条（请点击保存生效）`);
    } catch (e: any) {
      addToast('error', `导入失败: ${e?.message ?? e}`);
    }
  }

  function filterList(list: Personality[]): { item: Personality; origIndex: number }[] {
    if (!search.trim()) return list.map((item, origIndex) => ({ item, origIndex }));
    const q = search.toLowerCase();
    return list
      .map((item, origIndex) => ({ item, origIndex }))
      .filter(({ item }) => item.remark.toLowerCase().includes(q) || item.prompt.toLowerCase().includes(q));
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
  const filteredGroup = filterList(groupList);
  const filteredPrivate = filterList(privateList);
  const densityClass = settings.contentDensity === 'spacious' ? 'gap-5' : settings.contentDensity === 'compact' ? 'gap-3' : 'gap-4';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard label="群聊人格数" value={groupList.length} icon="👥" color="var(--accent-purple)" />
        <StatCard label="私聊人格数" value={privateList.length} icon="👤" color="var(--accent-pink)" />
        <StatCard label="群聊活跃" value={`#${activeGroupIdx}`} icon="⚡" color="var(--success)" />
        <StatCard label="私聊活跃" value={`#${activePrivateIdx}`} icon="⚡" color="var(--info)" />
        <SummaryCard label="保存状态" value={dirty ? '待保存' : '已同步'} hint={dirty ? '人格或活跃索引有改动' : '当前列表已保存'} tone={dirty ? 'warning' : 'neutral'} />
      </div>

      <div className="rounded-[var(--radius)] border border-[var(--border-subtle)] px-4 py-3" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[280px]">
            <SearchBar value={search} onChange={setSearch} placeholder="搜索人格名称或提示词..." />
          </div>
          <button
            onClick={() => setShowImportExport((v) => !v)}
            className={`px-3 py-2 text-xs rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${showImportExport ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)] border-[var(--accent-purple)]' : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            {showImportExport ? '收起导入导出' : '更多操作'}
          </button>
          <button
            onClick={() => addPersonality('group')}
            className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--accent-purple)] hover:bg-[var(--border-subtle)] transition-colors cursor-pointer"
          >
            + 新增群聊人格
          </button>
          <button
            onClick={() => addPersonality('private')}
            className="px-3 py-2 text-xs rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--accent-purple)] hover:bg-[var(--border-subtle)] transition-colors cursor-pointer"
          >
            + 新增私聊人格
          </button>
          <button
            onClick={save}
            disabled={!dirty}
            className={`px-4 py-2 text-sm rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer ${dirty ? 'bg-[var(--accent-purple)] text-white hover:opacity-90 pulse-dirty' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'}`}
          >
            💾 保存
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">群聊显示 {filteredGroup.length}/{groupList.length}</span>
          <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">私聊显示 {filteredPrivate.length}/{privateList.length}</span>
          {search.trim() ? <span className="px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">关键词：{search}</span> : null}
          {dirty ? <span className="ml-auto text-[var(--warning)]">当前有未保存改动</span> : <span className="ml-auto text-[var(--text-muted)]">建议编辑完成后统一保存</span>}
        </div>

        {showImportExport && (
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-2">
              <p className="text-xs font-medium text-[var(--text-primary)]">群聊人格导入 / 导出</p>
              <p className="text-[11px] text-[var(--text-muted)]">适合群聊场景的系统提示词集合。</p>
              <ImportExportActions
                onExport={() => exportPersonality('group')}
                onImport={() => importPersonality('group')}
                exportLabel="⬇ 导出群聊"
                importLabel="⬆ 导入群聊"
                confirmTitle="导入群聊人格"
              />
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-2">
              <p className="text-xs font-medium text-[var(--text-primary)]">私聊人格导入 / 导出</p>
              <p className="text-[11px] text-[var(--text-muted)]">适合单聊场景的系统提示词集合。</p>
              <ImportExportActions
                onExport={() => exportPersonality('private')}
                onImport={() => importPersonality('private')}
                exportLabel="⬇ 导出私聊"
                importLabel="⬆ 导入私聊"
                confirmTitle="导入私聊人格"
              />
            </div>
          </div>
        )}
      </div>

      <div className={`grid grid-cols-1 xl:grid-cols-2 ${densityClass}`}>
        <PersonalityColumn
          title="群聊人格"
          subtitle="用于群聊对话、群上下文和群场景风格控制。"
          icon="👥"
          items={filteredGroup}
          activeIndex={activeGroupIdx}
          side="group"
          onEdit={openEdit}
          onClone={clonePersonality}
          onDelete={(i) => setDeleteTarget({ side: 'group', index: i })}
          onSetActive={setActive}
        />
        <PersonalityColumn
          title="私聊人格"
          subtitle="用于私聊对话、私密场景和一对一语气控制。"
          icon="👤"
          items={filteredPrivate}
          activeIndex={activePrivateIdx}
          side="private"
          onEdit={openEdit}
          onClone={clonePersonality}
          onDelete={(i) => setDeleteTarget({ side: 'private', index: i })}
          onSetActive={setActive}
        />
      </div>

      <Modal
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title={`编辑人格 #${editTarget?.index ?? 0}`}
        width="680px"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_180px] gap-3">
            <div>
              <label className="text-xs text-[var(--text-muted)] mb-1 block">名称/备注</label>
              <input
                value={editRemark}
                onChange={(e) => setEditRemark(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
              />
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
              <p className="text-[10px] text-[var(--text-muted)]">当前长度</p>
              <p className="mt-1 text-sm font-medium text-[var(--text-primary)] mono">{editPrompt.length} 字符</p>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">建议先写角色定位，再写规则和风格。</p>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-[var(--text-muted)]">系统提示词</label>
              <span className="text-xs text-[var(--text-muted)] mono">{editTarget?.side === 'group' ? '群聊人格' : '私聊人格'}</span>
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

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeletePersonality}
        title="删除人格"
        message={deleteTarget
          ? `确定要删除 #${deleteTarget.index} "${(deleteTarget.side === 'group' ? groupList : privateList)[deleteTarget.index]?.remark ?? ''}" 吗？`
          : ''}
      />
    </div>
  );
}

function PersonalityColumn({ title, subtitle, icon, items, activeIndex, side, onEdit, onClone, onDelete, onSetActive }: {
  title: string;
  subtitle: string;
  icon: string;
  items: { item: Personality; origIndex: number }[];
  activeIndex: number;
  side: 'group' | 'private';
  onEdit: (side: 'group' | 'private', index: number) => void;
  onClone: (side: 'group' | 'private', index: number) => void;
  onDelete: (index: number) => void;
  onSetActive: (side: 'group' | 'private', index: number) => void;
}) {
  return (
    <Panel title={title} subtitle={subtitle} icon={icon} padding="sm">
      {items.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] text-center py-8">暂无匹配人格</p>
      ) : (
        <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
          {items.map(({ item, origIndex }) => {
            const isActive = origIndex === activeIndex;
            return (
              <div
                key={origIndex}
                onClick={() => onEdit(side, origIndex)}
                className={`rounded-[var(--radius-sm)] border transition-all duration-[300ms] cursor-pointer p-4 ${isActive ? 'border-[var(--accent-purple)] bg-[rgba(14,165,233,0.08)]' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-hover)]'}`}
                style={{ transitionTimingFunction: 'var(--ease-spring)' }}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono text-[var(--text-muted)]">#{origIndex}</span>
                      <span className="text-sm font-medium text-[var(--text-primary)] truncate max-w-[320px]">{item.remark}</span>
                      {isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-purple)] text-white">
                          当前使用
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                      {item.prompt ? `${item.prompt.length} 字符` : '空提示词'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap justify-end" onClick={(e) => e.stopPropagation()}>
                    {!isActive && (
                      <button
                        onClick={() => onSetActive(side, origIndex)}
                        className="text-[10px] px-2.5 py-1 rounded border border-[var(--success)] text-[var(--success)] bg-[rgba(0,230,118,0.08)] hover:bg-[rgba(0,230,118,0.18)] transition-colors cursor-pointer"
                        title="设为活跃"
                      >
                        启用
                      </button>
                    )}
                    <button
                      onClick={() => onClone(side, origIndex)}
                      className="text-[10px] px-2.5 py-1 rounded border border-[var(--info)] text-[var(--info)] bg-[rgba(147,197,253,0.08)] hover:bg-[rgba(147,197,253,0.18)] transition-colors cursor-pointer"
                      title="克隆"
                    >
                      克隆
                    </button>
                    <button
                      onClick={() => onDelete(origIndex)}
                      className="text-[10px] px-2.5 py-1 rounded border border-[var(--error)] text-[var(--error)] bg-[rgba(255,82,82,0.08)] hover:bg-[rgba(255,82,82,0.18)] transition-colors cursor-pointer"
                      title="删除"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2">
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed line-clamp-3">
                    {item.prompt ? item.prompt.slice(0, 160) + (item.prompt.length > 160 ? '...' : '') : '(空提示词)'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
