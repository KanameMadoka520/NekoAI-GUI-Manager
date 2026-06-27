import type { ReactNode } from 'react';

/**
 * HUD 区块面板：扁平实色面 + 1px 描边 + 表头(青色 :: 标记 + 标题，底部 1px 虚线收口)。
 * 不用卡片阴影/大圆角；表头背景比面板深一档，做出控制台分区感。
 */
export function Panel({ title, subtitle, icon, children, padding = 'md' }: {
  title: string;
  subtitle?: string;
  icon?: string;
  children: ReactNode;
  padding?: 'sm' | 'md';
}) {
  return (
    <div className="perf-panel perf-panel-viewport relative bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-[var(--radius)] overflow-hidden">
      <div className="px-4 pt-2.5 pb-2 border-b border-dashed border-[var(--border-subtle)]" style={{ background: 'var(--surface-header)' }}>
        <div className="flex items-center gap-2">
          <span className="mono text-[12px] leading-none text-[var(--accent-purple)] select-none">::</span>
          {icon ? <span className="text-sm leading-none opacity-70">{icon}</span> : null}
          <h3 className="text-[13px] font-semibold tracking-[0.01em] text-[var(--text-primary)]">{title}</h3>
        </div>
        {subtitle ? <p className="mt-1 text-[11.5px] text-[var(--text-muted)] leading-relaxed">{subtitle}</p> : null}
      </div>
      <div className={padding === 'sm' ? 'p-4' : 'p-5'}>{children}</div>
    </div>
  );
}
