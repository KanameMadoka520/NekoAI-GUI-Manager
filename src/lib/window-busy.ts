/**
 * 窗口忙碌态（拖动 / 缩放）瞬时降载开关。
 *
 * 无边框窗口在 JS 驱动缩放（setSize/setPosition）或原生移动时，WebView2 会每帧重绘整窗。
 * 此时壁纸滤镜、磨砂 blur、各处过渡与背景漂浮动画都会拖慢每帧合成，表现为「拖动卡」。
 * 这里在 <html> 上打 data-window-busy 标记，CSS 据此把这些昂贵效果临时关掉，
 * 拖动/缩放结束后自动恢复——只在交互那几百毫秒内降级，静止时画面照旧精致。
 *
 * 两种用法：
 * - begin/endWindowBusy：成对调用，用于我们能拿到明确起止的交互（如缩放把手 mousedown→mouseup）。
 * - pulseWindowBusy：用于只能拿到「持续 tick」的系统事件（onMoved/onResized），打一拍并在空闲后自动清。
 */

let busyCount = 0;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

function apply(on: boolean) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (on) root.setAttribute('data-window-busy', '1');
  else root.removeAttribute('data-window-busy');
}

export function beginWindowBusy() {
  busyCount += 1;
  if (clearTimer != null) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  apply(true);
}

export function endWindowBusy() {
  busyCount = Math.max(0, busyCount - 1);
  if (busyCount === 0 && clearTimer == null) apply(false);
}

export function pulseWindowBusy(idleMs = 200) {
  apply(true);
  if (clearTimer != null) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    clearTimer = null;
    if (busyCount === 0) apply(false);
  }, idleMs);
}
