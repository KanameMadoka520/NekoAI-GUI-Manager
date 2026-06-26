import type { ReactNode } from 'react';

export function Panel({ title, subtitle, icon, children, padding = 'md' }: {
  title: string;
  subtitle?: string;
  icon?: string;
  children: ReactNode;
  padding?: 'sm' | 'md';
}) {
  return (
    <div
      className={`perf-panel perf-panel-viewport glass-card rounded-[var(--radius-lg)] overflow-hidden ${padding === 'sm' ? 'p-5' : 'p-6'}`}
    >
      <div className="mb-4 pb-3 border-b border-[var(--border-subtle)]">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-[0.01em]">{icon ? `${icon} ` : ''}{title}</h3>
        {subtitle ? <p className="mt-1.5 text-xs text-[var(--text-muted)] leading-relaxed">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}
