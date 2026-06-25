import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmText = '确认', danger = true }: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="380px">
      <p className="text-sm text-[var(--text-secondary)] mb-5 leading-relaxed">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-[var(--text-secondary)] bg-[var(--bg-elevated)] rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          取消
        </button>
        <button
          onClick={() => { onConfirm(); onClose(); }}
          className={`px-4 py-2 text-sm rounded-[var(--radius-sm)] text-[var(--on-accent)] cursor-pointer
            ${danger ? 'bg-[var(--error)] hover:opacity-85' : 'bg-[var(--accent-purple)] hover:opacity-85'}`}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}
