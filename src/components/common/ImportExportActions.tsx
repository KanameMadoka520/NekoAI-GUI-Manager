import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

interface ImportExportActionsProps {
  onExport: () => void;
  onImport: () => void;
  exportLabel?: string;
  importLabel?: string;
  exportDisabled?: boolean;
  importDisabled?: boolean;
  confirmTitle?: string;
  confirmMessage?: string;
  confirmText?: string;
  size?: 'xs' | 'sm';
}

export function ImportExportActions({
  onExport,
  onImport,
  exportLabel = '⬇ 导出',
  importLabel = '⬆ 导入',
  exportDisabled = false,
  importDisabled = false,
  confirmTitle = '导入数据',
  confirmMessage = '导入会覆盖当前数据，请确保选择了正确的 JSON 文件，并备份当前的数据再进行导入。',
  confirmText = '继续导入',
  size = 'sm',
}: ImportExportActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [secondConfirmOpen, setSecondConfirmOpen] = useState(false);

  const cls = size === 'xs'
    ? 'px-3 py-1.5 text-xs rounded-[var(--radius-sm)]'
    : 'px-3 py-2 text-sm rounded-[var(--radius-sm)]';

  return (
    <>
      <button
        onClick={onExport}
        disabled={exportDisabled}
        className={`${cls} bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer disabled:opacity-30`}
      >
        {exportLabel}
      </button>
      <button
        onClick={() => setConfirmOpen(true)}
        disabled={importDisabled}
        className={`${cls} bg-[var(--bg-elevated)] text-[var(--warning)] hover:text-[var(--text-primary)] transition-colors cursor-pointer disabled:opacity-30`}
      >
        {importLabel}
      </button>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          setSecondConfirmOpen(true);
        }}
        title={confirmTitle}
        message={confirmMessage}
        confirmText={confirmText}
        danger={false}
      />

      <ConfirmDialog
        open={secondConfirmOpen}
        onClose={() => setSecondConfirmOpen(false)}
        onConfirm={() => {
          setSecondConfirmOpen(false);
          onImport();
        }}
        title="二次确认"
        message="此操作将覆盖当前数据，存在误操作风险。请确认你已完成备份，并仍要继续。"
        confirmText="我已了解，继续导入"
      />
    </>
  );
}
