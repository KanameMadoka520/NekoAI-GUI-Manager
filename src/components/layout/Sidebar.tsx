import { useState, useEffect } from 'react';

export type PageId = 'dashboard' | 'api' | 'config' | 'personality' | 'memory' | 'history' | 'commands';

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
];

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  onChangeDir?: () => void;
  onOpenSettings?: () => void;
}

export function Sidebar({ activePage, onNavigate, onChangeDir, onOpenSettings }: SidebarProps) {
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
      className="w-56 h-full flex flex-col"
      style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(20px)', boxShadow: '1px 0 8px rgba(0,0,0,0.04)' }}
    >
      {/* Logo */}
      <div className="px-5 py-5 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🐱</span>
          <div>
            <h1 className="text-base font-extrabold text-[var(--accent-purple)] tracking-wide">NekoAI</h1>
            <p className="text-[11px] text-[var(--text-muted)]">管理面板 v1.0</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`relative w-full flex items-center gap-3 px-4 py-2.5 rounded-[var(--radius-sm)] text-sm cursor-pointer
              ${activePage === item.id
                ? 'bg-[rgba(14,165,233,0.1)] text-[var(--accent-purple)] font-semibold'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            style={{ transition: 'all 0.3s var(--ease-spring)' }}
          >
            {activePage === item.id && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-[var(--accent-purple)]" />
            )}
            <span className="text-lg">{item.icon}</span>
            <span className="flex-1 text-left">{item.label}</span>
            <span className="text-[10px] text-[var(--text-muted)] opacity-40">^{item.shortcut}</span>
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[var(--border-subtle)] space-y-1.5">
        {onChangeDir && (
          <button
            onClick={onChangeDir}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer group"
            title={localStorage.getItem('nekoai-plugin-dir') ?? '未配置'}
          >
            <span className="text-xs">📂</span>
            <span className="flex-1 text-[10px] text-left truncate">
              {(() => {
                const dir = localStorage.getItem('nekoai-plugin-dir') ?? '';
                const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? '未配置';
                return name;
              })()}
            </span>
            <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">切换</span>
          </button>
        )}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            <span className="text-xs">🎨</span>
            <span className="text-[10px]">显示设置</span>
          </button>
        )}
        <div className="flex items-center justify-between px-2 pt-1">
          <span className="text-[10px] text-[var(--text-muted)]">🐾 NekoAI by KanameMadoka520</span>
          <span className="text-[10px] text-[var(--text-muted)] mono">{clock}</span>
        </div>
      </div>
    </aside>
  );
}
