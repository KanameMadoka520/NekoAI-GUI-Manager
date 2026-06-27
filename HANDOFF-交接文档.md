# NekoAI GUI Manager — 开发进度交接文档

> 更新日期：2026-06-27
> 项目路径：`D:\_CodeNotSync\NekoAI GUI Manager`
> 当前进度：见 `git log`（「游戏启动器」风重构 + 桌面窗口增强 已入库；透明圆角已回退，详见第六节）

---

## 一、一句话现状

> **「游戏启动器」风 UI 重构 已完成并编译入库；桌面窗口增强中「边缘缩放拖动」「无目录只读浏览」已落地，
> 「透明圆角」因在 Windows 上导致窗口不可见已回退。** 干净基线 `d0ee22a` 之上新增数个提交，三主题
> （light / dark / parchment）+ lite 自检通过，功能/交互/用户可见中文文案保持不变。已产出 exe / msi / nsis，
> **未自动部署，由用户自行部署**。

---

## 二、项目技术栈（事实，已核对）

- **桌面外壳**：Tauri v1（Rust `tauri 1.8`），自定义无边框标题栏（`decorations:false`）。
- **前端**：React 19 + TypeScript + Vite 7。
- **样式**：Tailwind v4 + **CSS 变量设计令牌**（`src/index.css` 是整个设计系统的核心与唯一真源）。
- **主题机制**：`data-theme` 切换三套主题 `light` / `dark` / `parchment`；`data-render-mode='lite'` 是低性能模式（全局关动画/过渡/backdrop-filter/阴影/壁纸）。还有 density + uiScale + 壁纸暗度（`data-wallpaper-dim`）。
- **令牌驱动**：每个页面都引用 `var(--...)` 令牌 + 共享 primitives，改令牌/primitive 即可全局级联。
- **包名**：`nekoai-gui-manager`，窗口/产物名 `NekoAI Manager`。

### 构建命令（事实）
```
npm install        → 首次拉依赖（本 checkout 初始无 node_modules）
npm run build      → ensure-rollup-native + tsc -b + vite build（仅前端）
npx tauri build    → 出 exe + msi + nsis 安装包
```

### 产物路径（事实，已核对存在）
- 可执行：`src-tauri/target/release/NekoAI Manager.exe`
- 安装包：`src-tauri/target/release/bundle/msi/` 和 `.../bundle/nsis/`

---

## 三、已完成的工作（git 历史，已入库）

干净基线之后的提交（从旧到新；新提交见 `git log`）：
- `d0ee22a` 修复对抗式审查发现的两处瑕疵 ← 重构前的干净基线
- `39203bc` 大刀阔斧重构GUI为「游戏启动器」风：设计令牌/壁纸/右侧栏/概览Hero/共享组件
- `75641b8` 各功能页适配启动器主题：对抗式审查发现的半透明可读性与令牌一致性修复
- `9d092e7` 桌面窗口三项增强：边缘缩放拖动 + 圆角透明不露馅 + 无目录只读浏览
- 之后：透明圆角回退修复（窗口在 Windows 上不可见）、交接文档整理（见 `git log`）

### 3.1 「游戏启动器」风视觉重构（用户拍板的最终方向）
经 AskUserQuestion 四问拍板：
1. **视觉方向＝游戏启动器风**：壁纸虚化打底、发光蓝高饱和强调、深色大圆角磨砂磁贴、边缘微高光。
2. **壁纸＝内置可换壁纸**：内置 5 套零版权抽象壁纸（深蓝/星云/琥珀/石墨/晴空）+ 纯色 + 自定义图片 URL + 暗度三档；入口在「显示设置 · 壁纸打底」。
3. **侧栏＝搬到右侧**（含布局重排、resize 反向、边框/活跃条/折叠箭头适配）。
4. **概览页＝改造成 Hero 首页**：大时钟 + 问候 + 日期 Hero、快速开始磁贴（直达其余 9 页）、双列信息卡；其余功能页只统一换深色玻璃皮肤。

实现地基：重写 `src/index.css` 令牌（保留全部旧令牌名使各页自动级联）+ 共享 primitives。经 22 个并行代理对抗式审查，修掉 1 高 + 6 中 + 高价值低问题。

### 3.2 桌面窗口增强
- **边缘缩放拖动（已落地）**：Tauri v1 前端无 `startResizeDragging`（v2 才有）、无边框窗口也无系统原生 resize 边框，故 JS 驱动——`src/components/layout/ResizeHandles.tsx` 八向把手用 `setSize`/`setPosition`（`scaleFactor` 换算 + rAF 合并 + 最小 900×600），最大化时不挂载。配套 `Cargo.toml` 开启 `window-set-size`/`window-set-position`、`tauri.conf` allowlist 放开 `setSize`/`setPosition`。
- **无目录只读浏览（已落地）**：Setup 新增「暂不连接，先进入只读浏览」。读写闸门集中在 `src/lib/runtime-bridge.ts` 的 `invokeCompat`——在 `set_plugin_dir` 真正连接目录前，拒绝一切依赖目录的读写命令（仅放行 `DIR_OPTIONAL_COMMANDS` 白名单：连接目录/查询后端上下文/打开链接/本地 Web 服务管理），实现「未连接目录也能进入并浏览所有页面，但零文件读写；连接目录后恢复读写」。配套 `resetPluginDirConnection`、内容区只读横幅（一键连接）、`addToast` 抑制该态读取失败刷屏、启动自检在无目录时跳过。
- **窗口圆角（已回退，待安全方案）**：曾用 `tauri.conf` `transparent:true` + `.app-shell` 圆角实现真圆角，但在用户 Windows(WebView2) 实机上导致**整窗不可见、任务栏点击也无法恢复**，已回退（恢复不透明方角窗口）。若仍需圆角，建议改用 **Windows 11 原生 DWM 圆角**（Rust 侧调 `DwmSetWindowAttribute` 设 `DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND`），不依赖透明、无不可见风险；`minWidth/minHeight` 保留。

---

## 四、铁律约束（保留给后续维护者）

1. **功能 / 交互 / 可用性 / 一切用户可见中文文案 完全不变**，只改视觉/壳层（壁纸功能、概览 Hero、窗口缩放、无目录只读为本轮授权的新增项）。提交前用 `git -c core.whitespace=cr-at-eol diff --ignore-cr-at-eol` 核对。
2. **性能要更高、不能压爆核显**：`backdrop-filter` blur 只用于外壳少数固定面板（标题栏/侧栏/页头/弹层），**绝不**用于长列表/表格行每个元素；卡片用「半透明渐变 + 边框高光」模拟玻璃；动画只用 transform/opacity；lite 模式把玻璃/壁纸/glow 降级为不透明纯色。
3. **不要自动部署到 Koishi 目录**。用户自己部署，接手人只产出最新编译版并告知路径。
4. **编译前先杀掉正在运行的 `NekoAI Manager` 进程**，否则 exe 被占用、构建写不进去。
5. **CRLF/LF（已核实）**：本 checkout 的 HEAD blob 其实是 **LF**，且 `core.autocrlf=true`、无 `.gitattributes`。**直接 `git add` 即得干净 LF blob**，无需手动转 CRLF；用 `--ignore-cr-at-eol` 复核真实差异。
6. **提交规范**：作者 `KanameMadoka520 <2441883200@qq.com>`，`+0800`（用 `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`），**详细中文 commit message**，关键节点提交。
7. **桌面壳层改窗口属性需实机验证**：无头环境跑不起 Tauri 窗口；`transparent` 类改动尤其要在真实 Windows 上确认（本轮透明圆角即因未实机验证而翻车，务必引以为戒）。

---

## 五、验证流程（每次改完照做）

1. `npm run build`（tsc + vite），零错误。
2. 三主题 + lite 自检（无头环境可用 Chrome headless 对静态预览截图核对配色/对比）。
3. 中文文案/逻辑零改动核对。
4. 直接 `git add` 按规范中文提交。
5. 杀进程 → `npx tauri build`。
6. 用 Vite 产物**内容哈希文件名**核对 exe 里嵌入的确实是新前端，再报告路径；**先在磁盘验证再下结论**。
7. **改了窗口属性的，务必请用户实机验证窗口能正常显示/缩放/关闭**。

---

## 六、已知待办 / 需实机确认

1. **窗口圆角**：已回退透明方案。如需，按 3.2 用 Win11 原生 DWM 圆角实现（不依赖透明、零不可见风险）。
2. **边缘缩放手感**：JS 驱动比原生略有跟手延迟；最小 900×600。若某条边/角与右上角关闭按钮、右侧栏边缘有极小重叠不顺手，可微调 `ResizeHandles` 把手尺寸或避让区域。
3. **壁纸自定义来源**：当前自定义壁纸走「图片 URL」（CSP 为 null）。`fs` allowlist 关闭、未启用 asset 协议，故暂不支持「本地文件选壁纸」；如需，要在 Rust 侧开 asset 协议 + 重新编译。

---

## 七、历史教训（避免重蹈）

- 曾**凭空捏造**用户已选某方向就开干 → 必须以用户真实回答为准（本轮方向均经 AskUserQuestion 确认）。
- 曾误报「文件损坏」结果是自己看错行 → 一切文件状态以实际 Read 为准。
- 曾因旧 exe 仍在运行导致「看起来没变」误以为编译错 → 编译前先杀进程，编译后核对哈希。
- 曾过早宣布成功 → 先在磁盘验证再下结论。
- **曾给无边框窗口加 `transparent:true` 做圆角，未实机验证就交付，导致用户窗口整窗不可见 → 任何改窗口属性的改动必须实机验证；透明窗口在 Windows/WebView2 上尤其高危。**

---

## 八、第二轮迭代（2026-06-28，commits 5a55889 + 8c433a2）

用户反馈：①窗口拖动卡；②UI 没本质变化，希望细分模块并分页、放大过小字体；③无目录时用 demo 演示数据看页面效果。

1. **拖动/缩放性能**：`ResizeHandles` 每帧仅在原点移动（n/w）时才发 `setPosition`，最常见的右/下/右下缩放只发一次 `setSize`；新增 `lib/window-busy.ts`，拖动/缩放期间在 `<html>` 打 `data-window-busy`，CSS 临时关掉壁纸蒙版过渡、磨砂 blur、全部过渡与背景漂浮动画，让每帧重绘变廉价。
2. **内置 demo 演示数据**：`lib/demo-data.ts` 提供写死、连贯、强类型的假数据；`runtime-bridge` 的 `setDemoMode/isDemoMode` + `invokeCompat` 顶部拦截。未连接目录的只读浏览改为「挂载真实页面 + 演示数据 + 顶部演示横幅」，写操作不落盘、绝不创建真实文件。（取代了上一版的占位卡方案。）
3. **放大过小字体**：根字号 16→16.5px；批量上调 ≤11px 的字号（约 270 处）。
4. **页内子标签**：新增 `components/common/SubTabs.tsx`；用量/历史/发布中心/配置编辑四个重页面拆成 2-4 个页内分段。ApiManager 本就有「文本/图像」模式切换作天然分页、聊天模式是左右并排一体编辑流，故未强行加子标签。

校验：`npm run build` 通过；`eslint` rules-of-hooks 计数为 0；`npx tauri build` 产物（**未自动部署，用户自行部署**）已用内容哈希核对 exe 内嵌新前端。
