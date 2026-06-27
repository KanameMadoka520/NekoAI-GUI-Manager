import type { ReactNode } from 'react';

export interface SubTabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** 可选的角标计数（如条目数 / 异常数），undefined 不显示 */
  badge?: number | string;
}

interface SubTabsProps {
  tabs: SubTabItem[];
  active: string;
  onChange: (id: string) => void;
  /** 右侧附加内容（如「全部展开」等页内操作） */
  trailing?: ReactNode;
  className?: string;
}

/**
 * 页内分段子标签（启动器胶囊风）。
 *
 * 用于把超长滚动的重页面按逻辑切成几段，一次只看一段，降低认知负担。
 * 纯展示 + 受控：状态由各页面自己持有，本组件只负责渲染与切换回调。
 * 仅用 transform/box-shadow 动画，长页面也安全；lite 模式下过渡自动关闭（继承全局规则）。
 */
export function SubTabs({ tabs, active, onChange, trailing, className }: SubTabsProps) {
  return (
    <div className={`mb-5 flex items-center gap-2 ${className ?? ''}`}>
      <div
        role="tablist"
        aria-label="页内分段"
        className="flex-1 flex items-center gap-1.5 overflow-x-auto p-1 rounded-[var(--radius)] border border-[var(--border-subtle)]"
        style={{ background: 'var(--surface-card)' }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              className={`group relative flex items-center gap-2 whitespace-nowrap px-3.5 py-2 rounded-[var(--radius-sm)] text-sm font-medium cursor-pointer border
                ${isActive
                  ? 'bg-[var(--accent-purple)] text-[var(--on-accent)] border-transparent shadow-[var(--glow-soft)]'
                  : 'bg-transparent text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                }`}
            >
              {tab.icon && <span className="text-base leading-none">{tab.icon}</span>}
              <span>{tab.label}</span>
              {tab.badge !== undefined && tab.badge !== '' && (
                <span
                  className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-[var(--radius-pill)] text-[12px] font-semibold
                    ${isActive
                      ? 'bg-[var(--on-accent)] text-[var(--accent-purple)]'
                      : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border-subtle)]'
                    }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {trailing && <div className="flex items-center gap-2 shrink-0">{trailing}</div>}
    </div>
  );
}
