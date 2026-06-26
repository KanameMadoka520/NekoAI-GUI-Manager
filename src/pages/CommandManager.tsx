import { useState, useEffect, useMemo } from 'react';
import { StatCard } from '../components/common/StatCard';
import { SearchBar } from '../components/common/SearchBar';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { Modal } from '../components/common/Modal';
import { ImportExportActions } from '../components/common/ImportExportActions';
import { useUiStore } from '../stores/uiStore';
import { usePageDirtyState } from '../hooks/usePageDirtyState';
import { getConfig, saveConfig } from '../lib/tauri-commands';
import { downloadJsonWithTimestamp, pickJsonAndParse } from '../lib/json-transfer';

export function CommandManager() {
  const addToast = useUiStore((s) => s.addToast);
  const [commands, setCommands] = useState<string[]>([]);
  const [original, setOriginal] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newCmd, setNewCmd] = useState('');
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const dirty = useMemo(() => JSON.stringify(commands) !== JSON.stringify(original), [commands, original]);
  usePageDirtyState('commands', dirty, '命令回避列表存在未保存改动，离开后这些改动不会自动写回 commands.json。');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await getConfig<string[]>('commands');
      const list = data ?? [];
      setCommands(list);
      setOriginal(list);
      setSelected(new Set());
    } catch (e: any) {
      addToast('error', `加载命令列表失败: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return commands;
    const q = search.toLowerCase();
    return commands.filter((c) => c.toLowerCase().includes(q));
  }, [commands, search]);

  function addCommand() {
    const cmd = newCmd.trim();
    if (!cmd) return;
    if (commands.includes(cmd)) {
      addToast('warning', `命令 "${cmd}" 已存在`);
      return;
    }
    setCommands([...commands, cmd]);
    setNewCmd('');
  }

  function addBulk() {
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    const unique = lines.filter((l) => !commands.includes(l));
    if (unique.length === 0) {
      addToast('warning', '没有新命令可添加');
      return;
    }
    setCommands([...commands, ...unique]);
    setShowBulkAdd(false);
    setBulkText('');
    addToast('success', `已添加 ${unique.length} 条命令`);
  }

  function deleteCommand(cmd: string) {
    setCommands(commands.filter((c) => c !== cmd));
    selected.delete(cmd);
    setSelected(new Set(selected));
    setConfirmDelete(null);
  }

  function deleteBulk() {
    setCommands(commands.filter((c) => !selected.has(c)));
    setSelected(new Set());
    setConfirmBulkDelete(false);
    addToast('success', `已删除 ${selected.size} 条命令`);
  }

  function toggleSelect(cmd: string) {
    const next = new Set(selected);
    if (next.has(cmd)) next.delete(cmd); else next.add(cmd);
    setSelected(next);
  }

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered));
    }
  }

  async function save() {
    try {
      await saveConfig('commands', commands);
      setOriginal([...commands]);
      addToast('success', '命令列表已保存。现在新的避让规则已经写回文件了。');
    } catch (e: any) {
      addToast('error', `保存失败: ${e?.message ?? e}`);
    }
  }

  function exportCommands() {
    downloadJsonWithTimestamp(commands, 'commands.json');
    addToast('success', '已导出命令列表。如果你只是想分享一个范例，建议先看看里面有没有你只在本地会用到的命令。');
  }

  async function importCommands() {
    try {
      const picked = await pickJsonAndParse();
      if (!picked) return;
      if (!Array.isArray(picked.data) || !picked.data.every((x) => typeof x === 'string')) {
        addToast('error', '导入失败：JSON 必须是字符串数组');
        return;
      }
      setCommands(picked.data as string[]);
      setSelected(new Set());
      addToast('success', `已导入 ${(picked.data as string[]).length} 条命令。当前只是载入到编辑区，记得再点保存才会生效。`);
    } catch (e: any) {
      addToast('error', `导入失败: ${e?.message ?? e}`);
    }
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

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="总命令数" value={commands.length} icon="📋" color="var(--accent-purple)" />
        <StatCard label="当前结果" value={filtered.length} icon="🔍" color="var(--info)" />
        <StatCard label="已选中" value={selected.size} icon="✓" color="var(--accent-pink)" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <SearchBar value={search} onChange={setSearch} placeholder="搜索命令，先缩小范围再删会更稳..." />
        </div>
        <button
          onClick={() => setShowBulkAdd(true)}
          className="px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          批量添加
        </button>
        {selected.size > 0 && (
          <>
            <button
              onClick={toggleAll}
              className="px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              {selected.size === filtered.length ? '取消全选' : '全选当前结果'}
            </button>
            <button
              onClick={() => setConfirmBulkDelete(true)}
              className="px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--error-soft-bg)] text-[var(--error)] hover:bg-[color-mix(in_srgb,var(--error)_28%,transparent)] transition-colors cursor-pointer"
            >
              删除选中 ({selected.size})
            </button>
          </>
        )}
        <ImportExportActions
          onExport={exportCommands}
          onImport={importCommands}
          confirmTitle="导入命令配置"
        />
        <button
          onClick={save}
          disabled={!dirty}
          className={`px-4 py-2 text-sm rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer
            ${dirty
              ? 'bg-[var(--accent-purple)] text-[var(--on-accent)] hover:opacity-90 pulse-dirty'
              : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed'
            }`}
        >
          💾 保存
        </button>
      </div>

      {/* Add single command */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newCmd}
          onChange={(e) => setNewCmd(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCommand()}
          placeholder="输入一个新命令，回车就能加进去..."
          className="flex-1 px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-purple)] transition-colors"
        />
        <button
          onClick={addCommand}
          className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-[var(--on-accent)] hover:opacity-90 transition-colors cursor-pointer"
        >
          添加
        </button>
      </div>

      {/* Command list */}
      <div className="rounded-[var(--radius)] overflow-hidden border border-[var(--border-subtle)]" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
        {filtered.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-8 px-6">
            {search ? '没有找到匹配的命令。可以换个关键词，或者清空搜索再看全部。' : '这里还没有任何命令。你可以手动加一条，或者直接导入一整份列表。'}
          </p>
        ) : (
          <div className="max-h-[400px] overflow-y-auto p-6">
            {filtered.map((cmd) => (
              <div
                key={cmd}
                className={`flex items-center gap-3 px-5 py-2.5 text-sm border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-elevated)] transition-colors rounded-[var(--radius-sm)]
                  ${selected.has(cmd) ? 'bg-[var(--accent-soft-bg)]' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(cmd)}
                  onChange={() => toggleSelect(cmd)}
                  className="accent-[var(--accent-purple)] cursor-pointer"
                />
                <span className="text-xs text-[var(--text-muted)] mono w-8 text-right">{commands.indexOf(cmd) + 1}</span>
                <span className="flex-1 text-[var(--text-secondary)] mono">{cmd}</span>
                <button
                  onClick={() => setConfirmDelete(cmd)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--error)] transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                  style={{ opacity: 1 }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bulk add modal */}
      <Modal open={showBulkAdd} onClose={() => setShowBulkAdd(false)} title="批量添加命令">
        <p className="text-sm text-[var(--text-secondary)] mb-3">每行放一条命令。适合一次性导入一大批避让词。</p>
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          rows={10}
          className="w-full px-3 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] mono outline-none focus:border-[var(--accent-purple)] resize-none"
          placeholder="command1&#10;command2&#10;command3"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={() => setShowBulkAdd(false)}
            className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={addBulk}
            className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-[var(--on-accent)] hover:opacity-90 transition-colors cursor-pointer"
          >
            添加
          </button>
        </div>
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) deleteCommand(confirmDelete); }}
        title="删除这条命令"
        message={`你将从列表里移除 "${confirmDelete}"。这里确认后仍然只是编辑态，真正写回文件还要再点保存。`}
      />

      {/* Bulk delete confirm */}
      <ConfirmDialog
        open={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={deleteBulk}
        title="批量删除"
        message={`你将从列表里移除选中的 ${selected.size} 条命令。这里确认后仍然只是编辑态，真正写回文件还要再点保存。`}
      />
    </div>
  );
}
