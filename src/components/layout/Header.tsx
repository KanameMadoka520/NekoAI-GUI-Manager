interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

/**
 * HUD 模块工具条：mono ❯ 提示符 + 模块标题(中文) + 路径式副标题，右侧操作区。扁平、实色、细线收口。
 */
export function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    <header
      className="h-11 flex items-center justify-between px-5 flex-shrink-0 border-b border-[var(--border-subtle)]"
      style={{ background: 'var(--surface-header)' }}
    >
      <div className="flex items-baseline gap-2.5 min-w-0">
        <span className="ba-halo" aria-hidden />
        <h2 className="text-[16px] font-extrabold text-[var(--text-primary)] leading-none tracking-[0.01em] truncate">{title}</h2>
        {subtitle && <span className="mono text-[11px] text-[var(--text-muted)] truncate hidden md:inline tracking-[0.02em]">// {subtitle}</span>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
