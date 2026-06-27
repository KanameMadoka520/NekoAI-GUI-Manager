import { useState, useRef, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * 备注收拢用的 info 图标：把原本常驻占地的说明文字收成一个 ⓘ，鼠标移上或点击才弹出说明。
 * 气泡用 portal 渲染到 body + fixed 定位，避免被 overflow-hidden 的面板裁掉；
 * 悬停即显、点击则钉住（再点或点空白处关闭）。
 */
export function InfoHint({ text, className = '', stop = true }: { text: ReactNode; className?: string; stop?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const place = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    let left = r.left - 4;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - 12 - width;
    if (left < 12) left = 12;
    setPos({ top: r.bottom + 6, left, width });
  };
  const show = () => { place(); setOpen(true); };
  const hide = () => { if (!pinned) setOpen(false); };

  useEffect(() => {
    if (!pinned) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setPinned(false); setOpen(false); }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [pinned]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => { if (stop) e.stopPropagation(); e.preventDefault(); const n = !pinned; setPinned(n); if (n) show(); else setOpen(false); }}
        className={`inline-flex items-center justify-center w-[15px] h-[15px] shrink-0 rounded-full border border-[var(--border-hover)] text-[10px] font-semibold leading-none text-[var(--text-muted)] hover:text-[var(--accent-purple)] hover:border-[var(--accent-purple)] cursor-help align-middle ${className}`}
        aria-label="说明"
        title=""
      >i</button>
      {open && pos && createPortal(
        <div
          className="fixed z-[2147483600] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-2 text-[12px] leading-relaxed text-[var(--text-secondary)]"
          style={{ top: pos.top, left: pos.left, width: pos.width, background: 'var(--surface-card-solid)', boxShadow: 'var(--shadow-pop)' }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={hide}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
