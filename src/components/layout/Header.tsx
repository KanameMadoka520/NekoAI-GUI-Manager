interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    <header
      className="h-14 flex items-center justify-between px-8 flex-shrink-0 border-b border-[var(--border-subtle)]"
      style={{
        background: 'var(--surface-header)',
        backdropFilter: 'blur(var(--header-blur))',
      }}
    >
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] leading-tight">{title}</h2>
          {subtitle && <p className="text-[11px] text-[var(--text-muted)]">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
