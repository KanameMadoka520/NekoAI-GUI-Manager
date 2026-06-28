import { useState, useEffect } from 'react';

export type PageId = 'dashboard' | 'api' | 'config' | 'personality' | 'evaluation' | 'memory' | 'history' | 'usage' | 'commands' | 'ops';

interface NavItem {
  id: PageId;
  icon: string;
  label: string;
  code: string;   // mono 模块代号
  shortcut: string;
}

const navItems: NavItem[] = [
  { id: 'dashboard', icon: '◳', label: '概览', code: 'OVW', shortcut: '1' },
  { id: 'api', icon: '⇄', label: 'API管理', code: 'API', shortcut: '2' },
  { id: 'config', icon: '⚙', label: '配置编辑', code: 'CFG', shortcut: '3' },
  { id: 'personality', icon: '☻', label: '人格管理', code: 'PSN', shortcut: '4' },
  { id: 'evaluation', icon: '◴', label: '人格评测', code: 'EVL', shortcut: '5' },
  { id: 'memory', icon: '❒', label: '长期记忆', code: 'MEM', shortcut: '6' },
  { id: 'history', icon: '≣', label: '历史记录', code: 'LOG', shortcut: '7' },
  { id: 'usage', icon: '◷', label: '用量管理', code: 'USE', shortcut: '8' },
  { id: 'commands', icon: '⌘', label: '命令管理', code: 'CMD', shortcut: '9' },
  { id: 'ops', icon: '⚑', label: '安全发布', code: 'OPS', shortcut: '0' },
];

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  onChangeDir?: () => void;
  onOpenSettings?: () => void;
  onOpenWebConsole?: () => void;
  onToggleCollapse?: () => void;
  collapsed?: boolean;
  width?: number;
  visiblePages?: PageId[];
}

/**
 * HUD 左侧模块轨：实色 rail + 右侧 1px 结构线；活动项用左强调刻度(3px accent) + 染色 + mono 代号。
 * 收起态退化为纯图标轨。
 */
export function Sidebar({ activePage, onNavigate, onChangeDir, onOpenSettings, onOpenWebConsole, onToggleCollapse, collapsed = false, width = 208, visiblePages }: SidebarProps) {
  const [clock, setClock] = useState('');
  const visiblePageSet = visiblePages ? new Set(visiblePages) : null;
  const displayedNavItems = visiblePageSet ? navItems.filter((item) => visiblePageSet.has(item.id)) : navItems;

  useEffect(() => {
    let timer: number | null = null;
    const update = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' }));
    };
    const scheduleNext = () => {
      const delay = 60000 - (Date.now() % 60000) + 120;
      timer = window.setTimeout(() => { update(); scheduleNext(); }, delay);
    };
    update();
    scheduleNext();
    return () => { if (timer !== null) window.clearTimeout(timer); };
  }, []);

  return (
    <aside
      className="h-full flex flex-col flex-shrink-0"
      style={{
        width: collapsed ? 56 : width,
        minWidth: collapsed ? 56 : 176,
        background: 'var(--surface-sidebar)',
        borderRight: '1px solid var(--border-subtle)',
      }}
    >
      {/* brand */}
      <div className={`h-11 flex items-center ${collapsed ? 'justify-center' : 'gap-2.5 px-4'} border-b border-[var(--border-subtle)] flex-shrink-0`}>
        <span className="ba-halo" aria-hidden />
        {!collapsed && (
          <div className="leading-none">
            <span className="text-[15px] font-extrabold text-[var(--accent-purple)] tracking-[0.06em]">NEKO</span>
            <span className="mono text-[10px] text-[var(--text-muted)] ml-1.5 tracking-[0.16em]">MGR</span>
          </div>
        )}
      </div>

      <nav className={`flex-1 py-2 ${collapsed ? 'px-1.5' : 'px-2'} space-y-0.5 overflow-y-auto`}>
        {displayedNavItems.map((item) => {
          const active = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              title={collapsed ? `${item.label} (^${item.shortcut})` : undefined}
              className={`relative w-full flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'} pl-3 pr-2 py-2 text-[13px] cursor-pointer
                ${active
                  ? 'text-white font-bold'
                  : 'rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                }`}
              style={{ transition: 'color 0.15s var(--ease-spring)' }}
            >
              {active && <span className="ba-fill" aria-hidden />}
              <span className="relative z-[1] text-[15px] leading-none w-4 text-center">{item.icon}</span>
              {!collapsed && <span className="relative z-[1] flex-1 text-left">{item.label}</span>}
              {!collapsed && <span className={`relative z-[1] mono text-[10px] tracking-[0.08em] ${active ? 'text-white opacity-85' : 'text-[var(--text-muted)] opacity-60'}`}>{item.code}</span>}
            </button>
          );
        })}
      </nav>

      <div className="px-2 py-2 border-t border-[var(--border-subtle)] space-y-0.5 flex-shrink-0">
        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center gap-2 px-2 py-1.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
          title={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          <span className="mono text-xs">{collapsed ? '»' : '«'}</span>
          {!collapsed && <span className="text-[11px]">收起</span>}
        </button>

        {onChangeDir && (
          <button
            onClick={onChangeDir}
            className="w-full flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer group"
            title={localStorage.getItem('nekoai-plugin-dir') ?? '未配置'}
          >
            <span className="text-[13px] w-4 text-center">▤</span>
            {!collapsed && (
              <>
                <span className="flex-1 text-[11px] text-left truncate">
                  {(localStorage.getItem('nekoai-plugin-dir') ?? '').split(/[\\/]/).filter(Boolean).pop() || '未连接目录'}
                </span>
                <span className="text-[10px] mono opacity-0 group-hover:opacity-100 transition-opacity">DIR</span>
              </>
            )}
          </button>
        )}

        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            title={collapsed ? '显示设置' : undefined}
          >
            <span className="text-[13px] w-4 text-center">◐</span>
            {!collapsed && <span className="text-[11px]">显示设置</span>}
          </button>
        )}

        {onOpenWebConsole && (
          <button
            onClick={onOpenWebConsole}
            className="w-full flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            title={collapsed ? '本地服务' : undefined}
          >
            <span className="text-[13px] w-4 text-center">⊕</span>
            {!collapsed && <span className="text-[11px]">本地服务</span>}
          </button>
        )}

        {!collapsed && (
          <div className="flex items-center justify-between px-2 pt-1.5">
            <span className="mono text-[10px] text-[var(--text-muted)] tracking-[0.08em]">v1.0</span>
            <span className="mono text-[11px] text-[var(--accent-purple)] data-num">{clock}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
