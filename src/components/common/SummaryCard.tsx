import type { ReactNode } from 'react';

/**
 * HUD 概要单元：小标签 + 等宽读数(按 tone 上色) + 说明。扁平描边，账本式紧凑。
 */
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
    <div className="perf-summary-card bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-[var(--radius)] px-3 py-2.5">
      <p className="text-[11px] text-[var(--text-muted)] tracking-[0.02em]">{label}</p>
      <p className={`data-num mt-1 text-[16px] font-bold truncate ${toneClass} ${valueClassName}`.trim()}>{value}</p>
      <p className="mt-0.5 text-[11px] text-[var(--text-muted)] leading-snug">{hint}</p>
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
    <div className="perf-summary-card rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2.5">
      <p className="text-[11px] text-[var(--text-muted)] tracking-[0.02em]">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className={`data-num text-[14px] font-bold ${toneClass}`}>{value}</p>
        {trailing}
      </div>
    </div>
  );
}
