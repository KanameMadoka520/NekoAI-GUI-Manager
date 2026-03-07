interface StatCardProps {
  label: string;
  value: string | number;
  color?: string;
  icon?: string;
}

export function StatCard({ label, value, color = 'var(--accent-purple)', icon }: StatCardProps) {
  return (
    <div
      className="relative rounded-[var(--radius)] p-5 flex flex-col gap-2 overflow-hidden transition-all duration-200 border border-[var(--border-subtle)]"
      style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}
    >
      {/* Accent left bar */}
      <div className="absolute top-3 left-0 bottom-3 w-[3px] rounded-r-full" style={{ background: color }} />
      <div className="flex items-center justify-between pl-3">
        <span className="text-xs text-[var(--text-muted)] font-medium">{label}</span>
        {icon && <span className="text-lg opacity-60">{icon}</span>}
      </div>
      <span className="text-2xl font-bold pl-3" style={{ color }}>{value}</span>
    </div>
  );
}
