import type { ReactNode } from 'react';
import { InfoHint } from './InfoHint';

/**
 * HUD 区块面板：扁平实色面 + 1px 描边 + 表头(青色 :: 标记 + 标题，底部 1px 虚线收口)。
 * 说明(subtitle)收进表头的 ⓘ，移上/点击才展开，省纵向空间。
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
      <div className="px-4 py-2 border-b border-dashed border-[var(--border-subtle)] flex items-center gap-2" style={{ background: 'var(--surface-header)' }}>
        <span className="mono text-[12px] leading-none text-[var(--accent-purple)] select-none">::</span>
        {icon ? <span className="text-sm leading-none opacity-70">{icon}</span> : null}
        <h3 className="text-[13px] font-semibold tracking-[0.01em] text-[var(--text-primary)]">{title}</h3>
        {subtitle ? <InfoHint text={subtitle} /> : null}
      </div>
      <div className={padding === 'sm' ? 'p-4' : 'p-5'}>{children}</div>
    </div>
  );
}
