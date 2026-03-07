interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

export function ToggleSwitch({ checked, onChange, label }: ToggleSwitchProps) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-[var(--radius-sm)] transition-colors duration-200 cursor-pointer border
          ${checked ? 'bg-[var(--accent-purple)] border-[var(--accent-purple)]' : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)]'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-[4px] bg-[var(--surface-card)] transition-transform duration-200 border border-[var(--border-subtle)]
            ${checked ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </button>
      {label && <span className="text-sm text-[var(--text-secondary)]">{label}</span>}
    </label>
  );
}
