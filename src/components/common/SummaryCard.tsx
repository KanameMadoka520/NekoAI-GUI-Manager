import type { ReactNode } from 'react';

export function SummaryCard({ label, value, hint, tone = 'neutral', valueClassName = '' }: {
  label: string;
  value: string | number;
  hint: string;
  tone?: 'neutral' | 'warning' | 'success' | 'info';
  valueClassName?: string;
}) {
  const toneClass =
    tone === 'warning'
      ? 'text-[var(--warning)]'
      : tone === 'success'
        ? 'text-[var(--success)]'
        : tone === 'info'
          ? 'text-[var(--accent-purple)]'
          : 'text-[var(--text-primary)]';

  return (
    <div className="rounded-[var(--radius)] border border-[var(--border-subtle)] px-4 py-3" style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
      <p className="text-[10px] text-[var(--text-muted)]">{label}</p>
      <p className={`mt-1 text-sm font-medium truncate ${toneClass} ${valueClassName}`.trim()}>{value}</p>
      <p className="mt-1 text-[11px] text-[var(--text-muted)]">{hint}</p>
    </div>
  );
}

export function MiniInfo({ label, value, tone = 'info', trailing }: {
  label: string;
  value: string | number;
  tone?: 'success' | 'warning' | 'info' | 'neutral';
  trailing?: ReactNode;
}) {
  const toneClass =
    tone === 'success'
      ? 'text-[var(--success)]'
      : tone === 'warning'
        ? 'text-[var(--warning)]'
        : tone === 'info'
          ? 'text-[var(--accent-purple)]'
          : 'text-[var(--text-primary)]';

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2">
      <p className="text-[10px] text-[var(--text-muted)]">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className={`text-sm font-medium ${toneClass}`}>{value}</p>
        {trailing}
      </div>
    </div>
  );
}
