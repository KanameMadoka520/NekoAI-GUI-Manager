import { useUiStore } from '../../stores/uiStore';

const typeStyles = {
  success: { bg: 'var(--toast-success-bg)', text: 'var(--toast-success-text)', icon: '✓' },
  error: { bg: 'var(--toast-error-bg)', text: 'var(--toast-error-text)', icon: '✕' },
  warning: { bg: 'var(--toast-warning-bg)', text: 'var(--toast-warning-text)', icon: '!' },
};

export function ToastContainer() {
  const toasts = useUiStore((s) => s.toasts);
  const removeToast = useUiStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => {
        const style = typeStyles[t.type];
        return (
          <div
            key={t.id}
            className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-sm)] animate-[slideIn_0.2s_ease-out] border border-[var(--border-subtle)]"
            style={{
              background: style.bg,
              color: style.text,
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <span className="font-bold text-sm">{style.icon}</span>
            <span className="text-sm flex-1">{t.message}</span>
            <button
              onClick={() => removeToast(t.id)}
              className="opacity-50 hover:opacity-100 text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
