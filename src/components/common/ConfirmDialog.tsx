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
      <p className="text-sm text-[var(--text-secondary)] mb-5">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-[var(--text-secondary)] bg-[var(--bg-elevated)] rounded-[var(--radius-sm)] hover:bg-[var(--border-subtle)] cursor-pointer"
        >
          取消
        </button>
        <button
          onClick={() => { onConfirm(); onClose(); }}
          className={`px-4 py-2 text-sm rounded-[var(--radius-sm)] cursor-pointer
            ${danger ? 'bg-[var(--error)] text-white hover:opacity-80' : 'bg-[var(--accent-purple)] text-white hover:opacity-80'}`}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}
