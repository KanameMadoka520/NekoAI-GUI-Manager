interface StatCardProps {
  label: string;
  value: string | number;
  color?: string;
  icon?: string;
}

/**
 * HUD 读数(gauge)：左强调刻度 + 小标签 + 大号等宽读数 + 一条细信号线。
 * 无卡盒阴影，扁平描边；数值用 tabular-nums 对齐，关键色由 color 决定。
 */
export function StatCard({ label, value, color = 'var(--accent-purple)', icon }: StatCardProps) {
  return (
    <div
      className="perf-stat-card relative bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-[var(--radius)] pl-3.5 pr-3.5 py-3 overflow-hidden"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--text-secondary)] tracking-[0.02em]">{label}</span>
        {icon && <span className="text-sm opacity-50">{icon}</span>}
      </div>
      <div
        className="data-num mt-1.5 text-[26px] font-bold leading-none"
        style={{ color }}
      >
        {value}
      </div>
      <div className="mt-2.5 h-[5px] rounded-[2px] overflow-hidden" style={{ background: 'color-mix(in srgb, var(--text-muted) 14%, transparent)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3)' }}>
        <div className="h-full w-2/3" style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${color} 60%, #000), ${color})`, boxShadow: `0 0 8px color-mix(in srgb, ${color} 50%, transparent)` }} />
      </div>
    </div>
  );
}
