import { useEffect } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}

export function Modal({ open, onClose, title, children, width = '480px' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" onClick={onClose}>
      {/* Backdrop with blur */}
      <div className="absolute inset-0 bg-black/40" style={{ backdropFilter: 'blur(5px)' }} />
      {/* Panel with bounce pop animation */}
      <div
        className="relative bg-white rounded-[var(--radius)] flex flex-col max-h-[85vh] overflow-hidden animate-[modalPop_0.35s_var(--ease-bounce)]"
        style={{ width, boxShadow: '0 10px 25px rgba(0,0,0,0.15)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border-subtle)]">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-lg cursor-pointer w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--bg-elevated)]"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
      </div>
    </div>
  );
}
