import { useUiStore } from '../../stores/uiStore';

const typeStyles = {
  success: { bg: '#dcfce7', text: '#166534', icon: '✓' },
  error: { bg: '#fee2e2', text: '#991b1b', icon: '✕' },
  warning: { bg: '#ffedd5', text: '#9a3412', icon: '!' },
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
            className="flex items-center gap-3 px-5 py-3.5 rounded-[var(--radius-sm)] animate-[slideIn_0.3s_ease-out]"
            style={{
              background: style.bg,
              color: style.text,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
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
