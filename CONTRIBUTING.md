# CONTRIBUTING

感谢你参与 NekoAI GUI Manager 的开发。

本文档面向「第一次参与本项目」的开发者，目标是让你从 0 到能本地跑起来、改动代码、提交可用 PR。

---

## 1. 项目定位与范围

- 本仓库中的 **NekoAI GUI Manager** 是桌面可视化管理工具（Tauri + React）。
- 它用于编辑和查看 NekoAI 插件相关配置与数据。
- 本仓库里还有 `koishi-plugin-TCY-nekoAI`，但 GUI 开发一般只改 `NekoAI GUI Manager/`。

> 开发前请先确认：本次需求是改 GUI 还是改插件。

---

## 2. 技术栈概览

### 前端

- React 19 + TypeScript
- Vite 7
- Tailwind CSS 4
- Zustand（UI 状态，例如 Toast）
- dnd-kit（API 列表拖拽）
- Recharts（历史统计图）

### 桌面后端（Tauri）

- Tauri v1
- Rust（配置读写、历史读取、记忆文件、API 测试、文件监听）

---

## 3. 目录速览（只看最常改的）

```text
NekoAI GUI Manager/
├─ src/
│  ├─ App.tsx                     # 页面容器、全局弹窗、刷新逻辑、主题/漂浮层挂载
│  ├─ pages/
│  │  ├─ ApiManager.tsx           # API 管理（拖拽、测试、保存）
│  │  ├─ ConfigEditor.tsx         # 运行时配置编辑
│  │  ├─ PersonalityManager.tsx   # 人格管理
│  │  ├─ MemoryViewer.tsx         # 记忆查看与编辑
│  │  ├─ HistoryViewer.tsx        # 历史查看与统计（模型主题映射）
│  │  ├─ CommandManager.tsx       # 命令列表管理
│  │  ├─ OpsCenter.tsx            # 安全发布中心（快照/模板/自检/审计）
│  │  ├─ Dashboard.tsx            # 概览页
│  │  └─ Setup.tsx                # 首次配置目录
│  ├─ hooks/
│  │  ├─ useFileWatcher.ts        # 外部文件变更监听（前端事件处理）
│  │  ├─ useUndoRedo.ts           # 撤销/重做
│  │  └─ useKeyboardShortcuts.ts  # 快捷键
│  ├─ lib/
│  │  ├─ types.ts                 # TS 类型定义
│  │  ├─ tauri-commands.ts        # 前端调用 Tauri 命令封装
│  │  └─ json-transfer.ts         # 统一 JSON 导入/导出（时间戳命名 + 文件读取）
│  ├─ stores/
│  │  └─ uiStore.ts               # UI 持久化设置（主题/缩放/侧栏/漂浮密度）
│  ├─ components/
│  │  └─ layout/
│  │     ├─ CustomTitlebar.tsx    # 主题化窗口标题栏与窗口控制按钮
│  │     └─ AmbientFx.tsx         # 全局背景漂浮层（伪代码串+几何图形）
├─ src-tauri/
│  ├─ src/main.rs                 # 注册 Tauri 命令
│  ├─ src/data_root.rs            # EXE 同级数据目录工具
│  ├─ src/ops.rs                  # 安全发布中心后端能力
│  ├─ src/config.rs               # 配置读写（保存时自动快照+审计）
│  ├─ src/memory.rs               # 记忆读写
│  ├─ src/history.rs              # 历史读写与导出/导入
│  ├─ src/api_test.rs             # API 连通测试
│  └─ src/watcher.rs              # 文件变更监听
└─ README.md
```

---

## 4. 环境准备（Windows / Linux）

### 4.0 本地数据目录约定（Phase1+2 新增）

打包运行时，应用会在 `nekoai gui manager.exe` 同级创建：

- `NekoAI-GUI-Data/`
  - `snapshots/`（快照）
  - `deploy-packages/`（部署包）
  - `env-templates/`（环境模板）
  - `diagnostics/`（自检报告）
  - `audit/`（审计日志）

开发/调试涉及这些功能时，请优先检查该目录是否有读写权限。

### 4.1 通用要求

- Node.js 18+
- npm 8+
- Rust + Cargo（建议 rustup 安装）

### 4.2 Windows

1. 安装 Node.js（LTS）
2. 安装 Rust（rustup-init）
3. 安装 Visual Studio C++ Build Tools（MSVC）
4. 建议安装/确认 WebView2 Runtime
5. 重新打开 PowerShell

### 4.3 Linux（Debian/Ubuntu）

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.0-dev libgtk-3-dev libssl-dev pkg-config librsvg2-dev patchelf
```

---

## 5. 首次拉起项目

进入项目目录：

```bash
cd "NekoAI GUI Manager"
```

安装依赖：

```bash
npm install
```

启动开发模式：

```bash
npx tauri dev
```

如果只调前端 UI：

```bash
npm run dev
```

---

## 6. 构建与打包

### 6.1 仅前端构建

```bash
npm run build
```

### 6.2 Tauri 打包（推荐命令）

```bash
npx tauri build
```

> 本项目没有 `npm run tauri:build` script，请直接使用 `npx tauri build`。

### 6.3 Windows 常见平台错误（重要）

如果你看到类似：

- `EBADPLATFORM @rollup/rollup-linux-x64-gnu`

说明当前目录带入了 Linux 专用依赖（常见于跨系统拷贝 node_modules/lock）。执行：

```powershell
npm uninstall @rollup/rollup-linux-x64-gnu
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm install
```

---

## 7. 开发流程（建议）

1. 从 `main` 拉最新代码
2. 新建分支：`feat/...` / `fix/...`
3. 实现改动（优先小步）
4. 本地验证（至少 `npm run build`）
5. 自测关键流程（见第 10 节）
6. 提交 PR，写清楚：
   - 改了什么
   - 为什么改
   - 如何验证
   - 有无影响范围

---

## 8. 代码风格与改动原则

### 8.1 基本原则

- 小改动优先，不做无关重构
- 复用现有组件和模式
- 不引入不必要抽象
- 保持现有中文 UI 文案风格一致

### 8.2 TypeScript 约定

- 类型导入用 `import type`
- 尽量避免 `any`
- 变更数据结构时同步更新 `src/lib/types.ts`

### 8.3 UI 与状态

- 用户可感知数据变更时，给出清晰反馈（Toast / 文案）
- 需要显式保存的页面，必须有 “dirty/未保存” 提示
- 删除类操作尽量有确认对话框

### 8.4 文件读写与安全

- 前端通过 `src/lib/tauri-commands.ts` 调用后端，不要直接绕过
- 配置写入应保持现有备份机制
- 不要把密钥打印到日志或错误信息里

---

## 9. 高风险区域（修改前先评估）

以下区域影响面大，改动时请额外谨慎并加强验证：

- `src/pages/ApiManager.tsx`：拖拽排序、activeIndex 映射、批量状态映射
- `src/pages/ConfigEditor.tsx`：默认值和空配置加载逻辑
- `src/hooks/useFileWatcher.ts` + `src/App.tsx`：外部变更提示与刷新逻辑
- `src-tauri/src/api_test.rs`：连通性测试实现

### 当前项目约定（务必遵守）

当问题来源于本机网络/防火墙权限时，不要通过修改 Ping/连通性测试逻辑来“修复”症状。

---

## 10. 最小回归清单（提交前）

至少手测以下内容：

1. **Setup**：首次目录选择可用，错误路径有提示
2. **API 管理**：
   - 新增/编辑/保存
   - 拖拽后出现“需保存”提示
   - 展开/收起单个与全部 API key栏，显示/隐藏全部 Key
   - 导入/导出可用（导入二级确认）
3. **配置编辑**：
   - 空配置可加载
   - 修改后可保存
   - runtime 导入/导出可用（导入二级确认）
   - 恢复全部默认为二级确认
4. **人格管理**：
   - 启用/克隆/删除按钮可用
   - 删除后活跃索引正确
   - 群聊/私聊人格分别导入导出可用（导入二级确认）
5. **长期记忆**：
   - 当前会话导入/导出可用（导入二级确认）
6. **历史记录**：
   - 搜索按钮与搜索框交互正常，Enter 可触发搜索
   - 无关键词时仅按筛选条件也可搜索
   - 模型多选为严格匹配（不误命中相似模型名）
   - 时间范围筛选可命中对应历史记录（兼容常见时间格式）
   - 搜索视图统计会按筛选结果重算（总调用/成功/异常/异常率/总字数）
   - 当前文件导入/导出可用（导入二级确认）
7. **命令管理**：
   - 导入/导出可用（导入二级确认）
8. **外部修改监听**：
   - 修改配置文件后出现提示
   - “刷新页面”可生效
9. **安全发布中心（Ops）**：
   - 快照创建/列表/回滚/差异可用
   - 部署包导出可用（目录包 + manifest）
   - dev/test/prod 模板保存/预览/应用可用
   - 启动前自检可跑，自动修复可修项后可重新通过
10. **构建**：`npm run build` 通过

如果你改到了 Tauri/Rust 层，再额外验证：

- `npx tauri build` 能过（至少在你当前平台）

---

## 11. 如何新增一个页面（新手模板）

1. 在 `src/pages/` 新建 `YourPage.tsx`
2. 在 `src/App.tsx` 中：
   - lazy import 页面
   - 在 `pageTitles` 增加标题和副标题
   - 在渲染分支中挂载页面
3. 在 `src/components/layout/Sidebar.tsx` 里增加导航项
4. 若需要后端数据：
   - 优先复用 `tauri-commands.ts` 现有命令
   - 新命令需同时改 `src-tauri/src/main.rs` 和对应模块

---

## 12. 常见问题排查

### Q1: `npm install` 在 Windows 报平台不支持
优先按第 6.3 节做“干净重装”。

### Q2: `npm run tauri:build` 找不到脚本
使用 `npx tauri build`。

### Q3: `npx tauri build` 失败但 `npm run build` 成功
说明 Rust/Tauri 侧依赖或环境缺失，检查 Rust、系统依赖和编译工具链。

### Q4: 改动后 UI 没刷新
先看是否页面有 `refreshKey` 机制，再确认是否触发了对应状态更新。

---

## 13. 提交信息建议格式

建议使用：

- `feat: ...` 新功能
- `fix: ...` 缺陷修复
- `refactor: ...` 重构（无行为变化）
- `docs: ...` 文档更新

示例：

- `fix: add missing showKey state in API manager`
- `docs: add cross-platform build instructions`

---

## 15. 当前开发状态（2026-03）

### 已实现（本轮）

- 安全发布中心（Phase1+2 MVP）
  - 新增页面：`OpsCenter.tsx`（快照、部署包、模板、自检、审计）
  - `save_config` 后自动快照（runtime/api/personality/commands）
  - 快照能力：创建、列表、回滚、双快照差异对比
  - 环境模板：dev/test/prod 保存、预览、应用（应用后自动快照）
  - 启动前自检：缺失文件、JSON 解析、索引/类型检查，可修项自动修复
  - 审计日志：关键操作写入 `NekoAI-GUI-Data/audit/*.jsonl`
  - OpsCenter 布局优化：新增顶部摘要、面板说明与可折叠工具区，统一安全治理页面层级
- EXE 同级数据目录（新增）
  - `NekoAI-GUI-Data/` 自动创建并持久化 `snapshots/`、`deploy-packages/`、`env-templates/`、`diagnostics/`、`audit/`

- API 批量测试流式回传（progress/done 事件）
- API 治理（P0）
  - 智能路由策略编辑器 MVP（主模型/备用模型/降级策略/重试参数/策略预览）
  - 节点评分系统 MVP（实时测试 + 历史表现），支持健康分展示、排序与等级筛选
  - 节点评分增强版：评分解释面板（分值构成/扣分原因）+ Live/History 权重滑杆（写入 runtime）
  - 节点评分第二轮增强：补充超时率/抖动维度，解释区增加进度条展示，并支持 Live/History/Timeout/Jitter 多权重组合
  - API 管理页布局优化：顶部摘要栏、主/次工具栏分层、节点卡片摘要优先 + API key栏按节点/全部展开收纳、评分解释仪表化
  - ApiManager 公共组件统一：已接入 `Panel` / `SummaryCard`，与其他核心页面保持一致布局层级
  - 安全提示增强：API 管理页与安全发布中心均新增“分享前移除 api_config.json”风险提示
- 前端性能优化（针对拖拽卡顿）
  - `uiStore` 设置持久化改为延迟合并写入（defer localStorage）
  - 文件监听 Toast 加入 2 秒节流，减少事件风暴
  - AmbientFx 在交互密集页面默认关闭，仅在 dashboard/ops 启用
  - ApiManager 节点卡片使用 `memo`，降低批量测试、筛选和滑杆调整时的重复渲染
- Setup 页面路径示例修正 + 打开目录按钮
- 记忆页外部变更监听改为页面内刷新（避免全局打断）
- MemoryViewer 布局优化：新增顶部摘要、会话列表说明与详情页工具收纳区，降低记忆治理视图拥挤感
- 长期记忆详情支持序列化字符串格式解析/回写
- 历史记录补充“输入/输出/上下文/响应时间”并优化纯图片提示
- 历史时间线点击定位到对应记录
- HistoryViewer 搜索交互增强（按钮分隔更清晰、Enter 搜索、无关键词筛选搜索）
- HistoryViewer 搜索区布局优化：改为主搜索条 + 可折叠高级筛选面板，减少顶部控件拥挤感
- 各页面新增 JSON 导入/导出（按单子文件粒度，导入前二级确认）
  - API：`api_config.json`
  - 配置编辑：`runtime_config.json`
  - 人格：`group_personality.json` / `private_personality.json`
  - 记忆：当前会话文件
  - 历史：当前选中文件（新增 `import_history_file`）
  - 命令：`commands.json`
- 历史高级筛选：模型多选、时间范围、错误类型多选、筛选方案保存/应用/删除
- 修复历史模型多选误命中：后端模型过滤从 contains 调整为严格匹配
- 修复历史时间范围筛选失效：后端时间解析兼容 RFC3339 + 常见本地时间格式
- 搜索视图统计口径升级：按筛选结果重算统计卡，Token 文案调整为总字数
- 配置编辑“恢复全部默认”改为二级确认
- ConfigEditor 布局优化：新增“常用 / 完整”模式、顶部摘要栏与更清晰的章节说明，降低表单堆叠感
- PersonalityManager 布局优化：新增顶部摘要、导入导出折叠区与更清晰的人格卡片信息层级
- Dashboard 布局优化：新增顶部摘要条、统一面板说明与概览区块层级
- 公共组件抽取（本轮已完成一轮）：已新增并接入 `Panel` / `SummaryCard`，统一 Dashboard / ApiManager / HistoryViewer / ConfigEditor / PersonalityManager / MemoryViewer / OpsCenter 的主要面板与摘要样式
- 修复 Rust 编译错误：恢复 `export_history` 命令注册链路

### 尚需回归确认（请勿在未验证前宣称完成）

1. API 批量测试通过率与真实机器人调用一致性
2. API 节点评分（MVP）在真实历史数据下的稳定性与权重合理性
3. 前端性能优化后（拖拽/滚动/切页）在你 Windows 实机上的卡顿改善程度
4. 不同平台（Windows/Linux）构建与打包一致性
5. 安全发布中心在 Windows 打包产物下的目录权限与路径一致性（`NekoAI-GUI-Data`）
6. 启动前自检在异常配置样本上的误报率（尤其类型错误检测）

### 合并前强制检查

- [ ] Windows 本机 `npx tauri build` 通过
- [ ] 回归清单关键项通过（API/Memory/History/Setup/Ops）
- [ ] README 的“本轮进展”与实际代码状态一致
- [ ] 未把“待验证项”写成“已完成”

---

## 16. 当前开发目标（下一阶段，执行基线）

> 本节是后续迭代的执行基线。下一位开发者应先对照本节，再开始编码。

### 16.1 目标总览

在已落地的安全发布能力（快照/部署包/模板/自检/审计）基础上，继续实现以下三大方向：

1. **API 治理（P0）**
2. **Prompt/人格工程（P1）**
3. **长期记忆治理（P2）**

并保持以下硬约束：

- 所有安全保存数据继续写入 `nekoai gui manager.exe` 同级目录 `NekoAI-GUI-Data/`
- 不破坏现有 Phase1+2 能力
- 每一小项以 MVP 先落地，再迭代增强

### 16.2 API 治理（P0）

#### A. 智能路由策略编辑器（可视化）

- ✅ 已完成 MVP：主模型、备用模型、降级策略、失败重试参数、策略预览
- 与现有 `runtime_config.smartRouter` 兼容，不做破坏性字段替换

#### B. 节点评分系统

- ✅ 已完成 MVP（当前实现）
- 数据输入：
  - API 批量测试结果（实时 pass/latency）
  - 历史调用聚合指标（调用数、错误率、平均响应时间）
- 评分输出：
  - 统一健康分（0-100）
  - 分档标签（健康/警告/风险）
- 交互要求（已落地）：
  - API 管理页面可见健康分
  - 支持按健康分排序与按等级筛选

> 下一步仅做权重微调，不再从零实现该能力。

### 16.3 Prompt/人格工程（P1）

#### A. 人格 A/B 测试台

- 同一输入并行对比两个人格输出
- 支持人工打分（质量/稳定性/风格一致性）
- 结论可保存并可回看

#### B. 人格冲突检测器

- 检测 prompt 内部互相矛盾指令
- 检测过长提示、重复规则
- 输出问题清单 + 修正建议（不直接自动改写原 prompt）

#### C. 人格模板市场（本地）

- 提供本地模板库
- 支持一键套用与参数化替换
- 支持模板导入/导出与版本标识

### 16.4 长期记忆治理（P2）

#### A. 记忆压缩与归档助手

- 规则化摘要旧记忆，减少上下文噪音
- 可配置阈值与归档范围

#### B. 记忆质量评分

- 标记冗余、重复、低信息密度条目
- 输出可执行清理建议

#### C. 记忆可视化关系图

- 按用户/主题/关键词展示记忆簇
- 支持按簇清理与高噪音簇定位

### 16.5 执行顺序建议

1. API 治理（先做策略编辑器 MVP，再做评分）
2. Prompt/人格工程（先 A/B，再冲突检测，再模板市场）
3. 长期记忆治理（先压缩归档，再评分，再关系图）

### 16.6 每轮迭代交付要求

每完成一个子能力，至少同步四项：

1. 代码与命令注册（前后端）
2. 类型定义（`src/lib/types.ts`）
3. 文档更新（README + CONTRIBUTING）
4. 交接文档更新（`开发交接文档-当前开发目标.md`）

---

## 17. 文档维护规则（README / CONTRIBUTING）

每次功能迭代后必须同步文档：

- README：更新“本轮进展”中的 已完成 / 进行中
- CONTRIBUTING：更新“当前开发状态”与“尚需回归确认”
- 如果某项只在本地或某平台验证过，必须写明验证范围

推荐写法：

- ✅ 已完成：代码已合并 + 至少一轮回归通过
- ⚠️ 待确认：代码已改但缺真实场景验证
- ❌ 未开始：仅计划未实现

---

## 15. 对新贡献者的建议

- 先从小改动开始（文案、样式、单个交互）
- 每次只解决一个问题，便于回归和定位
- 改动前先读相关页面与对应 hooks
- 遇到“看起来能跑但状态错位”的问题，重点检查索引映射和 dirty 状态

---

## 18. 新增：主题系统与动态背景（实现原理，给小白）

这一节专门解释“为什么这样实现”以及“你要改哪里”。

### 18.1 主题系统为什么用 CSS 变量

我们没有把主题颜色写死在组件里，而是统一放在 `src/index.css` 的变量中：

- `:root[data-theme='light']`
- `:root[data-theme='dark']`
- `:root[data-theme='parchment']`

这样做的好处：

1. **切主题不需要重写组件**：组件只引用 `var(--text-primary)`、`var(--surface-card)`。
2. **维护成本低**：想改色只改变量表，不用全项目找十六进制。
3. **避免漏改**：尤其是图表 tooltip、错误色、标签背景这种容易遗漏的细节。

### 18.2 主题是如何“切换生效”的

入口在 `src/App.tsx`：

- 读取 Zustand 的 `settings.theme`
- 执行 `document.documentElement.setAttribute('data-theme', settings.theme)`

当 `data-theme` 变化，CSS 变量立刻切换，页面自动重绘。

### 18.3 设置为什么放 Zustand（`uiStore.ts`）

`src/stores/uiStore.ts` 里维护并持久化这些字段：

- `uiScale`
- `theme`
- `sidebarCollapsed`
- `sidebarWidth`
- `ambientDensity`

`updateSettings()` 会同步写入 `localStorage`，所以重启应用后依然保留用户选择。

### 18.4 自定义标题栏与窗口按钮实现原理

文件：`src/components/layout/CustomTitlebar.tsx`

我们用的是 Tauri Window API：

- `appWindow.minimize()`
- `appWindow.maximize()`
- `appWindow.unmaximize()`
- `appWindow.close()`
- `appWindow.startDragging()`

**重点（小白常踩坑）**：

1. 前端写了按钮还不够，`tauri.conf.json` 必须开启 allowlist 权限。
2. 本项目是 Tauri v1，allowlist 里不能写 `toggleMaximize`。
3. 所以最大化切换要用：
   - `isMaximized()` 判断
   - 再调用 `maximize()` 或 `unmaximize()`

### 18.5 背景漂浮层（AmbientFx）是怎么做的

文件：`src/components/layout/AmbientFx.tsx`

#### A) 为什么是“伪代码串”而不是真代码

目标是视觉气质，不是可执行逻辑。我们用“词根 + 符号 + 随机片段”拼接，做成“看起来像代码”的字符串。

示例形态：

- `node.trace(Ab3)`
- `flux_ab12=>734`
- `ink::folio.x2Zk`

#### B) 字串长度分布（重点）

按概率控制，不是纯随机：

- 10% 极短串（4~5）
- 65% 中短串（8~13）
- 25% 长串（14~21）

这样视觉更自然，不会全是短碎片。

#### C) 页面分区加权

粒子不是全屏均匀撒点，而是按区域配额：

- 主内容区最多
- 侧栏次之
- 标题栏最少

这样既有设计感，又不抢核心内容注意力。

#### D) 主题语法偏好

同一个生成器会按主题切换词根和符号偏好：

- Light：`::`, `=>`, `..` 等
- Dark：`->`, `<<`, `>>` 等
- Parchment：`::`, `~>`, `<>` 等

所以你会看到三主题不仅颜色不同，连“语法气质”也不同。

#### E) 漂浮密度三档

`ambientDensity` 控制粒子数量倍率：

- `low`
- `medium`（默认）
- `high`

设置入口在 `App.tsx` 的“显示设置”弹窗。

### 18.6 羊皮纸“墨迹衰减”效果原理

在 `index.css` 里对 `:root[data-theme='parchment'] .ambient-glyph` 使用：

- 多层 `text-shadow`（近强远弱）
- `ambientInkPulse` 动画（轻微明暗波动）

它不是闪烁特效，而是模拟墨迹在纸面上的扩散与衰减。

### 18.7 改这套系统时的安全边界

- 不要把漂浮层 z-index 放到内容层之上（会影响点击）
- 保持 `pointer-events: none`
- 不要在组件中写死颜色，尽量走 token
- 改窗口按钮逻辑时，先确认 `tauri.allowlist.window` 对应权限

---

欢迎提交改进，感谢参与。
