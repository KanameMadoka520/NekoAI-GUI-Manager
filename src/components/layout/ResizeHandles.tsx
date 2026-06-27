import { appWindow, PhysicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import { beginWindowBusy, endWindowBusy } from '../../lib/window-busy';

/**
 * 自定义边缘缩放把手。
 *
 * Tauri v1 的前端 API 没有 startResizeDragging（那是 v2 才有），而本窗口是
 * decorations:false 的无边框窗口、系统也不提供原生 resize 边框。这里用 JS 驱动：
 * 监听把手上的 mousedown，记录起始窗口位置/尺寸与鼠标位置，在 mousemove 时按方向
 * 用 setSize/setPosition 实时调整窗口（用 requestAnimationFrame 合并，减少 IPC 抖动）。
 *
 * 仅在 Tauri 桌面端、且窗口未最大化时挂载（由父级决定）。
 */

const MIN_W_LOGICAL = 900;
const MIN_H_LOGICAL = 600;

type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export function ResizeHandles() {
  const startResize = (dir: Dir) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    void (async () => {
      let scale = 1;
      try { scale = await appWindow.scaleFactor(); } catch { scale = 1; }
      let pos: { x: number; y: number };
      let size: { width: number; height: number };
      try {
        const p = await appWindow.outerPosition();
        const s = await appWindow.outerSize();
        pos = { x: p.x, y: p.y };
        size = { width: s.width, height: s.height };
      } catch {
        return; // not in a tauri window context
      }

      const startX = e.screenX;
      const startY = e.screenY;
      const ox = pos.x, oy = pos.y, ow = size.width, oh = size.height; // physical px
      const minW = Math.round(MIN_W_LOGICAL * scale);
      const minH = Math.round(MIN_H_LOGICAL * scale);

      let raf = 0;
      let pending: { w: number; h: number; x: number; y: number } | null = null;

      const flush = () => {
        raf = 0;
        if (!pending) return;
        const p = pending;
        pending = null;
        appWindow.setSize(new PhysicalSize(p.w, p.h)).catch(() => {});
        // 只有真正移动原点的方向（含 n/w）才发 setPosition；e/s/se 不动原点时省掉这次 IPC，
        // 把最常见的右/下/右下缩放从每帧两次 IPC 降到一次。
        if (p.x !== ox || p.y !== oy) {
          appWindow.setPosition(new PhysicalPosition(p.x, p.y)).catch(() => {});
        }
      };

      const onMove = (ev: MouseEvent) => {
        const dx = Math.round((ev.screenX - startX) * scale);
        const dy = Math.round((ev.screenY - startY) * scale);
        let w = ow, h = oh, x = ox, y = oy;
        if (dir.includes('e')) w = ow + dx;
        if (dir.includes('s')) h = oh + dy;
        if (dir.includes('w')) { w = ow - dx; x = ox + dx; }
        if (dir.includes('n')) { h = oh - dy; y = oy + dy; }
        // 夹住最小尺寸；从左/上拉时还要把位置钉回去，避免越过最小宽高后窗口继续平移
        if (w < minW) { if (dir.includes('w')) x = ox + (ow - minW); w = minW; }
        if (h < minH) { if (dir.includes('n')) y = oy + (oh - minH); h = minH; }
        pending = { w, h, x, y };
        if (!raf) raf = requestAnimationFrame(flush);
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        if (raf) { cancelAnimationFrame(raf); flush(); }
        endWindowBusy();
      };

      document.body.style.userSelect = 'none';
      beginWindowBusy(); // 缩放期间瞬时关 blur/动画，降低每帧重绘成本
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    })();
  };

  const base = 'absolute z-[60]';
  return (
    <>
      {/* 四边 */}
      <div className={`${base} top-0 left-3 right-3 h-[5px] cursor-ns-resize`} onMouseDown={startResize('n')} />
      <div className={`${base} bottom-0 left-3 right-3 h-[5px] cursor-ns-resize`} onMouseDown={startResize('s')} />
      <div className={`${base} left-0 top-3 bottom-3 w-[5px] cursor-ew-resize`} onMouseDown={startResize('w')} />
      <div className={`${base} right-0 top-3 bottom-3 w-[5px] cursor-ew-resize`} onMouseDown={startResize('e')} />
      {/* 四角 */}
      <div className={`${base} top-0 left-0 w-3 h-3 cursor-nwse-resize`} onMouseDown={startResize('nw')} />
      <div className={`${base} top-0 right-0 w-3 h-3 cursor-nesw-resize`} onMouseDown={startResize('ne')} />
      <div className={`${base} bottom-0 left-0 w-3 h-3 cursor-nesw-resize`} onMouseDown={startResize('sw')} />
      <div className={`${base} bottom-0 right-0 w-3 h-3 cursor-nwse-resize`} onMouseDown={startResize('se')} />
    </>
  );
}
