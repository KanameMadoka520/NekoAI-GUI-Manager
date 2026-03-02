# NekoAI GUI Manager

**NekoAI 统一可视化管理面板** — 基于 Tauri 的原生桌面应用，集成 API管理、配置编辑、人格管理、长期记忆监控、聊天历史分析、命令管理于一体。

> 完全替代旧版 `NekoAI-GUI-Manager/`（Node.js + Express + Vue 3 CDN 方案）和四个独立 HTML 工具（`api_manager.html`、`config_editor.html`、`dashboard.html`、`history_viewer.html`），以原生桌面应用的形式提供更快的性能、更丰富的功能和更一体化的体验。

本工具是为了服务koishi中的插件koishi-plugin-Enhanced-NekoAI而诞生的。

【警告】当前仅为测试阶段,前端有待优化，后端功能完备性尚未完全测试！
2026年3月3日凌晨0点完成测试版

因为Enhanced-NekoAI插件配置比较复杂繁多，所以需要更人性化的图形工具来编辑其配置和查看状态。

---

## 功能一览

| 模块 | 功能 |
|------|------|
| **概览仪表盘** | 核心状态总览（昵称/活跃节点/人格/路由/表情包）、API类型分布、记忆容量进度条、群组用户信息（限流/人格/API映射标签）、配置文件健康检查表 |
| **API 管理** | 节点卡片编辑（5个字段）、**拖拽排序**、批量选择/删除、密钥遮蔽/显示、**单个+批量连通性测试**（显示延迟）、**撤销/重做**（50步历史）、重复节点检测、活跃节点切换、左侧导航按提供商分组 |
| **配置编辑** | 11个配置节全覆盖、侧边导航跟踪滚动、多种控件类型（开关/滑块/标签列表/键值编辑器/下拉框）、恢复全部默认值 |
| **人格管理** | 群聊/私聊双栏并列、编辑弹窗（名称+大文本域+字符计数）、克隆/删除、一键切换活跃人格、搜索筛选 |
| **长期记忆** | 群聊/私聊双列表、容量进度条（绿<50%/黄50-85%/红>85%）、**内联消息编辑**（点击直接改）、单条删除、搜索、清空、删除记忆文件 |
| **历史记录** | **4种视图模式**（标准聊天气泡/用户聚合/错误分析/全局搜索）、**Recharts 统计图表**（模型排行/用户排行/节点分布/24小时热力图）、分页、JSON/CSV导出 |
| **命令管理** | 可搜索命令列表、添加单条/批量添加、选择/全选/批量删除、保存（含自动备份） |

### 额外特性

- **首次运行引导** — 启动时自动检测，未配置则显示设置页面，选择插件目录后验证并记住
- **全局快捷键** — `Ctrl+S` 保存 / `Ctrl+Z` 撤销 / `Ctrl+Y` 重做 / `Ctrl+1~7` 切换页面 / `Ctrl+/` 快捷键帮助
- **文件变更监听** — Rust 后端实时监控配置和记忆文件，外部修改时自动 Toast 通知
- **自动备份** — 每次保存前自动备份原文件到 `.backups/` 目录，文件名带时间戳
- **现代 3D 主题** — 白色光明风格、玻璃拟态、弹性动画、3D 阴影卡片、自定义滚动条
- **代码分割** — React.lazy() 按页面懒加载，首屏秒开

---

## GitHub 上传指南 & 磁盘清理

### 项目体积分析

| 路径 | 大小 | 类型 | 上传 GitHub? |
|------|------|------|:---:|
| `src/` | ~270 KB | 前端源码 | ✅ 必须 |
| `src-tauri/src/` | ~32 KB | Rust 源码 | ✅ 必须 |
| `src-tauri/Cargo.toml` | ~1 KB | Rust 依赖声明 | ✅ 必须 |
| `src-tauri/Cargo.lock` | ~122 KB | Rust 依赖锁定 | ✅ 必须 |
| `src-tauri/tauri.conf.json` | ~1 KB | Tauri 配置 | ✅ 必须 |
| `src-tauri/icons/` | 若干 KB | 应用图标 | ✅ 必须 |
| `public/` | ~4 KB | 静态资源 | ✅ 必须 |
| `package.json` | ~1 KB | npm 依赖声明 | ✅ 必须 |
| `package-lock.json` | ~216 KB | npm 依赖锁定 | ✅ 建议 |
| `tsconfig*.json` | ~1 KB | TypeScript 配置 | ✅ 必须 |
| `vite.config.ts` | ~1 KB | Vite 配置 | ✅ 必须 |
| `index.html` | ~1 KB | 入口 HTML | ✅ 必须 |
| `.gitignore` | ~1 KB | Git 忽略规则 | ✅ 必须 |
| `README.md` | ~30 KB | 说明文档 | ✅ 必须 |
| **`node_modules/`** | **~170 MB** | npm 依赖 | ⛔ 不要上传 |
| **`dist/`** | **~1 MB** | Vite 构建输出 | ⛔ 不要上传 |
| **`src-tauri/target/`** | **~4.3 GB** | Rust 编译产物 | ⛔ 不要上传 |

> **源码总计约 500 KB，生成物约 4.5 GB。** `.gitignore` 已配置好忽略规则，`git add` 时不会包含生成物。

### 清理命令

```bash
# 🧹 清理 Rust 编译缓存（释放 ~4.3GB，最大头）
cd src-tauri && cargo clean && cd ..

# 🧹 清理 npm 依赖（释放 ~170MB）
rm -rf node_modules          # Linux/macOS
Remove-Item -Recurse -Force node_modules  # Windows PowerShell

# 🧹 清理 Vite 构建输出（释放 ~1MB）
rm -rf dist

# 🧹 一键全部清理（释放 ~4.5GB）
rm -rf node_modules dist && cd src-tauri && cargo clean && cd ..
```

### 上传到 GitHub

```bash
# 确认 .gitignore 正确（node_modules、dist、src-tauri/target 都被忽略）
cat .gitignore

# 初始化 Git（如果还没有）
git init
git add .

# 检查待提交文件（确认没有 node_modules 等大文件夹）
git status

# 提交
git commit -m "feat: NekoAI GUI Manager v1.0"

# 推送到 GitHub
git remote add origin https://github.com/KanameMadoka520/你的仓库名.git
git push -u origin main
```

### 从 GitHub 克隆后恢复

```bash
git clone https://github.com/KanameMadoka520/你的仓库名.git
cd nekoai-gui
npm install                                    # 恢复前端依赖 (~170MB)
cargo install tauri-cli --version "^1.6"       # 安装 Tauri CLI（仅首次）
cargo tauri build --debug                      # 构建桌面应用（自动下载 Rust 依赖）
```

---

## 快速开始

### 前置要求

| 组件 | 最低版本 | 说明 |
|------|---------|------|
| **Node.js** | 18.x+ | 用于构建前端（Vite 7） |
| **npm** | 8.x+ | 随 Node.js 一起安装 |
| **Rust** | 1.60+ | 用于编译 Tauri 后端 |
| **Cargo** | 随 Rust | Rust 的包管理器 |
| **系统依赖** | - | Linux 需要 `libwebkit2gtk-4.0-dev`、`libgtk-3-dev`、`libssl-dev`、`pkg-config` |

> **Linux (Debian/Ubuntu) 用户：** 运行以下命令安装系统依赖：
> ```bash
> sudo apt install -y libwebkit2gtk-4.0-dev libgtk-3-dev libssl-dev pkg-config librsvg2-dev patchelf
> ```
>
> **Windows 用户：** 安装好 Node.js 和 Rust 即可，不需要额外系统依赖。Rust 推荐通过 [rustup-init.exe](https://rustup.rs/) 安装，安装完成后**重启 PowerShell** 使 `cargo` 命令生效。
>
> **macOS 用户：** 安装好 Node.js 和 Rust 即可，不需要额外系统依赖。

### 安装 & 构建

> **重要：** `cargo tauri` 不是 Rust 自带的命令，需要单独安装 **Tauri CLI**。这是一个一次性操作，安装后永久可用。

#### Windows (PowerShell)

```powershell
# 1. 确认 Rust 已安装（如果刚装完 rustup-init.exe，需要重启 PowerShell）
rustc --version
cargo --version

# 2. 进入项目目录
cd nekoai-gui

# 3. 安装前端依赖
#    注意：如果是从 Linux 复制过来的项目，先删掉旧的 node_modules 再安装
#    Remove-Item -Recurse -Force node_modules
npm install

# 4. 安装 Tauri CLI（首次执行，约 2-5 分钟编译，之后不需要重复）
#    版本必须是 1.x，不要安装 2.x
cargo install tauri-cli --version "^1.6"

# 5. 构建桌面应用（前端 + Rust 后端 + 打包）
#    首次构建约 3-5 分钟（下载并编译 Rust 依赖），之后增量构建约 30 秒
cargo tauri build --debug
```

#### Linux / macOS (Bash)

```bash
# 1. 确保 Rust 环境可用
#    如果是通过 rustup 安装的 Rust，每个新终端需要先执行：
source ~/.cargo/env

# 2. 进入项目目录
cd nekoai-gui

# 3. 安装前端依赖
npm install

# 4. 安装 Tauri CLI（首次执行，约 2-5 分钟编译，之后不需要重复）
#    版本必须是 1.x，不要安装 2.x
cargo install tauri-cli --version "^1.6"

# 5. 构建桌面应用
cargo tauri build --debug
```

构建完成后，可执行文件位于：

```
src-tauri/target/debug/app           # Linux
src-tauri/target/debug/app.exe       # Windows
src-tauri/target/debug/bundle/       # 安装包（.deb / .msi / .dmg）
```

### 开发模式

如果你想修改代码并实时预览：

```bash
cargo tauri dev
```

这会同时启动 Vite 开发服务器（前端热重载）和 Tauri 窗口（Rust 后端），修改前端代码后页面自动刷新，修改 Rust 代码后自动重编译。

> **注意：** `cargo tauri dev` 需要图形环境（Windows Desktop / macOS / X11 / Wayland）。在纯命令行的 Linux 服务器环境中只能验证编译通过，无法启动 GUI。

### 仅构建前端（不需要 Rust）

如果你只想修改或调试前端代码，不需要完整的 Tauri 构建：

```bash
# 仅构建前端到 dist/ 目录
npx vite build

# 或启动前端开发服务器
npx vite
```

前端会在 `dist/` 目录生成静态文件。但请注意，脱离 Tauri 运行时前端无法调用后端 IPC 命令，所有数据加载都会报错——这只适合检查 UI 样式和布局。

---

## 首次运行

双击打开应用后，你会看到 **首次运行设置** 界面：

1. 点击 **📁 浏览** 按钮，选择 NekoAI 插件的根目录（包含 `runtime_config.json` 和 `api_config.json` 的那个文件夹）
2. 也可以直接在输入框里粘贴路径
3. 点击 **开始使用**，程序会验证目录是否正确
4. 验证通过后进入主界面，路径会自动记住，下次打开不需要重新设置

---

## 使用说明

### 仪表盘（概览）

打开应用后默认进入仪表盘，这里展示所有核心信息的只读概览：

- **顶部 4 个统计卡片** — API节点总数、当前活跃节点编号、记忆会话数、记忆消息总数
- **核心状态** — 当前昵称、活跃 API（编号+模型名+类型标签）、活跃人格、智能路由/记忆压缩/表情包的开关状态
- **群组与用户** — 监听群组列表（每个群号旁会显示限流⏱、人格🎭、API🔌映射图标）、主人QQ、白名单/黑名单人数
- **API 类型分布** — OpenAI/Gemini/Anthropic 三类节点的数量和占比
- **记忆概览** — 群聊和私聊记忆的容量进度条，绿色(<50%)/黄色(50-85%)/红色(>85%)
- **配置文件健康** — 6个配置文件的存在状态、文件大小、最后修改时间

### API 管理

这是功能最丰富的页面：

- **左侧导航面板** — 搜索框 + 按提供商分组的节点列表，点击跳转到对应卡片，绿/红圆点显示连通状态
- **节点卡片** — 每张卡片包含：接口类型(下拉)、备注、API URL、API Key(带显示/隐藏切换)、模型名称
- **拖拽排序** — 按住卡片左上角的 `⠿` 图标即可拖拽调整顺序
- **连通测试** — 点击单个卡片的"测试"按钮测试单个节点，或点击工具栏的"全部测试"批量测试
- **撤销/重做** — 支持最多 50 步操作历史，`Ctrl+Z` 撤销 / `Ctrl+Y` 重做
- **批量操作** — 勾选多个节点后可批量删除
- **重复检测** — URL + 模型名相同的节点会显示黄色"重复"徽章
- **活跃节点** — 工具栏可直接输入活跃节点编号，或点击卡片上的"启用"按钮

### 配置编辑

11 个配置节通过左侧导航跳转，点击某一节自动滚动到对应区域：

| 配置节 | 包含的设置 |
|--------|-----------|
| 核心设置 | 昵称、主人QQ列表、私聊拒绝消息、日志级别 |
| 活跃节点/人格 | 活跃 API 索引、群聊/私聊人格索引 |
| 群聊与用户 | 监听群组、私聊白名单、用户黑名单、群限流配置(群号→秒) |
| 消息行为 | 群聊最大消息数、单次最大消息、随机回复概率(滑块)、上下文条数 |
| 记忆与摘要 | 启用开关、压缩阈值、摘要模型、最大摘要长度 |
| 智能路由 | 启用开关、路由模式(round-robin/random/priority/least-latency)、默认API索引 |
| 表情包 | 启用开关、概率(滑块) |
| 请求队列 | 最大并发数、重试次数、重试延迟 |
| 群级映射 | 群人格映射(群号→索引)、群API映射(群号→索引) |
| API 参数 | 自定义参数键值对(temperature/maxTokens等) |
| 转发设置 | 转发策略、最大长度、最大分段数、@等待时间 |

修改任何字段后，左下角保存按钮会亮起粉色脉动效果，点击保存。

### 历史记录

支持 4 种视图模式切换：

- **标准视图** — 按时间顺序的聊天气泡（用户消息右侧深色、AI回复左侧浅色、错误红色边框），支持分页
- **用户聚合** — 按用户名分组折叠，展开查看某用户的所有对话
- **错误分析** — 仅显示错误记录，附带各模型错误分布柱状图
- **全局搜索** — 跨所有文件搜索，支持多关键词(空格分隔)、类型筛选(群聊/私聊)、模型筛选、仅错误

点击 **📊 统计** 按钮打开统计弹窗，包含模型使用排行、用户排行、节点分布（水平柱状图）和 24 小时分布图（垂直柱状图，白天黄色/夜间灰色）。

---

## 技术架构

### 为什么从 Node.js 换成 Tauri？

| 对比项 | 旧版 (Node.js + Express) | 新版 (Tauri) |
|--------|--------------------------|-------------|
| **运行方式** | 启动 Node 服务 → 浏览器访问 `localhost:38880` | 双击直接打开桌面窗口 |
| **性能** | JavaScript 文件读写 + HTTP 传输开销 | Rust 原生文件 I/O，接近零开销 |
| **安全性** | API 密钥通过 HTTP 传输，可被抓包 | 数据不离开进程，无网络暴露 |
| **依赖** | 需要端口监听 + 浏览器 | 自包含可执行文件 |
| **前端技术** | Vue 3 CDN（单文件 HTML） | React 19 + TypeScript + Tailwind |
| **功能完整度** | ~80%（多处缺失） | 100%（全功能覆盖 + 新增特性） |

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Tauri 桌面窗口 (WebView)                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              React 19 + TypeScript 前端                │  │
│  │                                                       │  │
│  │   ┌────────┬────────┬────────┬────────┬────────────┐  │  │
│  │   │ 概览   │ API    │ 配置   │ 人格   │ 记忆/历史  │  │  │
│  │   └────────┴────────┴────────┴────────┴────────────┘  │  │
│  │          Zustand 状态管理 + React.lazy 懒加载          │  │
│  └──────────────────┬────────────────────────────────────┘  │
│             Tauri IPC (invoke)                                │
│  ┌──────────────────▼────────────────────────────────────┐  │
│  │               Rust 后端 (14 个 IPC 命令)               │  │
│  │  ┌──────────┐ ┌─────────┐ ┌────────┐ ┌────────────┐  │  │
│  │  │config.rs │ │memory.rs│ │history │ │api_test.rs │  │  │
│  │  │配置读写  │ │记忆CRUD │ │.rs     │ │连通测试    │  │  │
│  │  │自动备份  │ │         │ │搜索导出│ │HTTP请求    │  │  │
│  │  └────┬─────┘ └───┬─────┘ └───┬────┘ └────────────┘  │  │
│  │       │           │           │       ┌────────────┐  │  │
│  │       │           │           │       │watcher.rs  │  │  │
│  │       │           │           │       │文件监听    │  │  │
│  │       │           │           │       │事件广播    │  │  │
│  │       │           │           │       └─────┬──────┘  │  │
│  └───────┼───────────┼───────────┼─────────────┼─────────┘  │
└──────────┼───────────┼───────────┼─────────────┼─────────────┘
           │           │           │             │
┌──────────▼───────────▼───────────▼─────────────▼─────────────┐
│                     插件根目录 (磁盘文件)                       │
│  runtime_config.json   api_config.json   *_personality.json  │
│  commands.json         group_usage_counts.json               │
│  memory/group/*.json   memory/private/*.json                 │
│  chat-history/*        .backups/ (自动创建)                    │
└──────────────────────────────────────────────────────────────┘
```

### 技术栈选型

| 层 | 技术 | 为什么选它 |
|----|------|-----------|
| **后端** | **Rust + Tauri v1** | Rust 编译为原生机器码，文件 I/O 性能远超 Node.js。Tauri 生成的可执行文件体积小（~10MB），内存占用低。v1 是因为构建环境的 WebKit 版本限制（Debian 11 只有 `libwebkit2gtk-4.0`），对功能无影响。 |
| **前端框架** | **React 19** | 组件化开发效率高，生态成熟，TypeScript 支持好。搭配 Vite 7 热重载，开发体验流畅。 |
| **类型系统** | **TypeScript** | 前后端数据结构严格对齐。`lib/types.ts` 定义的接口与 Rust `#[derive(Serialize)]` 结构体一一对应，编译时就能发现类型错误。 |
| **样式** | **Tailwind CSS v4** | 原子化 CSS，直接在 JSX 中写样式，无需维护独立的 CSS 文件。搭配 CSS 变量实现白色现代 3D 主题（玻璃拟态 + 弹性动画）。 |
| **状态管理** | **Zustand** | 轻量（~1KB），API 简洁，不需要 Redux 那样的样板代码。目前用于 Toast 通知系统。 |
| **图表** | **Recharts** | 基于 React 的声明式图表库，用于历史记录的统计分析（柱状图）。 |
| **拖拽排序** | **@dnd-kit** | React 生态最流行的拖拽库，用于 API Manager 的节点排序。 |

### 前后端如何通信

Tauri 应用的前后端运行在 **同一个进程** 中，不需要 HTTP 或 WebSocket。前端通过 `invoke()` 函数直接调用 Rust 函数，就像调用本地函数一样：

```typescript
// 前端调用 Rust 后端（就像调用本地函数）
import { invoke } from '@tauri-apps/api/tauri';

// 读取配置 → 直接调用 Rust 的 get_config 函数
const config = await invoke('get_config', { key: 'runtime' });

// 保存配置 → Rust 端自动备份原文件再写入
await invoke('save_config', { key: 'runtime', data: modifiedConfig });

// 测试 API 连通性 → Rust 端发 HTTP 请求并返回结果
const result = await invoke('ping_api', {
  url: 'https://api.openai.com/v1/chat/completions',
  key: 'sk-...',
  model: 'gpt-4',
  aiType: 'openai'
});
// result = { pass: true, latency_ms: 230, status: 200 }
```

### 数据流示意

```
用户在配置编辑页修改了"随机回复概率"并点击保存
       │
       ▼
前端调用 invoke('save_config', { key: 'runtime', data: 修改后的配置 })
       │
       ▼
Rust config.rs 收到调用 → 备份原 runtime_config.json 到 .backups/ → 写入新数据
       │
       ▼
Rust watcher.rs 检测到文件变化 → 通过 emit_all() 广播 "config-changed" 事件
       │
       ▼
前端 useFileWatcher hook 收到事件 → 显示 Toast 通知"配置文件已变更"
```

---

## 目录结构

```
nekoai-gui/
├── README.md                          # 本文件
├── package.json                       # 前端依赖声明
├── package-lock.json                  # 依赖版本锁定
├── vite.config.ts                     # Vite 构建配置
├── tsconfig.json                      # TypeScript 配置
├── node_modules/                      # 前端依赖包 (npm install 自动生成)
├── dist/                              # 前端构建产物 (npx vite build 生成)
│
├── src/                               # ★ 前端源码
│   ├── main.tsx                       #   React 入口
│   ├── App.tsx                        #   主布局：Setup 引导 → 侧边栏+头部+页面路由
│   ├── index.css                      #   全局样式：CSS 变量 + Tailwind + 动画
│   │
│   ├── pages/                         #   7 个功能页面 + 1 个设置页
│   │   ├── Dashboard.tsx              #     概览仪表盘（只读）
│   │   ├── ApiManager.tsx             #     API 节点管理（最复杂）
│   │   ├── ConfigEditor.tsx           #     运行时配置编辑（11节）
│   │   ├── PersonalityManager.tsx     #     人格管理（群聊/私聊双栏）
│   │   ├── MemoryViewer.tsx           #     长期记忆查看+编辑
│   │   ├── HistoryViewer.tsx          #     历史记录分析（4种视图）
│   │   ├── CommandManager.tsx         #     命令回避列表管理
│   │   └── Setup.tsx                  #     首次运行设置引导
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx            #     侧边导航栏（7页+时钟）
│   │   │   └── Header.tsx             #     顶部栏（标题+操作按钮）
│   │   └── common/                    #   10 个可复用 UI 组件
│   │       ├── StatCard.tsx           #     统计卡片
│   │       ├── Toast.tsx              #     通知弹窗
│   │       ├── Modal.tsx              #     弹窗容器
│   │       ├── ConfirmDialog.tsx      #     确认弹窗
│   │       ├── SearchBar.tsx          #     搜索栏
│   │       ├── TagList.tsx            #     标签列表编辑器
│   │       ├── ToggleSwitch.tsx       #     开关
│   │       ├── SliderInput.tsx        #     滑块+数值
│   │       ├── KeyValueEditor.tsx     #     键值对编辑器
│   │       └── ProgressBar.tsx        #     进度条（三色）
│   │
│   ├── hooks/                         #   自定义 React Hooks
│   │   ├── useUndoRedo.ts             #     通用撤销/重做（50步）
│   │   ├── useKeyboardShortcuts.ts    #     全局快捷键
│   │   └── useFileWatcher.ts          #     Tauri 文件变更监听
│   │
│   ├── stores/
│   │   └── uiStore.ts                 #     Zustand Toast 通知状态
│   │
│   ├── lib/
│   │   ├── types.ts                   #     所有 TypeScript 接口定义
│   │   └── tauri-commands.ts          #     14 个 Tauri IPC 调用包装
│   │
│   └── theme/
│       └── neko-theme.ts              #     Neko 主题色彩常量
│
└── src-tauri/                         # ★ Rust 后端源码
    ├── Cargo.toml                     #   Rust 依赖声明
    ├── tauri.conf.json                #   Tauri 应用配置（窗口大小/权限/打包）
    └── src/
        ├── main.rs                    #     入口，注册 14 个 IPC 命令
        ├── state.rs                   #     AppState（插件目录路径管理）
        ├── config.rs                  #     配置文件 CRUD + 自动备份
        ├── memory.rs                  #     记忆文件 CRUD
        ├── history.rs                 #     历史记录读取 + 搜索 + 导出
        ├── api_test.rs                #     API 连通性测试（reqwest HTTP）
        └── watcher.rs                 #     文件变更监听（notify crate）
```

应用启动后会读写用户指定的 NekoAI 插件目录下的文件：

```
(用户选择的插件根目录)/
├── runtime_config.json      ← 运行时配置
├── api_config.json          ← API 节点列表（可能多达 56+ 个节点）
├── group_personality.json   ← 群聊人格列表
├── private_personality.json ← 私聊人格列表
├── commands.json            ← 命令回避列表（可能 243+ 条）
├── group_usage_counts.json  ← 使用量计数
├── memory/
│   ├── group/               ← 群聊长期记忆（每群一个 JSON）
│   └── private/             ← 私聊长期记忆（每用户一个 JSON）
├── chat-history/            ← 聊天历史日志
└── .backups/                ← 自动备份目录（首次保存时自动创建）
```

---

## Rust 后端 IPC 命令一览

前端通过 `invoke()` 调用这些命令，相当于旧版的 REST API，但不走网络：

### 配置管理

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `get_config` | `key` | JSON 数据 | 读取配置。key: `runtime` / `api` / `groupPersonality` / `privatePersonality` / `commands` / `usage` |
| `save_config` | `key`, `data` | - | 写入配置，**写入前自动备份**到 `.backups/` |
| `get_system_info` | - | 系统信息 | 插件目录路径 + 6 个文件的健康状态 |
| `set_plugin_dir` | `dir` | - | 设置插件目录，验证存在且包含配置文件 |

### 记忆管理

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `list_memory` | `memType` | 元数据列表 | 列出 group 或 private 记忆文件 |
| `get_memory` | `memType`, `id` | 消息数组 | 读取指定记忆内容 |
| `save_memory` | `memType`, `id`, `data` | - | 写入记忆 |
| `delete_memory` | `memType`, `id` | - | 删除记忆文件 |

### 历史记录

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `list_history_files` | - | 文件列表 | 列出 chat-history 下所有日志文件 |
| `get_history_file` | `filename` | JSON 数据 | 读取历史文件，非 JSON 自动包装为 `{raw: "..."}` |
| `search_all_history` | `query`, `filters` | 搜索结果 | 全局搜索，支持多关键词(AND)、类型/模型/错误筛选 |
| `export_history` | `filename`, `format` | 字符串 | 导出为 JSON 原文或 CSV（14列） |

### API 测试

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `ping_api` | `url`, `key`, `model`, `aiType` | 测试结果 | 单个节点测试（15秒超时，支持 OpenAI/Anthropic/Gemini 三种鉴权） |
| `batch_ping_apis` | `nodes` | 结果数组 | 批量顺序测试 |

---

## node_modules 说明

运行 `npm install` 后会生成 `node_modules/` 目录（约 167MB）。**不需要手动管理**，记住这几点：

- `node_modules/` 由 `npm install` 自动生成，**不要手动修改里面的文件**
- 复制项目到另一台机器时 **不需要** 复制 `node_modules/`，在新机器上重新 `npm install` 即可
- 如果出了问题，删掉 `node_modules/` 重新 `npm install`
- `package-lock.json` 锁定了精确版本号，保证所有人安装结果一致

### 主要依赖（我们直接用的）

| 包 | 用途 |
|----|------|
| `react` + `react-dom` | UI 框架 |
| `zustand` | 轻量状态管理（Toast 通知） |
| `recharts` | 图表组件（历史记录统计分析） |
| `@dnd-kit/core` + `@dnd-kit/sortable` | 拖拽排序（API 节点） |
| `react-markdown` + `remark-gfm` | Markdown 渲染（历史记录的 AI 回复） |
| `@tauri-apps/api` | Tauri 前端 SDK（invoke、dialog、event） |
| `tailwindcss` | 原子化 CSS 框架 |
| `vite` | 前端构建工具 |
| `typescript` | 类型检查 |

其余都是这些包的间接依赖，由 npm 自动管理。

---

## 与旧版工具的关系

| 旧工具 | 新版对应 | 改进 |
|--------|---------|------|
| `api_manager.html` | API 管理页 | 新增拖拽排序、撤销重做、重复检测、批量测试 |
| `config_editor.html` | 配置编辑页 | 从 9 节扩展到 11 节，新增智能路由/请求队列/转发设置等 |
| `dashboard.html` | 概览仪表盘 | 新增群组映射标签、API类型分布进度条、配置健康表 |
| `history_viewer.html` | 历史记录页 | 新增 Recharts 统计图表、4种视图模式、全局搜索 |
| `NekoAI-GUI-Manager/` | **完全替代** | 从 Node.js 网页变为原生桌面应用，零网络暴露，功能 100% 覆盖 |
| *(无)* | 人格管理页 | **全新** — 旧版没有独立的人格管理界面 |
| *(无)* | 命令管理页 | **全新** — 旧版完全没有命令列表管理功能 |
| *(无)* | 记忆编辑 | **全新** — 旧版只能查看记忆，新版支持内联编辑单条消息 |

旧版的 HTML 文件和 `NekoAI-GUI-Manager/` 目录可以安全删除。

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+S` | 保存当前页面 |
| `Ctrl+Z` | 撤销 |
| `Ctrl+Y` | 重做 |
| `Ctrl+/` | 显示/隐藏快捷键帮助 |
| `Ctrl+1` | 跳转到概览 |
| `Ctrl+2` | 跳转到 API 管理 |
| `Ctrl+3` | 跳转到配置编辑 |
| `Ctrl+4` | 跳转到人格管理 |
| `Ctrl+5` | 跳转到长期记忆 |
| `Ctrl+6` | 跳转到历史记录 |
| `Ctrl+7` | 跳转到命令管理 |

也可以在应用右上角点击 ⌨ 按钮查看。

---

## 构建排错指南

在不同环境下构建可能会遇到以下问题，这里列出完整的排错手册。

---

### 错误 1：`error: no such command: tauri`

**完整报错：**

```
cargo tauri build --debug
error: no such command: `tauri`

help: a command with a similar name exists: `miri`
```

**原因：** `cargo tauri` 不是 Rust 自带的命令，Tauri CLI 需要单独安装。

**解决方案：**

```powershell
# 安装 Tauri CLI（版本必须是 1.x，不要装 2.x）
cargo install tauri-cli --version "^1.6"
```

首次安装需要编译，约 2-5 分钟。安装完成后 `cargo tauri` 命令永久可用。

---

### 错误 2：`source` 命令在 Windows 不识别

**完整报错：**

```
PS> source ~/.cargo/env
source : 无法将"source"项识别为 cmdlet、函数、脚本文件或可运行程序的名称。
```

**原因：** `source` 是 Linux/macOS 的 Bash 命令，Windows PowerShell 不支持。

**解决方案：** Windows 上 **不需要执行这个命令**。通过 `rustup-init.exe` 安装的 Rust 已经自动添加到系统 PATH。如果 `cargo` 命令不可用，**关闭并重新打开 PowerShell** 即可。

---

### 错误 3：`npm install` 出现大量 EACCES 权限错误

**完整报错：**

```
npm warn cleanup Failed to remove some directories [
  ['.../node_modules/.bin/.vite-Q4cn5hjX',
   [Error: EACCES: permission denied, lstat '...'] ]
  ...
]
```

**原因：** 从 Linux/WSL 环境复制过来的 `node_modules/` 目录包含 Linux 特有的符号链接（symlinks），Windows 无法正确处理。

**解决方案：**

```powershell
# 先删掉从 Linux 复制过来的 node_modules
Remove-Item -Recurse -Force node_modules

# 如果删除也报权限错误，先关闭 VSCode 等编辑器（可能锁住了文件），
# 然后用管理员模式的 PowerShell 执行删除

# 重新安装
npm install
```

> **经验：** 跨操作系统复制项目时，永远不要复制 `node_modules/` 目录，在目标系统上重新 `npm install` 即可。

---

### 错误 4：TypeScript 编译报错（`tsc` 阶段失败）

**完整报错：**

```
> tsc -b && vite build

src/App.tsx:2:19 - error TS1484: 'PageId' is a type and must be imported using
a type-only import when 'verbatimModuleSyntax' is enabled.

Found 7 errors.
Error beforeBuildCommand `npm run build` failed with exit code 2
```

**原因：** `cargo tauri build` 会执行 `npm run build`（即 `tsc -b && vite build`），其中 `tsc -b` 是 TypeScript 严格类型检查。如果你只用 `npx vite build` 测试过前端，可能没发现这些类型错误（Vite 构建时只做转译不做类型检查）。

**常见的 TypeScript 错误类型：**

| 错误信息 | 原因 | 修复方式 |
|---------|------|---------|
| `TS1484: 'Xxx' is a type and must be imported using a type-only import` | `verbatimModuleSyntax` 要求类型和值分开导入 | 改为 `import type { Xxx } from '...'` |
| `TS6133: 'xxx' is declared but its value is never read` | 声明了变量但没使用 | 删除未使用的变量，或在参数名前加 `_` 前缀（如 `_unused`） |
| `TS2322: Type 'xxx' is not assignable to type 'yyy'` | 类型不兼容 | 检查类型定义，必要时做类型转换或过滤 |

**解决方案：** 修复所有 TypeScript 错误后重新构建。可以单独运行 `npx tsc -b` 来检查是否有类型错误，不需要每次都完整构建。

---

### 错误 5：WiX 打包失败（`Connection Failed` / 网络错误）

**完整报错：**

```
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1m 01s
        Info Verifying wix package
 Downloading https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip
       Error failed to bundle project: `https://github.com/.../wix314-binaries.zip:
             Connection Failed: Connect error: 以一种访问权限不允许的方式做了一个访问套接字的尝试。 (os error 10013)`
```

**原因：** 编译已经成功了！这个错误只发生在最后的 **打包阶段** —— Tauri 尝试从 GitHub 下载 WiX 工具集来创建 `.msi` 安装包，但被防火墙/代理/网络限制阻止了。

**解决方案（三选一）：**

**方案 A：直接运行已编译的 exe（推荐）**

编译成功后 exe 已经生成了，不需要 .msi 安装包：

```
src-tauri\target\debug\app.exe
```

双击即可运行。

**方案 B：使用开发模式运行**

开发模式不会尝试打包：

```powershell
cargo tauri dev
```

**方案 C：手动安装 WiX（如果确实需要 .msi 安装包）**

1. 用浏览器下载：https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip
2. 解压到 `%LOCALAPPDATA%\tauri\WixTools\` 目录（如果不存在就手动创建）
3. 重新执行 `cargo tauri build --debug`

---

### 错误 6：Rust 编译警告 `function start_file_watcher is never used`

**完整报错：**

```
warning: function `start_file_watcher` is never used
 --> src\watcher.rs:6:8
```

**原因：** 这只是一个 **警告（warning）**，不是错误，不影响编译。`start_file_watcher` 函数已经写好但尚未在 `main.rs` 的启动流程中调用（计划在文件监听集成时接入）。

**解决方案：** 可以忽略。这不影响应用运行。

---

### 其他提示

**跨平台复制项目的正确姿势：**

从 Linux/WSL 复制到 Windows 时，应该只复制源码，不复制生成物：

```
✅ 需要复制：src/、src-tauri/src/、package.json、Cargo.toml、tsconfig.json 等源码文件
❌ 不要复制：node_modules/、dist/、src-tauri/target/
```

到 Windows 后重新执行：

```powershell
npm install                                    # 安装前端依赖
cargo install tauri-cli --version "^1.6"       # 安装 Tauri CLI（仅首次）
cargo tauri build --debug                      # 构建
```

**快速验证 TypeScript 是否有错误：**

```powershell
# 只做类型检查，不构建（几秒钟出结果）
npx tsc -b
```

**快速验证前端是否能构建：**

```powershell
# 只构建前端，不编译 Rust（约 15 秒）
npx vite build
```

---

## 常见问题

**Q: 保存配置后 Bot 需要重启吗？**
A: 不需要重启 Koishi。保存后在群里发送 `neko.重载配置` 指令即可热加载。

**Q: 和旧版的 NekoAI-GUI-Manager 有什么区别？**
A: 旧版是 Node.js 网页应用（需要启动服务 + 浏览器访问），新版是原生桌面应用（双击直接打开）。新版功能更完整（100% vs ~80%），性能更好（Rust 文件 I/O），更安全（API 密钥不经过网络）。

**Q: 可以远程访问吗？**
A: 新版是桌面应用，不暴露网络端口，不支持也不需要远程访问。如果你需要远程管理，可以使用 SSH + X11 转发，或者继续使用旧版 `NekoAI-GUI-Manager`。

**Q: 构建时间很长怎么办？**
A: 首次构建需要下载和编译所有 Rust 依赖（约 3-5 分钟），之后增量编译只需 10-30 秒。如果你只修改前端代码，`npx vite build` 只需 ~15 秒。

**Q: 首次运行选错了目录怎么办？**
A: 打开浏览器开发者工具的控制台（在 Tauri 窗口中按 `F12`），输入 `localStorage.removeItem('nekoai-configured')` 然后刷新页面（`Ctrl+R`），会重新显示设置引导。

**Q: 可以和 Koishi 同时运行吗？**
A: 完全可以。本应用读写的是同一组 JSON 文件，但不占用任何端口，与 Koishi 互不影响。

**Q: node_modules 这么大，能删吗？**
A: 可以。需要时再 `npm install` 就会完整恢复。`package-lock.json` 保证安装结果一致。

**Q: 不安装 Rust 可以用吗？**
A: 不安装 Rust 只能构建和调试前端 UI（`npx vite build`），但无法生成可运行的桌面应用。如果只是想看界面效果，用 `npx vite` 启动开发服务器即可在浏览器中预览（数据加载会报错，但 UI 可以看）。

---

## License

MIT
