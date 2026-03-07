import { useState, useEffect } from 'react';

export type PageId = 'dashboard' | 'api' | 'config' | 'personality' | 'memory' | 'history' | 'commands' | 'ops';

interface NavItem {
  id: PageId;
  icon: string;
  label: string;
  shortcut: string;
}

const navItems: NavItem[] = [
  { id: 'dashboard', icon: '🏠', label: '概览', shortcut: '1' },
  { id: 'api', icon: '🔌', label: 'API管理', shortcut: '2' },
  { id: 'config', icon: '⚙', label: '配置编辑', shortcut: '3' },
  { id: 'personality', icon: '🎭', label: '人格管理', shortcut: '4' },
  { id: 'memory', icon: '🧠', label: '长期记忆', shortcut: '5' },
  { id: 'history', icon: '📜', label: '历史记录', shortcut: '6' },
  { id: 'commands', icon: '📋', label: '命令管理', shortcut: '7' },
  { id: 'ops', icon: '🛡️', label: '安全发布', shortcut: '8' },
];

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  onChangeDir?: () => void;
  onOpenSettings?: () => void;
  onToggleCollapse?: () => void;
  collapsed?: boolean;
  width?: number;
}

export function Sidebar({ activePage, onNavigate, onChangeDir, onOpenSettings, onToggleCollapse, collapsed = false, width = 224 }: SidebarProps) {
  const [clock, setClock] = useState('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString('zh-CN', { hour12: false }));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <aside
      className="h-full flex flex-col flex-shrink-0"
      style={{
        width: collapsed ? 64 : width,
        minWidth: collapsed ? 64 : 180,
        background: 'var(--surface-sidebar)',
        backdropFilter: 'blur(var(--sidebar-blur))',
        boxShadow: 'var(--shadow-panel)',
        borderRight: '1px solid var(--border-subtle)',
      }}
    >
      <div className="px-4 py-4 border-b border-[var(--border-subtle)]">
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <span className="text-2xl">🐱</span>
          {!collapsed && (
            <div>
              <h1 className="text-base font-extrabold text-[var(--accent-purple)] tracking-wide">NekoAI</h1>
              <p className="text-[11px] text-[var(--text-muted)]">管理面板 v1.0</p>
            </div>
          )}
        </div>
      </div>

      <nav className={`flex-1 py-3 ${collapsed ? 'px-2' : 'px-3'} space-y-1 overflow-y-auto`}>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            title={collapsed ? `${item.label} (^${item.shortcut})` : undefined}
            className={`relative w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2 rounded-[var(--radius-sm)] text-sm cursor-pointer
              ${activePage === item.id
                ? 'bg-[var(--nav-active-bg)] text-[var(--accent-purple)] font-semibold border border-[var(--border-strong)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] border border-transparent'
              }`}
            style={{ transition: 'all 0.2s var(--ease-spring)' }}
          >
            {activePage === item.id && !collapsed && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-[var(--accent-purple)]" />
            )}
            <span className="text-lg leading-none">{item.icon}</span>
            {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
            {!collapsed && <span className="text-[10px] text-[var(--text-muted)] opacity-50">^{item.shortcut}</span>}
          </button>
        ))}
      </nav>

      <div className="px-3 py-3 border-t border-[var(--border-subtle)] space-y-1.5">
        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center gap-2 px-2 py-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
          title={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          <span className="text-xs">{collapsed ? '»' : '«'}</span>
          {!collapsed && <span className="text-[10px]">侧栏</span>}
        </button>

        {onChangeDir && (
          <button
            onClick={onChangeDir}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer group"
            title={localStorage.getItem('nekoai-plugin-dir') ?? '未配置'}
          >
            <span className="text-xs">📂</span>
            {!collapsed && (
              <>
                <span className="flex-1 text-[10px] text-left truncate">
                  {(() => {
                    const dir = localStorage.getItem('nekoai-plugin-dir') ?? '';
                    const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? '未配置';
                    return name;
                  })()}
                </span>
                <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">切换</span>
              </>
            )}
          </button>
        )}

        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            title={collapsed ? '显示设置' : undefined}
          >
            <span className="text-xs">🎨</span>
            {!collapsed && <span className="text-[10px]">显示设置</span>}
          </button>
        )}

        {!collapsed && (
          <div className="flex items-center justify-between px-1 pt-1">
            <span className="text-[10px] text-[var(--text-muted)]">🐾 NekoAI</span>
            <span className="text-[10px] text-[var(--text-muted)] mono">{clock}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
