interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  children?: React.ReactNode;
  onEnter?: () => void;
}

export function SearchBar({ value, onChange, placeholder = '搜索...', children, onEnter }: SearchBarProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] transition-colors focus-within:border-[var(--accent-purple)] focus-within:shadow-[0_0_0_3px_var(--focus-ring)]">
        <span className="text-[var(--text-muted)] text-sm">🔍</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onEnter?.();
            }
          }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs cursor-pointer"
          >
            ✕
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
