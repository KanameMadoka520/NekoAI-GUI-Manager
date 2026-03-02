export const nekoTheme = {
  colors: {
    bg: { base: '#f0f2f5', card: '#ffffff', elevated: '#f8f9fc' },
    text: { primary: '#1e293b', secondary: '#64748b', muted: '#94a3b8' },
    accent: { purple: '#0ea5e9', pink: '#6366f1' },
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',
    border: { subtle: '#e2e8f0', glow: 'rgba(14, 165, 233, 0.2)' },
  },
} as const;

export type NekoTheme = typeof nekoTheme;
