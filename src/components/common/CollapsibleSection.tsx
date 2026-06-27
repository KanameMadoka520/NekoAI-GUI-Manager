import { useState, type ReactNode } from 'react';
import { InfoHint } from './InfoHint';

/**
 * 可收回抽屉：和 HUD 面板同款外观，表头可点击把内容向上收起，给下方更重要的条目腾出高度。
 * 收起状态用 storageKey 记忆，刷新后保持。用 grid-rows 0fr↔1fr 做平滑高度过渡（lite 下无过渡）。
 */
export function CollapsibleSection({ title, subtitle, icon, defaultOpen = true, storageKey, right, children, padding = 'md' }: {
  title: string;
  subtitle?: string;
  icon?: string;
  defaultOpen?: boolean;
  storageKey?: string;
  right?: ReactNode;
  children: ReactNode;
  padding?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(() => {
    if (storageKey) {
      const v = localStorage.getItem(storageKey);
      if (v === '0') return false;
      if (v === '1') return true;
    }
    return defaultOpen;
  });
  const toggle = () => setOpen((o) => {
    const n = !o;
    if (storageKey) { try { localStorage.setItem(storageKey, n ? '1' : '0'); } catch { /* ignore */ } }
    return n;
  });

  return (
    <div className="relative bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-[var(--radius)] overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
        className={`w-full flex items-center gap-2 px-4 py-2 cursor-pointer text-left select-none ${open ? 'border-b border-dashed border-[var(--border-subtle)]' : ''}`}
        style={{ background: 'var(--surface-header)' }}
        title={open ? '点击收起' : '点击展开'}
      >
        <span className="mono text-[12px] text-[var(--accent-purple)] w-3 leading-none select-none">{open ? '▾' : '▸'}</span>
        <span className="mono text-[12px] text-[var(--accent-purple)] leading-none select-none">::</span>
        {icon ? <span className="text-sm leading-none opacity-70">{icon}</span> : null}
        <span className="text-[13px] font-semibold tracking-[0.01em] text-[var(--text-primary)]">{title}</span>
        {subtitle ? <InfoHint text={subtitle} /> : null}
        {!open ? <span className="mono text-[10px] text-[var(--text-muted)] ml-auto whitespace-nowrap tracking-[0.04em]">已收起 · 点击展开</span> : null}
        {right && open ? <span className="ml-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>{right}</span> : null}
      </div>
      <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
        <div className="overflow-hidden">
          <div className={padding === 'sm' ? 'p-4' : 'p-5'}>{children}</div>
        </div>
      </div>
    </div>
  );
}
