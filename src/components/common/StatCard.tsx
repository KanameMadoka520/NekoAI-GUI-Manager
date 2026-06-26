interface StatCardProps {
  label: string;
  value: string | number;
  color?: string;
  icon?: string;
}

export function StatCard({ label, value, color = 'var(--accent-purple)', icon }: StatCardProps) {
  return (
    <div className="perf-stat-card launcher-tile relative p-5 flex flex-col gap-2">
      {/* Accent left bar with soft glow */}
      <div
        className="absolute top-3 left-0 bottom-3 w-[3px] rounded-r-[var(--radius-pill)] z-[1]"
        style={{ background: color, boxShadow: `0 0 12px color-mix(in srgb, ${color} 60%, transparent)` }}
      />
      <div className="relative z-[1] flex items-center justify-between pl-3">
        <span className="text-xs text-[var(--text-muted)] font-medium tracking-wide">{label}</span>
        {icon && <span className="text-lg opacity-60">{icon}</span>}
      </div>
      <span
        className="relative z-[1] text-2xl font-bold pl-3 tabular-nums"
        style={{ color, textShadow: `0 0 18px color-mix(in srgb, ${color} 45%, transparent)` }}
      >
        {value}
      </span>
    </div>
  );
}
