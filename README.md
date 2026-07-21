# NekoAI GUI Manager

**NekoAI 统一可视化管理面板** — 基于 Tauri 的原生桌面应用，集成聊天节点管理、图像节点管理、配置编辑、人格管理、长期记忆监控、聊天历史分析、用量管理与安全发布能力，并新增可开关的本地 Web 控制台，允许在浏览器中同步操作同一套 GUI。

> 当前推荐把它作为 `koishi-plugin-Enhanced-NekoAI` 的主管理器使用。插件目录内仍保留轻量 HTML 工具（`api_manager.html`、`image_api_manager.html`、`config_editor.html`、`dashboard.html`、`history_viewer.html`）作为补充；旧的独立 `NekoAI-GUI-Manager/`（Node.js + Express + Vue 3 CDN 方案）已经被本项目取代。

---

本工具是为了服务koishi中的插件koishi-plugin-Enhanced-NekoAI而诞生的。

当前功能已经覆盖日常管理链路，但涉及 **Responses / xAI Web Search / 图像节点 / xAI 图像接口** 的新增能力时，仍建议先在你的真实网络环境做一轮回归。

因为Enhanced-NekoAI插件配置比较复杂繁多，所以需要更人性化的图形工具来编辑其配置和查看状态。

---

## 快速导航（先看这里）

### 我现在该跑哪条命令？

- **只想本地开发调试（推荐）**：`npx tauri dev`
- **只检查前端是否能构建**：`npm run build`
- **要打包桌面应用（Windows/Linux）**：`npx tauri build`
- **想在浏览器里同步打开 Manager**：点击侧栏底部的 **本地服务** 按钮，进入独立的本地 Web 服务面板后开启，默认地址 `http://127.0.0.1:32191/`
- **Windows 从 Linux/WSL 拷贝过来后安装失败（EBADPLATFORM）**：先看 [构建与打包（Windows / Linux）【当前推荐】](#构建与打包windows--linux当前推荐) 的 Windows 小节
- **验证本轮修复（你现在正在做）**：优先跑 [本轮进展（2026-03）](#本轮进展2026-03) + [最小回归清单（提交前）](#最小回归清单提交前)

### 目录导航（TOC）

- [本轮进展（2026-03）](#本轮进展2026-03)
- [当前开发目标（下一阶段）](#当前开发目标下一阶段)
- [功能一览](#功能一览)
- [构建与打包（Windows / Linux）【当前推荐】](#构建与打包windows--linux当前推荐)
- [GitHub 上传指南 & 磁盘清理](#github-上传指南--磁盘清理)
- [快速开始](#快速开始)
- [首次运行](#首次运行)
- [使用说明](#使用说明)
- [技术架构](#技术架构)
- [目录结构](#目录结构)
- [Rust 后端 IPC 命令一览](#rust-后端-ipc-命令一览)
- [node_modules 说明](#node_modules-说明)
- [与旧版工具的关系](#与旧版工具的关系)
- [快捷键](#快捷键)
- [构建排错指南](#构建排错指南)
- [常见问题](#常见问题)
- [License](#license)

---

## 本轮进展（2026-03）

### 2026-04 增量更新

- GUI 新增 **本地 Web 控制台 / 浏览器同步管理模式**
  - 通过侧栏底部单独的 **本地服务** 按钮进入独立控制面板
  - 默认仅监听 `127.0.0.1:32191`
  - GUI 进程退出后服务同步关闭，不做后台常驻
  - 浏览器访问时与桌面端共用同一后端状态、插件目录、文件监听、自检结果与事件流
  - 浏览器模式下若桌面端已连接过插件目录，会自动继承；首次浏览器访问则支持手动输入插件目录
- 前后端桥接层已升级为 **桌面 Tauri IPC + 浏览器 HTTP/SSE 双通道兼容**
  - 前端不再只依赖 `invoke/listen`
  - 批量测活、人格评测、外部文件变更等事件会同时走本地事件总线，供桌面端和浏览器端共用
- 构建链路新增 **Rollup 原生依赖自动兜底**
  - `npm run build` / `npm run dev` 会先执行 `scripts/ensure-rollup-native.mjs`
  - 遇到 npm 漏装 `@rollup/rollup-win32-x64-msvc`、`@rollup/rollup-linux-x64-gnu` 等平台原生包时，会先尝试自动补装再继续构建
- API 管理已升级为 **聊天节点列表 / 图像节点列表双模式**
  - 聊天节点继续落在 `api_config.json`
  - 图像节点独立落在 `image_api_config.json`
  - 两套列表互不混用，避免生图配置污染聊天节点池
- 聊天节点新增 **OpenAI Responses / xAI Web Search** 管理能力
  - 接口类型下拉已明确区分 `openai (completions)` 与 `openai-response`
  - 保持“URL 由用户自己填写完整路径”的旧兼容策略
  - API URL 输入框右侧新增“补默认后缀”按钮，只做常见后缀辅助补全，不锁死自定义兼容站
  - 新增 `xAI Web Search` 开关，并明确标注“仅支持 xAI 官方 API + Grok 模型 + openai-response”
- 图像节点新增 **xAI / OpenAI 图像生成、参考图生图与修图** 独立管理能力
  - 独立维护 `generationUrl` / `editUrl` / `apiKey` / `modelName` / `aspectRatio` / `resolution` / `supportsEdit`
  - 支持导入 / 导出 `image_api_config.json`
  - 支持一键导出 xAI / OpenAI 图像节点模板，OpenAI 默认模型为 `gpt-image-2`，默认保留 `editUrl` 与 `supportsEdit`
  - 生成 / 修图 URL 右侧同样提供默认后缀补全按钮，并支持维护备用生成 / 修图 URL 列表；`gpt-image-2` 节点会提示可引用带图消息后使用 `neko.生图 提示词` 做参考图生图
  - OpenAI 图像节点可选开启流式请求，配置 `partial_images` 数量，并在中转站不支持 SSE 时回退普通请求
  - API 管理的图像模式新增“图像路由集群”页面，可直接复用现有图像节点并配置人工顺序，例如 `5 → 4 → 2`，插件会按路径依次尝试，任一节点成功即返回图片
  - 默认不提供图像批量测活，避免直接消耗图像额度
- Rust 后端与自检链路已同步支持图像节点
  - `config.rs` 新增 `imageApi -> image_api_config.json` 映射
  - `watcher.rs` / `ops.rs` 已纳入 `image_api_config.json`
  - 启动前自检与自动修复已覆盖 `activeImageApiIndex`
  - 配置文件健康检查已把 `image_api_config.json` 纳入检测范围

### 已完成

- 安全发布中心（Phase1+2 MVP）
  - 新增独立页面「安全发布中心」（侧栏第 8 页）
  - 配置快照中心：支持手动创建、保存后自动快照、列表查看、快照回滚、双快照差异对比
  - 部署包导出：一键导出 runtime/api/personality/commands + manifest（当前 MVP 为目录包格式）
  - 环境模板：支持 dev/test/prod 模板保存、预览、应用（应用后自动快照）
  - 启动前自检：检查缺失文件、JSON 解析、字段类型与活跃索引越界；支持可修项自动修复
  - 操作审计日志：记录关键操作并支持 UI 查看最近日志
  - OpsCenter 布局优化：新增顶部摘要、卡片级说明与可折叠工具区，统一安全治理页面的信息层级
- 数据持久化目录（新增）
  - 在 `nekoai gui manager.exe` 同级自动创建 `NekoAI-GUI-Data/`
  - 子目录：`snapshots/`、`deploy-packages/`、`env-templates/`、`diagnostics/`、`audit/`
  - 人格 A/B 测试记录：`personality-ab-tests/`

- API 管理
  - 批量测试支持流式回传（边测试边更新状态，不再整批等待后一次性刷新）
  - 测试按钮显示实时进度（done/total）
  - 测试请求格式按 OpenAI / Anthropic / Gemini 分别构造，并增强 Gemini key 兼容
  - 左侧导航点击跳转速度已加快
  - 新增 API 配置导入/导出（JSON，导入前覆盖确认）
  - 新增节点评分（MVP）：结合实时测试 + 历史表现计算健康分，并支持按健康分排序/筛选
  - P0 增强版：新增评分解释面板（分值构成 + 扣分原因）与 实时/历史 权重滑杆
  - P0 第二轮增强：节点评分新增超时率/抖动维度、解释条形进度展示，并支持 实时/历史/超时/抖动 多权重组合
  - ApiManager 第二轮性能优化：节点卡片改为 memo，降低高频交互下的重复渲染
  - ApiManager 信息架构优化：新增顶部摘要栏、主/次工具栏分层、API key栏按节点/全部展开收纳与更图形化的评分解释区
  - ApiManager 公共组件统一：已接入 `Panel` / `SummaryCard`，与 Dashboard/Ops/Memory/History 等页面保持一致层级
  - 新增安全提示：导出 API 配置或分享快照前，提示先移除 `api_config.json` 避免 Key 泄露
- 性能优化（前端）
  - 设置持久化写入改为延迟合并（减少高频 localStorage 同步写卡顿）
  - 文件监听 Toast 增加节流（2 秒）避免事件风暴导致 UI 抖动
  - 背景 AmbientFx 在交互密集页（如 API 管理）默认关闭，仅在 Dashboard/Ops 启用
- 外部修改监听
  - 配置文件外部变更：保留全局“刷新页面”提示
  - 记忆文件外部变更：不再触发全局刷新弹窗，改为记忆页内自刷新
- 长期记忆
  - 修复记忆页首次挂载“卡加载中”问题
  - 修复记忆详情读取与插件真实存储格式不一致问题（支持序列化字符串与对象两种格式）
  - 新增“当前会话”导入/导出（JSON，导入前覆盖确认）
  - MemoryViewer 布局优化：新增顶部摘要、会话列表说明与详情页工具收纳区，降低编辑视图拥挤感
- 历史记录
  - 纯图片/无文本请求不再显示为空，改为“图片消息/无文本”
  - 增加指标展示：输入长度、输出长度、上下文长度、响应时间
  - 时间线点击支持定位到对应记录
  - HistoryViewer 全面主题化：图表、提示框、模型标签、错误态颜色均跟随主题变量
  - 模型配色升级为“按主题映射”：同一模型在亮色/暗色/羊皮纸下使用不同但一致性更高的配色
  - 搜索交互增强：Tab 间距优化、支持 Enter 搜索、支持“仅筛选条件无关键词”搜索
  - 搜索高级筛选：模型多选、时间范围、错误类型多选、筛选方案保存/应用/删除
  - HistoryViewer 布局优化：搜索模式改为“主搜索条 + 可折叠高级筛选面板”，降低顶部筛选区拥挤感
  - 模型筛选后端改为严格匹配（不再以 contains 子串误命中相似模型）
  - 时间范围筛选兼容多种时间格式（RFC3339 与常见本地时间格式）
  - 搜索结果模式下统计卡按筛选结果重算（总调用/成功/异常/异常率/总字数）
  - 统计口径文案由 Token 调整为总字数（避免不可还原 token 误导）
  - 新增当前历史文件导入（JSON，导入前二级确认）
- 配置编辑 / 人格管理 / 命令管理
  - 三个页面均新增导入/导出（JSON，导入前覆盖确认）
  - 配置编辑新增“常用 / 完整”模式切换，优先展示高频配置并弱化表单墙感
  - 配置编辑已接入 `runtime_schema.json`：支持按 schema 展示章节标题/字段说明、导入时提示未知字段 / 废弃字段 / 旧枚举值 / 范围问题
  - 配置编辑新增“配置迁移提醒”与“配置差异概览”，可直接看到相对默认值、相对上次保存的改动，并支持一键修复可迁移的旧字段 / 旧值
  - 配置编辑的标准字段已逐步改为 schema 驱动渲染（标签列表 / 映射编辑器 / 滑杆 / 数字列表 / 内置 API 参数）
  - 人格管理布局优化：新增顶部状态摘要、导入导出收纳区，并强化人格卡片的摘要与操作层级
  - 人格管理按子文件粒度支持群聊人格与私聊人格分别导入/导出
  - 新增人格 A/B 测试台：支持在同一 API 节点下对比两个人格输出，并保存测试记录到 EXE 同级数据目录
  - 测试记录支持最近记录回看、模式筛选、关键词搜索与单条删除
- 用量管理
  - 新增独立页面「用量管理」：支持查看 / 编辑 `group_usage_counts.json`、重置当前周期、清理非监听群条目、导入/导出用量数据
- 可读性收尾
  - 已对 Setup / Dashboard / ApiManager / PersonalityManager / CommandManager / MemoryViewer / UsageManager / HistoryViewer / OpsCenter 进行一轮“人类可读性巡检”
  - 启动自检、OpsCenter 自检与配置迁移提醒统一为“技术标签 + 人话解释”的展示形式
- 概览仪表盘
  - Dashboard 布局优化：新增顶部摘要条、统一面板说明与概览区块层级
- Setup
  - 目录示例修正为插件目录（`Koishi\\plugins\\koishi-plugin-Enhanced-NekoAI`）
  - 新增“打开目录”按钮
- 外观系统（新增）
  - 三主题：亮色 / 暗色 / 羊皮纸，统一通过 CSS 变量驱动
  - 全局微圆角风格（6px/4px）替换旧大圆角
  - 新增背景漂浮层：伪代码字串 + 几何图形（全页面）
  - 漂浮层分区加权：主内容更密、侧栏次之、标题栏最稀
  - 显示设置新增“漂浮密度”三档（轻/中/重）
- 窗口框体（新增）
  - 使用主题化自定义标题栏（顶部随主题切换）
  - 恢复最小化/最大化/关闭按钮
  - 标题栏支持拖动窗口、双击最大化/还原
  - 修复 Tauri 命令注册缺失导致的 `export_history` 编译报错

### 进行中 / 待你回归确认

- API 批量测试“通过率是否与机器人真实调用一致”需要你在真实网络环境继续回归
- 节点评分（MVP）在你真实历史数据上的权重表现与排序体验需要你继续验证
- 长期记忆详情在你的真实数据集下是否完全正确（角色归类与内容编辑）需要你继续验证
- 人格 A/B 测试台在真实 API / 不同 provider 下的结果稳定性，以及记录回看 / 筛选 / 删除流程仍需继续回归
- 人格评测实验室（首版）已接入独立页面、批量执行、单条输出打分与基础统计摘要，并已通过本地 `npx tauri build` 构建验证；下一步需要继续做真实数据回归与交互补强

### 已知注意事项

- 文档里的“功能已完成”以 **你本地回归通过** 为最终标准。
- 若 Windows 打包时出现环境类问题（如 WiX 下载、MSVC、防火墙），请先按“构建排错指南”处理。

### 当前开发目标（下一阶段）

> 本节用于锁定“接下来明确要做什么”，避免任务发散。以本节为准推进；完成后同步更新 README / CONTRIBUTING / `ROADMAP.md`。

#### 总目标

在已完成的“安全发布中心（Phase1+2）”基础上，优先补齐 **API 治理**、**Prompt/人格工程**、**长期记忆治理** 三大能力，并保持所有安全保存数据统一落在 `nekoai gui manager.exe` 同级目录的 `NekoAI-GUI-Data/` 下。

#### 目标 A：API 治理类（优先级 P0）

1. **智能路由策略编辑器**（可视化）
   - ✅ 已完成 MVP：主模型、备用模型、降级策略、重试参数、策略预览（命中顺序/降级路径）
   - 与现有 `smartRouter` 配置保持兼容，避免破坏已有字段
2. **节点评分系统**
   - ✅ 已完成 MVP：结合批量测试结果 + 历史调用表现给出健康分（0-100）
   - ✅ 已完成 MVP：在 API 管理页可见，支持按健康分排序与按等级筛选
   - 后续可继续细化评分权重与“超时/抖动”维度

#### 目标 B：Prompt/人格工程类（优先级 P1）

1. **人格 A/B 测试台**
   - ✅ 已完成 MVP：支持同模式（群聊/私聊）人格 A/B 对比
   - ✅ 已完成 MVP：支持指定固定 API 节点
   - ✅ 已完成 MVP：支持保存、回看、筛选、搜索与删除测试记录
   - 下一阶段不建议继续在此页面直接叠加复杂打分统计；它更适合作为“快速试跑 / 草稿验证”工具
2. **人格评测实验室**
   - ✅ 已完成首版接入：新增独立页面入口（侧栏 / 快捷键 / 页面接入）
   - ✅ 已完成首版能力：多 API × 多人格 × 多用例 × 多轮次实验矩阵、单条输出人工打分、基础统计摘要
   - ✅ 已完成首版落盘：实验记录写入 `NekoAI-GUI-Data/personality-eval-lab/experiments/`
   - ✅ 已完成本地构建验证：`npm run build` 与用户本地 `npx tauri build`
   - 下一阶段继续补强：真实数据回归、交互细节优化、统计图表/导出增强
3. **人格冲突检测器**
   - 检测互相矛盾指令
   - 检测超长提示与重复规则
   - 输出问题清单与建议修正方向（不自动改原文）
4. **人格模板市场（本地）**
   - 本地模板库：一键套用 + 参数化替换
   - 模板版本化与导入导出

#### 目标 C：长期记忆治理类（优先级 P2）

1. **记忆压缩与归档助手**
   - 按规则摘要旧记忆，降低上下文噪音
   - 可配置触发阈值和归档范围
2. **记忆质量评分**
   - 识别冗余、重复、低信息密度条目
   - 输出可操作的清理建议
3. **记忆可视化关系图**
   - 按用户/主题/关键词展示记忆簇
   - 支持辅助清理与定位高噪音簇

#### 强约束（必须遵守）

- **数据落盘位置不变**：`NekoAI-GUI-Data/`（EXE 同级）
- **不破坏现有能力**：快照、部署包、环境模板、自检、审计必须保持可用
- **先最小可用版本，再扩展**：每个目标先做 MVP，避免一次性过度设计
- **文档同步**：每个子能力落地后，必须更新 README、CONTRIBUTING 与 `ROADMAP.md`

#### 验收口径（阶段性）

- API 治理：可配置、可执行、可观测（有评分、有排序、有筛选）
- 人格工程：可对比、可评估、可沉淀（有记录）
- 记忆治理：可压缩、可评分、可视化可辅助清理

---

## 功能一览

| 模块 | 功能 |
|------|------|
| **概览仪表盘** | 核心状态总览（昵称/活跃节点/人格/路由/表情包）、API类型分布、记忆容量进度条、群组用户信息（限流/人格/API映射标签）、配置文件健康检查表 |
| **API 管理** | **聊天节点 / 图像节点双模式**、聊天节点编辑（`openai (completions)` / `openai-response` / `Anthropic` / `Gemini`、xAI Web Search 开关、URL 默认后缀辅助、拖拽排序、批量测试、健康分、导入/导出）、图像节点编辑（独立 `image_api_config.json`、provider、生成/修图能力、主生成/修图 URL、备用生成/修图 URL 列表、默认比例/分辨率、xAI / OpenAI 模板导出、导入/导出、活跃图像节点切换）、图像路由集群（按人工节点顺序接力尝试，任一节点成功即返回结果） |
| **配置编辑** | 12个配置节全覆盖、侧边导航跟踪滚动、多种控件类型（开关/滑块/标签列表/键值编辑器/下拉框）、**schema 驱动字段说明与部分控件渲染**、恢复全部默认值（**二级确认**）、**runtime JSON 导入/导出（导入二级确认）**、**迁移提醒 + 差异概览 + 可修项自动修复**，并覆盖 `activeImageApiIndex` 等新字段 |
| **人格管理** | 群聊/私聊双栏并列、编辑弹窗（名称+大文本域+字符计数）、克隆/删除、一键切换活跃人格、搜索筛选、**群聊/私聊人格分文件导入/导出（导入二级确认）**、**人格 A/B 测试台（固定 API 节点、同输入双输出对比、测试记录回看 / 筛选 / 删除，用于快速试跑）** |
| **人格评测实验室（新增）** | **独立页面**、多 API × 多人格 × 多用例 × 多轮次实验矩阵、单条输出多维人工打分（风格一致性 / 稳定性 / 任务完成度 / 拟人感）、实验记录回看 / 删除、按人格 / API / 组合的基础统计摘要 |
| **长期记忆** | 群聊/私聊双列表、容量进度条（绿<50%/黄50-85%/红>85%）、**内联消息编辑**（点击直接改）、单条删除、搜索、清空、删除记忆文件、**当前会话导入/导出（导入二级确认）** |
| **历史记录** | **4种视图模式**（标准聊天气泡/用户聚合/错误分析/全局搜索）、**Recharts 统计图表**（模型排行/用户排行/节点分布/24小时热力图）、分页、JSON/CSV导出、**当前文件 JSON 导入（导入二级确认）**、搜索支持 Enter 与无关键词筛选、模型多选/时间范围/错误类型多选/筛选方案、搜索结果统计重算 |
| **用量管理（新增）** | 查看 / 编辑群聊 12 小时周期计数、按群显示限额和剩余额度、清理非监听群、重置当前周期、导入/导出 `group_usage_counts.json` |
| **命令管理** | 可搜索命令列表、添加单条/批量添加、选择/全选/批量删除、保存（含自动备份）、**JSON 导入/导出（导入二级确认）** |
| **安全发布中心（新增）** | 配置快照（自动/手动/回滚/差异对比）、部署包导出、dev/test/prod 环境模板（保存/预览/应用）、启动前自检（可修项自动修复）、审计日志查看、**分享快照/部署包前的 API Key 泄露风险提示** |

### 额外特性

- **首次运行引导** — 启动时自动检测，未配置则显示设置页面，选择插件目录后验证并记住
- **全局快捷键** — `Ctrl+S` 保存 / `Ctrl+Z` 撤销 / `Ctrl+Y` 重做 / `Ctrl+1~9` 切换页面 / `Ctrl+/` 快捷键帮助
- **文件变更监听** — Rust 后端实时监控配置和记忆文件，外部修改时自动 Toast 通知，并弹出“检测到外部修改”对话框提供“刷新页面”按钮
- **启动前自检（新增）** — 进入就绪态后自动执行一次基础健康检查，发现问题可在弹窗里一键修复可修项
- **Schema 契约（新增）** — GUI 会读取插件目录中的 `runtime_schema.json`，用于章节说明、字段约束、导入校验、迁移提醒与自检提示
- **GUI 本地偏好隔离（新增）** — API 健康评分权重已迁移到 `NekoAI-GUI-Data/preferences/`，不再写回插件 `runtime_config.json`
- **浏览器兼容桥接（新增）** — 同一套前端可在 Tauri 窗口和本地浏览器模式下运行；桌面端走 Tauri IPC，浏览器端走本地 HTTP/SSE
- **自动备份** — 每次保存前自动备份原文件到 `.backups/` 目录，文件名带时间戳
- **现代 3D 主题** — 白色光明风格、玻璃拟态、弹性动画、3D 阴影卡片、自定义滚动条
- **代码分割** — React.lazy() 按页面懒加载，首屏秒开
- **API 编辑增强** — 展开/收起单个与全部 API key栏、显示/隐藏全部 Key、对全部API可用性测试、拖拽排序后“已改动需保存”提示、重复节点标识、健康分（MVP）排序/筛选
- **人格管理增强** — 活跃/克隆/删除独立操作按钮（带边框视觉区分），删除后自动校正活跃人格索引
- **Dashboard 布局优化** — 新增顶部摘要条、统一面板说明与概览区块层级
- **Dashboard 布局优化** — 新增顶部摘要条、统一面板说明与概览区块层级
- **公共组件统一** — 已新增并接入 `Panel` / `SummaryCard`，用于主要页面的面板头与摘要卡统一
- **显示设置** — 支持 UI 缩放（80%~130%）、三主题切换（亮色/暗色/羊皮纸）、背景漂浮密度（轻/中/重）和“重新选择插件目录”
- **窗口标题栏** — 主题化自定义标题栏，支持拖动窗口、最小化/最大化/关闭
- **本地 Web 控制台（新增）** — 可在 GUI 内开启仅本机可访问的 `127.0.0.1` Web 控制台，用浏览器完整访问同一套 Manager；支持复制地址、直接打开与端口自定义

---

## 构建与打包（Windows / Linux）【当前推荐】

> 本项目 `package.json` **没有** `tauri:build` script。请直接使用 `npx tauri build`。

> `npm run build` / `npm run dev` 现在都会先执行 `scripts/ensure-rollup-native.mjs`，自动检查当前平台的 Rollup 原生包是否缺失；如果 npm 漏装了 Windows/Linux 平台包，会先尝试自动补装再继续构建。

### Windows（生成 .exe / .msi）

```powershell
# 1) 进入项目目录
cd "NekoAI GUI Manager"

# 2) 如果这个目录是从 Linux/WSL 拷贝过来的，先做一次干净重装
#    避免出现 @rollup/rollup-linux-x64-gnu 的 EBADPLATFORM
npm uninstall @rollup/rollup-linux-x64-gnu
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue

# 3) 安装依赖
npm install

# 4) 构建并打包（会先执行 npm run build，再执行 Tauri 打包）
#    若 npm 漏装了 @rollup/rollup-win32-x64-msvc，构建前会自动尝试补装
npx tauri build
```

构建成功后常见产物位置：

- `src-tauri\target\release\bundle\nsis\*.exe`
- `src-tauri\target\release\bundle\msi\*.msi`
- `src-tauri\target\release\`（裸 exe，名称以实际构建结果为准）

### Linux（Debian/Ubuntu）

```bash
# 1) 安装系统依赖（仅首次）
sudo apt update
sudo apt install -y libwebkit2gtk-4.0-dev libgtk-3-dev libssl-dev pkg-config librsvg2-dev patchelf

# 2) 进入项目目录
cd "NekoAI GUI Manager"

# 3) 安装前端依赖
npm install

# 4) 构建并打包
#    若 npm 漏装了 Linux 对应的 Rollup 原生包，构建前会自动尝试补装
npx tauri build
```

构建成功后常见产物位置：

- `src-tauri/target/release/bundle/deb/*.deb`
- `src-tauri/target/release/bundle/` 下的其它目标格式（按当前机器与 Tauri 配置）
- `src-tauri/target/release/`（裸可执行文件）

### 开发模式（跨平台）

```bash
npx tauri dev
```

### 仅验证前端构建

```bash
npm run build
```

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
npx tauri build                                # 构建桌面应用（会先执行 npm run build）
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
> **Windows 用户：** 除 Node.js 和 Rust 外，还需要安装 **Visual Studio Build Tools / Visual C++（MSVC）工具链**。如果构建时报 `link.exe not found`，说明这一项没装好。Rust 推荐通过 [rustup-init.exe](https://rustup.rs/) 安装，安装完成后请**重启 PowerShell** 使 `cargo` 命令生效。
>
> **macOS 用户：** 安装好 Node.js 和 Rust 即可，不需要额外系统依赖。

### 安装 & 构建

> **重要：** 本仓库已经在 `package.json` 中声明了 `@tauri-apps/cli`，因此优先直接使用 `npx tauri dev` / `npx tauri build`。只有你明确想走全局 `cargo tauri` 工作流时，才需要额外安装 Rust 版 Tauri CLI。

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

# 4. 构建桌面应用（前端 + Rust 后端 + 打包）
#    首次构建约 3-5 分钟（下载并编译 Rust 依赖），之后增量构建约 30 秒
npx tauri build
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

# 4. 构建桌面应用
npx tauri build
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
npx tauri dev
```

这会同时启动 Vite 开发服务器（前端热重载）和 Tauri 窗口（Rust 后端），修改前端代码后页面自动刷新，修改 Rust 代码后自动重编译。

> **注意：** `npx tauri dev` 需要图形环境（Windows Desktop / macOS / X11 / Wayland）。在纯命令行的 Linux 服务器环境中只能验证编译通过，无法启动 GUI。

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

### 首次运行路径示例（重要修正）

- 插件目录示例应为：`Koishi\\plugins\\koishi-plugin-Enhanced-NekoAI`
- 不是 `koishi/data/...`
- Setup 页面已新增“打开目录”按钮，可直接打开当前输入路径进行核对

## 首次运行

双击打开应用后，你会看到 **首次运行设置** 界面：

1. 点击 **📁 浏览** 按钮，选择 NekoAI 插件的根目录（包含 `runtime_config.json` 和 `api_config.json` 的那个文件夹）
2. 也可以直接在输入框里粘贴路径
3. 点击 **开始使用**，程序会验证目录是否正确
4. 验证通过后进入主界面，路径会自动记住，下次打开不需要重新设置

补充说明：

- 桌面模式下可直接点击 **📁 浏览** 选择目录
- 浏览器模式下不能直接调用本地文件夹选择器，所以 Setup 会提示你手动输入插件目录绝对路径
- 如果你是从桌面端先开启了本地 Web 控制台，再在浏览器中打开地址，浏览器模式通常会直接继承桌面端已经连接的插件目录

---

## 使用说明

### 仪表盘（概览）

打开应用后默认进入仪表盘，这里展示所有核心信息的只读概览：

- **顶部 4 个统计卡片** — API节点总数、当前活跃节点编号、记忆会话数、记忆消息总数
- **核心状态** — 当前昵称、活跃 API（编号+模型名+类型标签）、活跃人格、智能路由/记忆压缩/表情包的开关状态
- **群组与用户** — 监听群组列表（每个群号旁会显示限流⏱、人格🎭、API🔌映射图标）、主人QQ、白名单/黑名单人数
- **API 类型分布** — 当前按 OpenAI / Gemini / Anthropic 主类汇总展示节点数量和占比
- **记忆概览** — 群聊和私聊记忆的容量进度条，绿色(<50%)/黄色(50-85%)/红色(>85%)
- **配置文件健康** — 8 个配置文件（含 `runtime_schema.json`、`image_api_config.json`）的存在状态、文件大小、最后修改时间

### API 管理

这是功能最丰富的页面：

- **双模式切换** — 顶部可在“聊天节点列表”和“图像节点列表”之间切换，两种节点分别对应 `api_config.json` 与 `image_api_config.json`
- **聊天节点卡片** — 包含接口类型、备注、API URL、模型名称、API Key、xAI Web Search 开关、健康分解释等信息
- **接口类型** — 下拉明确区分 `openai (completions)`、`openai-response`、`Anthropic`、`Gemini`
- **URL 后缀辅助** — API URL 输入框右侧会根据当前类型显示 `补 /v1/chat/completions`、`补 /v1/responses`、`补 /v1/messages`、`补 /v1beta/models/...:generateContent` 等按钮；URL 最终仍然完全由你自己控制
- **xAI Web Search 开关** — 仅在 `openai-response` 节点可勾选，并明确提示“只支持 xAI 官方 API + Grok 模型”
- **拖拽排序 / 连通测试 / 健康分** — 聊天节点支持拖拽排序、单个/批量测试、健康分排序/筛选、评分解释面板
- **图像节点卡片** — 独立维护 `providerType`、`generationUrl`、`generationUrls`、`editUrl`、`editUrls`、`apiKey`、`modelName`、`aspectRatio`、`resolution`、`supportsEdit`，OpenAI 节点还可配置流式请求、`partial_images` 数量与失败回退
- **图像 URL 后缀辅助** — 生成 URL 可一键补 `/v1/images/generations`，修图 URL 可一键补 `/v1/images/edits`；备用 URL 支持每行一个地址，插件会在主 URL 失败或返回空图片时按顺序重试；OpenAI `gpt-image-2` 节点默认支持 `editUrl`，GUI 会提示其可直接引用带图消息进行参考图生图
- **图像路由集群** — 图像模式下新增独立页面，可启用 `imageRouter` 并维护 `order` 节点路径。配置 `5, 4, 2` 后，插件会按节点 5 -> 4 -> 2 接力尝试，只有全部失败才向聊天里回报失败。
- **图像模板导出** — 图像节点工具栏支持导出 xAI / OpenAI 模板，便于快速落地 `image_api_config.json`
- **图像节点保护策略** — 默认不提供图像测活，避免误耗图像额度；图像节点的活跃索引会保存到 `runtime_config.json` 的 `activeImageApiIndex`
- **撤销/重做 / 导入导出** — 聊天节点和图像节点都支持独立的撤销、重做、导入、导出与保存流程

### 本地 Web 服务

- 侧栏底部新增独立的 **本地服务** 按钮，不再和“显示设置”混在同一个弹窗里
- 默认关闭，默认端口为 `32191`
- 仅监听 `127.0.0.1`，不会主动开放到局域网
- 开启后可：
  - 用一个主按钮直接完成“开启并打开浏览器”
  - 服务运行中时，同一个按钮会变成“关闭服务”
  - 若你修改了端口，同一个按钮会变成“应用新端口并重启”
  - 复制浏览器访问地址
  - 直接用系统默认浏览器打开
  - 手动刷新服务真实状态
- 浏览器打开的是 **同一套 Manager 前端**，不是单独维护的一套简化页面
- 浏览器模式会同步看到：
  - 插件目录连接状态
  - 外部文件变更提醒
  - API 批量测活进度
  - 人格评测实验进度
  - 启动前自检与页面读写结果
- 关闭 GUI 进程后，本地 Web 控制台也会一起关闭

### 配置编辑

12 个配置节通过左侧导航跳转，点击某一节自动滚动到对应区域：

| 配置节 | 包含的设置 |
|--------|-----------|
| 核心设置 | 昵称、主人QQ列表、私聊拒绝消息、日志级别 |
| 活跃节点/人格 | 活跃聊天 API 索引、活跃图像 API 索引、群聊/私聊人格索引 |
| 群聊与用户 | 监听群组、私聊白名单、用户黑名单、群限流配置(群号→秒) |
| 消息行为 | 群聊最大消息数、单次最大消息、随机回复概率(滑块)、上下文条数 |
| 记忆与摘要 | 启用开关、压缩阈值、摘要模型、最大摘要长度 |
| 智能路由 | 启用开关、路由模式(failover/round-robin/random)、同节点重试次数/间隔、跨节点重试次数/间隔、排除节点 |
| 表情包 | 启用开关、概率(滑块) |
| 请求队列 | 最大并发数、最大排队数、队列已满提示文案 |
| 群级映射 | 群人格映射(群号→索引)、群API映射(群号→索引) |
| API 参数 | 自定义参数键值对(temperature/maxTokens等) |
| 转发设置 | 转发策略、最大长度、最大分段数、@等待时间、@专注回答模式 |

修改任何字段后，左下角保存按钮会亮起粉色脉动效果，点击保存。

- **导入/导出** — 支持 `runtime_config.json` 的 JSON 导入/导出；导入为二级确认（两次确认）后执行，导入后可继续编辑并保存。
- **恢复全部默认** — 改为二级确认（两次确认）后执行，降低误操作风险。
- **Schema 驱动开关** — 只要插件在 `runtime_schema.json` 中声明了布尔字段，例如 `groupMentionFocusMode`（群聊@专注回答模式），GUI 就会在对应章节自动显示开关控件；旧配置缺少该字段时，也会按 GUI 侧默认值回填显示。
- **队列配置可视化** — 在“请求队列”章节可直接编辑：
  - `requestQueue.maxConcurrent`：最大并发数
  - `requestQueue.maxPending`：最大排队数，`0` 为不限制
  - `requestQueue.overflowText`：队列已满时发送给用户的提示文案（支持占位符）

### 人格管理

- **双栏结构** — 群聊人格/私聊人格并行管理，支持搜索、编辑、克隆、删除、切换活跃人格。
- **活跃索引保护** — 删除或导入后会自动修正活跃人格索引，防止越界。
- **导入/导出（按子文件）**：
  - 群聊人格：`group_personality.json`
  - 私聊人格：`private_personality.json`
- 所有导入操作会先显示覆盖确认提示。

### 长期记忆

- **列表 + 详情编辑** — 支持按群聊/私聊查看记忆会话，详情内可编辑、删除、清空。
- **当前会话导入/导出** — 在详情弹窗中可导入/导出当前会话 JSON，导入前会弹覆盖确认。
- 导入后会进入待保存状态，点击保存后写回对应记忆文件。

### 历史记录

支持 4 种视图模式切换：

- **标准视图** — 按时间顺序的聊天气泡（用户消息右侧深色、AI回复左侧浅色、错误红色边框），支持分页
- **用户聚合** — 按用户名分组折叠，展开查看某用户的所有对话
- **错误分析** — 仅显示错误记录，附带各模型错误分布柱状图
- **全局搜索** — 跨所有文件搜索，支持多关键词(空格分隔)、类型筛选(群聊/私聊)、模型筛选（单选 + 多选）、时间范围、错误类型多选、仅错误；支持 Enter 回车触发搜索，且无关键词时也可按筛选条件搜索
- **筛选方案** — 可保存/应用/删除历史搜索筛选方案
- **搜索统计重算** — 在搜索视图下，顶部统计卡会按当前搜索结果重算（总调用/成功/异常/异常率/总字数）

点击 **📊 统计** 按钮打开统计弹窗，包含模型使用排行、用户排行、节点分布（水平柱状图）和 24 小时分布图（垂直柱状图，白天黄色/夜间灰色）。

- **导入/导出（按当前文件）**
  - 导出：支持 JSON / CSV，文件名为“原文件名 + 时间戳”
  - 导入：仅覆盖当前选中的历史 JSON 文件，导入为二级确认（两次确认）后执行

### 命令管理

- 支持命令搜索、单条添加、批量添加、选择/全选/批量删除。
- **导入/导出** — 支持 `commands.json` 的 JSON 导入/导出，导入为二级确认（两次确认）后执行。

---

## 技术架构

### 为什么从 Node.js 换成 Tauri？

| 对比项 | 旧版 (Node.js + Express) | 新版 (Tauri) |
|--------|--------------------------|-------------|
| **运行方式** | 启动 Node 服务 → 浏览器访问 `localhost:38880` | 默认双击直接打开桌面窗口；也可额外开启仅本机可访问的本地 Web 控制台 |
| **性能** | JavaScript 文件读写 + HTTP 传输开销 | Rust 原生文件 I/O，接近零开销 |
| **安全性** | API 密钥通过 HTTP 传输，可被抓包 | 默认无网络暴露；可选的 Web 控制台也只监听 `127.0.0.1` |
| **依赖** | 需要端口监听 + 浏览器 | 自包含可执行文件 |
| **前端技术** | Vue 3 CDN（单文件 HTML） | React 19 + TypeScript + Tailwind |
| **功能完整度** | ~80%（多处缺失） | 当前主线能力已覆盖聊天节点、图像节点、配置、人格、记忆、历史、用量与安全发布 |

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│            Tauri 桌面窗口 (WebView) / 可选本地浏览器模式         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              React 19 + TypeScript 前端                │  │
│  │                                                       │  │
│  │   ┌────────┬────────┬────────┬────────┬────────────┐  │  │
│  │   │ 概览   │ API    │ 配置   │ 人格   │ 记忆/历史  │  │  │
│  │   └────────┴────────┴────────┴────────┴────────────┘  │  │
│  │        另含 用量管理 / 评测实验室 / 安全发布中心       │  │
│  │   Tauri IPC / HTTP + SSE 运行时桥接 + React.lazy 懒加载 │  │
│  └──────────────────┬────────────────────────────────────┘  │
│    Tauri IPC (桌面) / localhost HTTP + SSE (浏览器可选)       │
│  ┌──────────────────▼────────────────────────────────────┐  │
│  │               Rust 后端 (40+ IPC 命令 + Web 控制台)     │  │
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
│  │       │           │           │       ┌────────────┐  │  │
│  │       │           │           │       │web_console │  │  │
│  │       │           │           │       │.rs         │  │  │
│  │       │           │           │       │本地HTTP/SSE│  │  │
│  │       │           │           │       └─────┬──────┘  │  │
│  └───────┼───────────┼───────────┼─────────────┼─────────┘  │
└──────────┼───────────┼───────────┼─────────────┼─────────────┘
           │           │           │             │
┌──────────▼───────────▼───────────▼─────────────▼─────────────┐
│                     插件根目录 (磁盘文件)                       │
│  runtime_config.json   runtime_schema.json                   │
│  api_config.json       image_api_config.json                 │
│  *_personality.json    commands.json                         │
│  group_usage_counts.json                                     │
│  memory/group/*.json   memory/private/*.json                 │
│  chat-history/*        .backups/ (自动创建)                  │
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

Tauri 桌面模式下，前后端运行在 **同一个进程** 中，不需要 HTTP 或 WebSocket。前端通过 `invoke()` 函数直接调用 Rust 函数，就像调用本地函数一样：

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

浏览器模式下则改走 GUI 自带的本地 Web 控制台：

- 命令调用：`POST /api/invoke/<command>`
- 事件推送：`GET /events`（SSE）
- 默认只监听 `127.0.0.1`
- 前端通过 `runtime-bridge.ts` 自动判断当前是在 Tauri 还是浏览器模式，不需要维护两套页面

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
├── scripts/
│   └── ensure-rollup-native.mjs       # 构建前自动补当前平台 Rollup 原生依赖
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
│   ├── pages/                         #   10 个功能页面 + 1 个设置页
│   │   ├── Dashboard.tsx              #     概览仪表盘（只读）
│   │   ├── ApiManager.tsx             #     聊天节点 / 图像节点双模式管理
│   │   ├── ConfigEditor.tsx           #     运行时配置编辑（12节）
│   │   ├── PersonalityManager.tsx     #     人格管理（群聊/私聊双栏）
│   │   ├── EvaluationLab.tsx          #     人格评测实验室
│   │   ├── MemoryViewer.tsx           #     长期记忆查看+编辑
│   │   ├── HistoryViewer.tsx          #     历史记录分析（4种视图）
│   │   ├── UsageManager.tsx           #     群聊用量 / 限流计数管理
│   │   ├── CommandManager.tsx         #     命令回避列表管理
│   │   ├── OpsCenter.tsx              #     安全发布中心（快照/模板/自检/审计）
│   │   └── Setup.tsx                  #     首次运行设置引导
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx            #     侧边导航栏
│   │   │   ├── Header.tsx             #     顶部栏（标题+操作按钮）
│   │   │   └── CustomTitlebar.tsx     #     主题化窗口标题栏
│   │   ├── common/                    #   公共 UI 组件（Panel / SummaryCard / Dialog 等）
│   │   └── personality/
│   │       └── PersonalityAbWorkbench.tsx #   人格 A/B 快速试跑工具（固定 API、记录回看/筛选/删除）
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
│   │   ├── types.ts                   #     所有 TypeScript 接口定义（含图像节点 / 人格评测类型）
│   │   ├── tauri-commands.ts          #     Tauri IPC 调用包装
│   │   ├── runtime-bridge.ts          #     Tauri IPC / 浏览器 HTTP+SSE 兼容桥接
│   │   ├── human-issues.ts            #     技术项 -> 人话解释映射
│   │   └── json-transfer.ts           #     统一 JSON 导入/导出
│   │
│   └── theme/
│       └── neko-theme.ts              #     Neko 主题色彩常量
│
└── src-tauri/                         # ★ Rust 后端源码
    ├── Cargo.toml                     #   Rust 依赖声明
    ├── tauri.conf.json                #   Tauri 应用配置（窗口大小/权限/打包）
    └── src/
        ├── main.rs                    #     入口，注册 IPC 命令
        ├── state.rs                   #     AppState（插件目录路径管理）
        ├── ui_events.rs               #     桌面事件 + SSE 统一事件总线
        ├── data_root.rs               #     EXE 同级数据根目录管理（NekoAI-GUI-Data）
        ├── gui_prefs.rs               #     GUI 本地偏好（如 API 健康评分权重）
        ├── ops.rs                     #     安全发布中心后端能力（快照/模板/自检/审计）
        ├── config.rs                  #     配置文件 CRUD + 自动备份 + 自动快照
        ├── memory.rs                  #     记忆文件 CRUD
        ├── history.rs                 #     历史记录读取 + 搜索 + 导出
        ├── api_test.rs                #     API 连通性测试（reqwest HTTP）
        ├── personality_ab.rs          #     人格 A/B 快速试跑后端（执行 / 记录 / 删除）
        ├── personality_eval.rs        #     人格评测实验室后端
        ├── web_console.rs             #     本地 Web 控制台（HTTP / SSE / 前端静态资源）
        └── watcher.rs                 #     文件变更监听（notify crate）
```

应用启动后会在 `nekoai gui manager.exe` 同级目录创建并使用：

```
NekoAI-GUI-Data/
├── snapshots/            # 配置快照（自动+手动）
├── deploy-packages/      # 部署包导出目录（MVP 为目录包）
├── env-templates/        # dev/test/prod 环境模板
├── diagnostics/          # 启动自检报告
├── audit/                # GUI 操作审计日志（jsonl）
├── preferences/          # GUI 本地偏好（如 API 健康评分权重）
├── personality-ab-tests/ # 人格 A/B 快速试跑记录
└── personality-eval-lab/ # 人格评测实验室数据目录
    └── experiments/      # 实验记录
```

应用启动后会读写用户指定的 NekoAI 插件目录下的文件：

```
(用户选择的插件根目录)/
├── runtime_config.json      ← 运行时配置
├── runtime_schema.json      ← 运行时配置契约
├── api_config.json          ← API 节点列表（可能多达 56+ 个节点）
├── image_api_config.json    ← 独立图像节点列表
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

前端通过 `invoke()` 调用这些命令，相当于旧版的 REST API，但不走网络；当你开启本地 Web 控制台并从浏览器访问时，这些命令会被映射到本地 `POST /api/invoke/<command>`。

### 配置管理

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `get_config` | `key` | JSON 数据 | 读取配置。key: `runtime` / `runtimeSchema` / `api` / `imageApi` / `groupPersonality` / `privatePersonality` / `commands` / `usage` |
| `save_config` | `key`, `data` | - | 写入配置，**写入前自动备份**到 `.backups/` |
| `get_system_info` | - | 系统信息 | 插件目录路径 + 8 个配置文件的健康状态 |
| `get_manager_context` | - | 运行上下文 | 读取当前后端已连接的插件目录，供浏览器模式自动继承 |
| `set_plugin_dir` | `dir` | - | 设置插件目录，验证存在且包含配置文件 |
| `get_api_health_weights` | - | 本地偏好 | 读取 GUI 本地保存的 API 健康评分权重（支持从旧 runtime 迁移） |
| `save_api_health_weights` | `weights` | - | 保存 GUI 本地健康评分权重，不写回插件运行配置 |
| `get_web_console_status` | - | 本地服务状态 | 读取本地 Web 控制台开关、端口、运行状态与访问地址 |
| `save_web_console_settings` | `settings` | 本地服务状态 | 保存并应用本地 Web 控制台设置（开关 / 端口） |

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
| `search_all_history` | `query`, `filters` | 搜索结果 | 全局搜索，支持多关键词(AND)、类型/模型/错误筛选（关键词为空时按筛选条件返回） |
| `export_history` | `filename`, `format` | 字符串 | 导出为 JSON 原文或 CSV（14列） |
| `import_history_file` | `filename`, `data` | - | 导入并覆盖当前历史 JSON 文件（仅单文件） |

### API 测试

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `ping_api` | `url`, `key`, `model`, `aiType` | 测试结果 | 单个聊天节点测试（15秒超时，支持 OpenAI / OpenAI Responses / Anthropic / Gemini 鉴权分支） |
| `batch_ping_apis` | `nodes` | 结果数组 | 批量顺序测试 |
| `batch_ping_apis_stream` | `session_id`, `nodes` | - | 批量流式测试，逐条回传进度事件 |
| `get_api_history_metrics` | - | 指标列表 | 聚合历史记录中的 API 维度指标（调用数/错误率/平均响应时间），供节点评分使用 |

### 人格 A/B 快速试跑

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `run_personality_ab_test` | `payload` | 测试记录 | 在固定 API 节点下执行同输入双人格对比，并保存结果 |
| `list_personality_ab_tests` | `limit?` | 记录摘要列表 | 读取最近的人格 A/B 快速试跑记录 |
| `get_personality_ab_test` | `id` | 完整记录 | 按记录 ID 加载单次测试详情 |
| `delete_personality_ab_test` | `id` | - | 删除指定测试记录 |

### 安全发布中心（Phase1+2）

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `list_snapshots` | - | 快照列表 | 列出所有快照元信息 |
| `create_snapshot` | `reason`, `operator` | 快照ID | 手动创建快照 |
| `rollback_snapshot` | `snapshot_id` | - | 按快照恢复配置文件 |
| `diff_snapshots` | `left_snapshot_id`, `right_snapshot_id` | 差异信息 | 双快照差异对比（按文件+顶层key） |
| `export_deploy_package` | `name?` | 包路径信息 | 导出部署包（当前为目录包） |
| `save_current_as_env_template` | `env` | - | 保存当前配置为 dev/test/prod 模板 |
| `preview_env_template` | `env` | 变更预览 | 预览模板应用会变更哪些文件 |
| `apply_env_template` | `env` | - | 应用模板并自动打快照 |
| `run_startup_self_check` | - | 自检报告 | 运行启动前自检并写报告 |
| `apply_self_check_fixes` | - | 修复项列表 | 自动修复可修项（索引归位） |
| `list_audit_logs` | `limit?` | 日志列表 | 读取审计日志供 UI 展示 |

---

## node_modules 说明

运行 `npm install` 后会生成 `node_modules/` 目录（约 167MB）。**不需要手动管理**，记住这几点：

- `node_modules/` 由 `npm install` 自动生成，**不要手动修改里面的文件**
- 复制项目到另一台机器时 **不需要** 复制 `node_modules/`，在新机器上重新 `npm install` 即可
- 如果出了问题，删掉 `node_modules/` 重新 `npm install`
- `package-lock.json` 锁定了精确版本号，保证所有人安装结果一致
- `npm run build` / `npm run dev` 会先运行 `scripts/ensure-rollup-native.mjs`，自动检查当前平台的 Rollup 原生依赖是否缺失

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
| `api_manager.html` | API 管理页（聊天节点模式） | 新增拖拽排序、撤销重做、重复检测、对全部 API 可用性测试、Responses / xAI Web Search 管理 |
| `image_api_manager.html` | API 管理页（图像节点模式） | 新增独立图像节点列表、xAI / OpenAI 模板导出、生成 / 修图 URL 默认后缀辅助 |
| `config_editor.html` | 配置编辑页 | 从旧版基础配置扩展到 12 节，并接入 `runtime_schema.json` 的说明、迁移提醒与差异概览 |
| `dashboard.html` | 概览仪表盘 | 新增群组映射标签、API类型分布进度条、配置健康表 |
| `history_viewer.html` | 历史记录页 | 新增 Recharts 统计图表、4种视图模式、全局搜索 |
| `NekoAI-GUI-Manager/` | **完全替代** | 从 Node.js 网页变为原生桌面应用；若需要浏览器界面，也可开启新的本地 Web 控制台，继续用浏览器访问同一套 GUI |
| *(无)* | 人格管理页 | **全新** — 旧版没有独立的人格管理界面 |
| *(无)* | 命令管理页 | **全新** — 旧版完全没有命令列表管理功能 |
| *(无)* | 记忆编辑 | **全新** — 旧版只能查看记忆，新版支持内联编辑单条消息 |

旧的独立 Node.js 版 `NekoAI-GUI-Manager/` 可以安全删除；插件目录内自带的轻量 HTML 工具则仍然保留，适合作为 Tauri GUI 之外的补充方案。

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
| `Ctrl+8` | 跳转到安全发布中心 |

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

**原因：** `npx tauri build` 会执行 `npm run build`（即 `tsc -b && vite build`），其中 `tsc -b` 是 TypeScript 严格类型检查。如果你只用 `npx vite build` 测试过前端，可能没发现这些类型错误（Vite 构建时只做转译不做类型检查）。

**常见的 TypeScript 错误类型：**

| 错误信息 | 原因 | 修复方式 |
|---------|------|---------|
| `TS1484: 'Xxx' is a type and must be imported using a type-only import` | `verbatimModuleSyntax` 要求类型和值分开导入 | 改为 `import type { Xxx } from '...'` |
| `TS6133: 'xxx' is declared but its value is never read` | 声明了变量但没使用 | 删除未使用的变量，或在参数名前加 `_` 前缀（如 `_unused`） |
| `TS2322: Type 'xxx' is not assignable to type 'yyy'` | 类型不兼容 | 检查类型定义，必要时做类型转换或过滤 |

**解决方案：** 修复所有 TypeScript 错误后重新构建。可以单独运行 `npx tsc -b` 来检查是否有类型错误，不需要每次都完整构建。

---

### 错误 4.5：`Cannot find module @rollup/rollup-win32-x64-msvc` / `@rollup/rollup-linux-x64-gnu`

**典型报错：**

```powershell
Error: Cannot find module @rollup/rollup-win32-x64-msvc
```

或：

```bash
Error: Cannot find module @rollup/rollup-linux-x64-gnu
```

**原因：** 这是 npm 的可选依赖漏装问题，不是项目源码本身坏了。Rollup 4 会按当前平台加载对应的原生包，偶发情况下 npm 虽然把包写进了 `package-lock.json`，但 `node_modules` 里没真正装上。

**当前仓库的处理方式：**

- `npm run build` / `npm run dev` 会先运行 `scripts/ensure-rollup-native.mjs`
- 脚本会识别当前平台并尝试自动补装缺失的 Rollup 原生包

**如果仍然失败，手动执行：**

Windows x64：

```powershell
npm install --no-save @rollup/rollup-win32-x64-msvc@4.59.0
npx tauri build
```

Linux x64 glibc：

```bash
npm install --no-save @rollup/rollup-linux-x64-gnu@4.59.0
npx tauri build
```

如果还不行，再做一次干净重装：

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
npm install
npx tauri build
```

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
npx tauri dev
```

**方案 C：手动安装 WiX（如果确实需要 .msi 安装包）**

1. 用浏览器下载：https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip
2. 解压到 `%LOCALAPPDATA%\tauri\WixTools\` 目录（如果不存在就手动创建）
3. 重新执行 `npx tauri build`

---

### 错误 6：`link.exe not found`

**完整报错：**

```
error: linker `link.exe` not found
note: the msvc targets depend on the msvc linker but `link.exe` was not found
```

**原因：** Windows 上缺少 **MSVC 链接器**。通常是没有安装 Visual Studio Build Tools，或者安装后没有重新打开终端，导致 `link.exe` 不在当前 PATH 中。

**解决方案：**

1. 安装 **Visual Studio Build Tools 2019/2022** 或完整 Visual Studio
2. 勾选 **使用 C++ 的桌面开发** / **MSVC v143/v142 工具集** / Windows SDK
3. 安装完成后重新打开 PowerShell 或 CMD
4. 重新执行 `npx tauri build`

如果你已经安装过 VS Build Tools，但普通终端仍然找不到 `link.exe`，可以先用 “x64 Native Tools Command Prompt for VS” 测一次，确认是否为环境变量问题。

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
npx tauri build                                # 构建
```

**快速验证 TypeScript 是否有错误：**

```powershell
# 只做类型检查，不构建（几秒钟出结果）
npx tsc -b
```

**快速验证前端是否能构建：**

```powershell
# 只构建前端，不编译 Rust（约 15 秒）
# 会先自动检查当前平台的 Rollup 原生依赖
npm run build
```

---

## 常见问题

**Q: 保存配置后 Bot 需要重启吗？**
A: 不需要重启 Koishi。保存后在群里发送 `neko.重载配置` 指令即可热加载。

**Q: 和旧版的 NekoAI-GUI-Manager 有什么区别？**
A: 旧版是 Node.js 网页应用（需要启动服务 + 浏览器访问），新版是原生桌面应用（双击直接打开）。新版已经覆盖当前主线运维能力，并额外支持聊天节点 / 图像节点双模式、Responses / xAI Web Search、独立图像节点配置、自检与安全发布等能力。

**Q: 可以远程访问吗？**
A: 默认不暴露任何网络端口。现在新增的本地 Web 控制台也只监听 `127.0.0.1`，设计目标是“本机浏览器同步管理”，不是对外远程管理。如果你要远程用，应该自行通过 SSH 隧道 / 远程桌面等方式做受控转发，而不是把它直接暴露到公网或局域网。

**Q: 本地 Web 控制台怎么开？**
A: 点击侧栏底部的 **本地服务** 按钮，进入独立的本地 Web 服务面板。默认地址是 `http://127.0.0.1:32191/`，可以直接点“开启并打开浏览器”，也可以先改端口再开启。

**Q: 为什么浏览器模式里没有“📁 浏览”按钮，或者点了不能选文件夹？**
A: 浏览器环境没有 Tauri 的本地文件夹选择能力，所以浏览器模式下 Setup 会要求你手动输入插件目录绝对路径。如果你是先从桌面端打开 GUI，再开启本地 Web 控制台，浏览器通常会直接继承桌面端已经连接的插件目录。

**Q: 自定义标题栏能显示，但无法拖动或按钮（最小化/最大化/关闭）没反应？**
A: 先检查两处：
1) `src-tauri/tauri.conf.json` 的 `tauri.allowlist.window` 是否开启 `minimize`、`maximize`、`unmaximize`、`close`、`startDragging`
2) 前端标题栏是否使用 `@tauri-apps/api/window` 调用这些方法，且拖动区域不要覆盖按钮点击区域

**Q: 为什么 `toggleMaximize` 在 tauri.conf 里报错“unexpected”？**
A: 因为本项目是 Tauri v1。v1 allowlist 不认 `toggleMaximize` 字段。做法是开启 `maximize + unmaximize`，并在前端通过 `isMaximized()` 判断后调用对应方法。
A: 打开浏览器开发者工具的控制台（在 Tauri 窗口中按 `F12`），输入 `localStorage.removeItem('nekoai-configured')` 然后刷新页面（`Ctrl+R`），会重新显示设置引导。

**Q: 可以和 Koishi 同时运行吗？**
A: 完全可以。本应用读写的是同一组 JSON 文件，但不占用任何端口，与 Koishi 互不影响。

**Q: node_modules 这么大，能删吗？**
A: 可以。需要时再 `npm install` 就会完整恢复。`package-lock.json` 保证安装结果一致。

**Q: `npx tauri build` 里还是报 Rollup 原生包缺失怎么办？**
A: 先看报错里缺的是哪个包，例如 Windows 常见是 `@rollup/rollup-win32-x64-msvc`。仓库已经带自动兜底脚本，但如果 npm 当场还是没补上，就手动执行：

```powershell
npm install --no-save @rollup/rollup-win32-x64-msvc@4.59.0
npx tauri build
```

**Q: 不安装 Rust 可以用吗？**
A: 不安装 Rust 只能构建和调试前端 UI（`npx vite build`），但无法生成可运行的桌面应用。如果只是想看界面效果，用 `npx vite` 启动开发服务器即可在浏览器中预览（数据加载会报错，但 UI 可以看）。

---

## License

MIT
