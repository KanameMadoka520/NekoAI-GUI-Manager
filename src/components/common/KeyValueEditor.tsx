import { useState } from 'react';

interface KeyValueEditorProps {
  data: Record<string, number>;
  onChange: (data: Record<string, number>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export function KeyValueEditor({ data, onChange, keyPlaceholder = '键', valuePlaceholder = '值' }: KeyValueEditorProps) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const entries = Object.entries(data);

  const handleAdd = () => {
    const k = newKey.trim();
    if (k && newValue !== '') {
      onChange({ ...data, [k]: Number(newValue) });
      setNewKey('');
      setNewValue('');
    }
  };

  const handleRemove = (key: string) => {
    const next = { ...data };
    delete next[key];
    onChange(next);
  };

  const handleValueChange = (key: string, val: string) => {
    onChange({ ...data, [key]: Number(val) });
  };

  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2">
          <span className="text-sm text-[var(--text-secondary)] flex-1 truncate">{k}</span>
          <input
            type="number"
            value={v}
            onChange={(e) => handleValueChange(k, e.target.value)}
            className="w-20 px-2 py-1 text-sm bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-purple)]"
          />
          <button
            onClick={() => handleRemove(k)}
            className="text-[var(--text-muted)] hover:text-[var(--error)] text-xs cursor-pointer px-1"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder={keyPlaceholder}
          className="flex-1 px-2 py-1 text-sm bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-purple)]"
        />
        <input
          type="number"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder={valuePlaceholder}
          className="w-20 px-2 py-1 text-sm bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-purple)]"
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
        />
        <button
          onClick={handleAdd}
          className="px-2 py-1 text-xs bg-[var(--accent-purple)] text-white rounded-[var(--radius-sm)] hover:opacity-80 cursor-pointer"
        >
          +
        </button>
      </div>
    </div>
  );
}
