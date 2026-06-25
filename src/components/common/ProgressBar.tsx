interface ProgressBarProps {
  value: number;
  max: number;
  label?: string;
  showText?: boolean;
}

export function ProgressBar({ value, max, label, showText = true }: ProgressBarProps) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const color = pct < 50 ? 'var(--success)' : pct < 85 ? 'var(--warning)' : 'var(--error)';

  return (
    <div className="space-y-1">
      {(label || showText) && (
        <div className="flex items-center justify-between text-xs">
          {label && <span className="text-[var(--text-secondary)]">{label}</span>}
          {showText && <span className="text-[var(--text-muted)] mono">{value}/{max}</span>}
        </div>
      )}
      <div className="h-2 bg-[var(--bg-elevated)] rounded-[var(--radius-pill)] overflow-hidden">
        <div
          className="h-full rounded-[var(--radius-pill)] transition-[width] duration-300 ease-[var(--ease-spring)]"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}
