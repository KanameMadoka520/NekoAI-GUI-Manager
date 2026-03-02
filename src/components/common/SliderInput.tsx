interface SliderInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  suffix?: string;
}

export function SliderInput({ value, onChange, min = 0, max = 1, step = 0.01, label, suffix = '' }: SliderInputProps) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex items-center gap-3">
      {label && <span className="text-sm text-[var(--text-secondary)] whitespace-nowrap">{label}</span>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--accent-purple) ${pct}%, var(--border-subtle) ${pct}%)`,
        }}
      />
      <span className="text-sm text-[var(--accent-purple)] mono min-w-[50px] text-right">
        {value.toFixed(step < 1 ? 2 : 0)}{suffix}
      </span>
    </div>
  );
}
