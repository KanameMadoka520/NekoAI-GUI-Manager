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
      className={`rounded-[var(--radius)] overflow-hidden border border-[var(--border-subtle)] ${padding === 'sm' ? 'p-5' : 'p-6'}`}
      style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="mb-4 pb-3 border-b border-[var(--border-subtle)]">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{icon ? `${icon} ` : ''}{title}</h3>
        {subtitle ? <p className="mt-1 text-[11px] text-[var(--text-muted)] leading-relaxed">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}
