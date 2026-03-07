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
      <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] focus-within:border-[var(--accent-purple)]">
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
