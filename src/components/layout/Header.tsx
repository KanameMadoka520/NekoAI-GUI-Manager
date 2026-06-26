interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    <header
      className="glass-shell h-14 flex items-center justify-between px-8 flex-shrink-0 border-b border-[var(--border-subtle)]"
      style={{
        background: 'var(--surface-header)',
      }}
    >
      <div className="flex items-center gap-3">
        <span
          className="w-1 h-8 rounded-[var(--radius-pill)] bg-[var(--accent-purple)] flex-shrink-0"
          style={{ boxShadow: '0 0 12px var(--accent-glow)' }}
        />
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] leading-tight tracking-[0.01em]">{title}</h2>
          {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
