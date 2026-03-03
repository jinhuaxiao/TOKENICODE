# TOKENICODE 代码审计报告

> **日期**：2026-03-02
> **范围**：全量代码（Rust 后端 + 前端 stores/hooks/lib + UI 组件）
> **基线版本**：v0.8.0（重构后）
> **审计方式**：3 路并行 agent（Rust 后端、前端核心、UI 组件）+ 功能交互层链路追踪

---

## 概览

| 严重程度 | 数量 | 说明 |
|----------|------|------|
| **P0** | 7 | 安全漏洞、数据丢失风险、内存泄漏 |
| **P1** | 11+4 | 逻辑缺陷、竞态条件、性能风险 |
| **P2** | 8+5 | 代码质量、轻微 UX 问题、优化空间 |
| **合计** | 35 | 含 9 项功能交互层问题（FI 系列） |

---

## P0 — 严重（必须修复）

### P0-1. `delete_session` 路径穿越漏洞

- **文件**：`src-tauri/src/lib.rs:1476-1498`
- **问题**：`session_path` 参数直接传给 `std::fs::remove_file()`，无任何校验。攻击者（或恶意前端代码）可传入 `../../etc/passwd` 等路径删除任意文件。
- **修复**：对路径做 canonicalize，验证其必须在 `~/.claude/projects/` 目录内。

### P0-2. 僵尸进程泄漏 — `kill_session` 没有真正杀死进程

- **文件**：`src-tauri/src/lib.rs:1423-1431`
- **问题**：`kill_session` 仅从 `ProcessManager` Map 中移除条目，从未调用 `child.kill()`。CLI 子进程及其 stdout/stderr 读取线程会在后台持续运行，占用内存和 CPU。
- **修复**：在移除前调用 `proc.child.kill().await`，同时终止读取线程。

### P0-3. `--dangerously-skip-permissions` 默认启用

- **文件**：`src-tauri/src/lib.rs:889-899`
- **问题**：`permission_mode` 未被前端显式设置时默认为 `"bypassPermissions"`。所有未指定模式的会话都以完全无限制权限运行。
- **修复**：将默认值改为 `"default"`（映射到 `--permission-mode default --permission-prompt-tool stdio`）。

### P0-4. 自动放行所有未知权限请求类型

- **文件**：`src-tauri/src/lib.rs:1213-1239`
- **问题**：当 Claude CLI 发送未识别的 `control_request` 子类型时，后端自动允许，不经用户确认。未来 CLI 版本可能引入新的权限类型（如 `delete_files`、`run_shell`），会被静默批准。
- **修复**：将未知子类型转发到前端由用户决定。超时未响应则默认拒绝。

### P0-5. 流处理器事件监听器泄漏

- **文件**：`src/hooks/useStreamProcessor.ts:982-1040`
- **问题**：重试时（provider/model 切换失败），`onClaudeStream()` 和 `onClaudeStderr()` 注册新监听器存入 `window.__claudeUnlisteners[retryId]`，但旧监听器从不清理。每次重试/重连都会导致内存增长。
- **修复**：注册新监听器前先清理旧监听器。使用以 stdinId 为键的 Map 管理生命周期。

### P0-6. Tab 切换竞态条件 — 消息路由错误

- **文件**：`src/stores/chatStore.ts:403-437`、`src/hooks/useStreamProcessor.ts:414-424`
- **问题**：`stdinId → tabId` 映射在 `startSession()` 返回*之后*才注册，但流事件可能在注册完成前就到达。早期事件会被路由到错误的标签页或直接丢弃。
- **修复**：在启动会话*之前*注册 stdinId → tabId 映射，或在注册完成前缓冲事件。

### P0-7. Markdown 渲染 XSS 漏洞

- **文件**：`src/components/shared/MarkdownRenderer.tsx`（rehypeRaw）、`src/components/files/FilePreview.tsx:76-87`
- **问题**：`rehypeRaw` 启用了原始 HTML 渲染但未做消毒（sanitize）。虽然当前内容来自 Claude CLI（受信），但未来任何用户生成内容路径都可被利用。此外 `FilePreview.injectBaseTag()` 直接将文件路径拼接进 HTML，未做转义。
- **修复**：添加 `rehype-sanitize` 作为 rehype 插件。base 标签注入改用 DOM API 而非字符串拼接。

---

## P1 — 高优先级（本迭代修复）

### P1-1. Git 命令参数注入

- **文件**：`src-tauri/src/lib.rs:2931-2964`
- **问题**：Git 子命令白名单仅验证第一个参数，后续参数未检查。可执行 `git checkout HEAD -- /etc/passwd` 或通过 hook 执行任意代码。
- **修复**：验证所有参数。路径参数做 canonicalize 并限制在工作目录内。

### P1-2. stdin 写入竞态条件

- **文件**：`src-tauri/src/commands/claude_process.rs:44-57`
- **问题**：并发 `send()` 调用可能交错 `write_all(message)` + `write_all(newline)`，产生畸形 NDJSON。
- **修复**：原子化写入：`write_all(format!("{}\n", message))` 单次调用完成。

### P1-3. Windows cmd/PowerShell 引号处理不完整

- **文件**：`src-tauri/src/lib.rs:1878, 3369-3376`
- **问题**：`cmd /C start "" &path` 未转义 shell 元字符。PowerShell 脚本仅转义 `'`，未处理 `$` 和反引号。
- **修复**：对 cmd.exe 和 PowerShell 上下文做完整的 shell 转义。

### P1-4. 流消息处理器缺少错误边界

- **文件**：`src/hooks/useStreamProcessor.ts:337-1200`
- **问题**：`handleStreamMessage()` 没有 try-catch。单条畸形消息会崩溃整个流处理管线，导致会话冻结。
- **修复**：包裹 try-catch，记录错误日志，向用户发送系统消息，继续处理后续消息。

### P1-5. sessionCache 无限增长

- **文件**：`src/stores/chatStore.ts:161, 449-481`
- **问题**：`sessionCache` Map 存储所有打开过的标签页状态，但关闭标签时不清理。长时间运行会积累大量陈旧缓存。
- **修复**：关闭标签时清理缓存。添加 LRU 淘汰机制（如最多 50 条）。

### P1-6. Store 循环依赖 — settingsStore ↔ chatStore

- **文件**：`src/stores/settingsStore.ts:278-303`、`src/stores/chatStore.ts:286-289`
- **问题**：`settingsStore` 在订阅处理器中动态导入并调用 `chatStore`，形成脆弱的初始化顺序依赖，重构时可能断裂。
- **修复**：通过事件发射器或独立的 service 模块解耦。

### P1-7. useFileAttachments 闭包陈旧

- **文件**：`src/hooks/useFileAttachments.ts:187-252`
- **问题**：useEffect 依赖数组为空 `[]`，但函数体内访问可能变化的 store 状态（如 `workingDirectory`）。捕获的值会过期。
- **修复**：将动态依赖加入数组，或在调用时使用 `getState()` 获取最新值。

### P1-8. 会话列表未虚拟化

- **文件**：`src/components/conversations/ConversationList.tsx:194-200`
- **问题**：所有会话通过 `.map()` 直接渲染，无虚拟化。数百个会话时 DOM 膨胀、滚动卡顿。
- **修复**：集成 `react-window` 或 `@tanstack/react-virtual`。

### P1-9. 多个全局 keydown 监听器冲突

- **文件**：`src/components/chat/InputBar.tsx:213, 262, 317`
- **问题**：多个 `useEffect` 注册独立的全局 `keydown` 监听器。快速切换标签页可能累积重复监听器，导致快捷键多次触发。
- **修复**：合并为单一 keydown 分发器，或确保清理函数幂等。

### P1-10. ConversationList 轮询未在卸载时取消

- **文件**：`src/components/conversations/ConversationList.tsx:265-340`
- **问题**：30 秒轮询 `fetchSessions` 的 interval 在组件卸载时未清除，多个 interval 可能叠加。
- **修复**：useEffect 返回清理函数，清除 interval。

### P1-11. 拖拽时 body 样式污染

- **文件**：`src/components/chat/ChatPanel.tsx:50-68`
- **问题**：面板拖拽直接设置 `document.body.style.cursor` 和 `userSelect`。拖拽被中断时（如窗口失焦），样式可能未恢复，光标卡在 `col-resize`。
- **修复**：改用 CSS class 切换而非内联样式修改。确保所有退出路径都有清理逻辑。

---

## P2 — 中优先级（技术债）

### P2-1. `read_file_base64` OOM 风险

- **文件**：`src-tauri/src/lib.rs:1989-2027`
- **问题**：50MB 文件限制 + base64 编码 ≈ 67MB 内存/请求。并发请求可能 OOM。
- **建议**：将限制降至 10MB 或使用流式 base64 编码。

### P2-2. 网络检测阻塞启动

- **文件**：`src-tauri/src/lib.rs:3139-3154`
- **问题**：中国网络检测等待 Google HEAD 请求超时最长 3 秒。
- **建议**：用 `tokio::select!` 同时探测多个目标，取最快响应。

### P2-3. ChatPanel 滚动抖动

- **文件**：`src/components/chat/ChatPanel.tsx:387-420`
- **问题**：自动滚动在 useEffect 中直接设置 `scrollTop = scrollHeight`，无防抖。message 和 partialText 同时更新时会抖动。
- **建议**：使用 `requestAnimationFrame` 或 debounce 滚动更新。

### P2-4. CopyButton 定时器未清理

- **文件**：`src/components/shared/MarkdownRenderer.tsx:289-297`
- **问题**：「已复制」反馈的 2 秒 timeout 在快速点击或组件卸载时未清除。
- **建议**：用 `useRef` 追踪并清理 timeout。

### P2-5. FilePreview 直接 DOM 操作

- **文件**：`src/components/files/FilePreview.tsx:262-266`
- **问题**：图片加载错误处理器直接操作兄弟 DOM 元素（`placeholder.style.display`）。结构变化时容易崩溃。
- **建议**：改用 React state 控制显示逻辑。

### P2-6. Markdown 正则性能

- **文件**：`src/components/shared/MarkdownRenderer.tsx:138-162`
- **问题**：`wrapBareFilePaths` 正则 + 多层 split/replace 每次渲染都执行。大段 markdown 时可能卡顿。
- **建议**：添加内容长度检查或 memoize。

### P2-7. stdinId 碰撞风险

- **文件**：`src/hooks/useStreamProcessor.ts:981, 1006`
- **问题**：`desk_${Date.now()}_${Math.random().toString(36).slice(2,8)}` — 毫秒精度 + 弱随机。快速重试可能碰撞。
- **建议**：使用 `crypto.randomUUID()` 或更长的随机后缀。

### P2-8. 环境变量清理不彻底

- **文件**：`src-tauri/src/lib.rs:1004, 1052`
- **问题**：仅移除了 `CLAUDECODE` 环境变量。上一个会话设置的 `CLAUDE_CODE_*` 或 `CLAUDE_EDITOR` 可能泄漏到下一个会话。
- **建议**：设置新值前先清除所有 `CLAUDE_CODE_*` 前缀的变量。

---

## 功能交互层问题（FI 系列）

> 来源：用户实际使用反馈 + 数据流链路追踪审计。与上方代码质量审计互补——上方侧重安全/健壮性/性能，本节侧重功能正确性和用户体验。

### FI-1. [P1] `restoreFromCache()` 不同步运行状态指示器

- **文件**：`src/stores/chatStore.ts:421-437`
- **用户现象**：会话已完成，切走再切回，侧边栏仍显示绿色「运行中」脉冲点。
- **根因**：`setSessionStatus()` 和 `setStatusInCache()` 都会同步更新 `sessionStore.runningSessions`，但 `restoreFromCache()` 恢复 `sessionStatus` 时**不调用** `setSessionRunning()`，导致侧边栏指示器与实际状态脱节。

  ```
  方法                    同步 runningSessions?
  setSessionStatus()      ✓ (chatStore.ts:288)
  setStatusInCache()      ✓ (chatStore.ts:517)
  restoreFromCache()      ✗ ← bug
  ```

- **时序复现**：
  1. Tab A 运行中 → `runningSessions = {A}`
  2. 切到 Tab B → `saveToCache(A)` 保存 `status='running'`
  3. Exit 事件到达 → `setStatusInCache(A, 'idle')` → `runningSessions = {}` ✓
  4. 切回 Tab A → `restoreFromCache(A)` → chatStore 恢复 `idle`，但未调 `setSessionRunning(A, false)`
- **修复**：在 `restoreFromCache()` 末尾添加 `useSessionStore.getState().setSessionRunning(tabId, snapshot.sessionStatus === 'running')`。

### FI-2. [P1] 后台标签页功能链路断裂

- **文件**：`src/hooks/useStreamProcessor.ts:45-333`（`handleBackgroundStreamMessage`）
- **用户现象**：切到其他标签页后再切回，发现 AI 的工作进度没有完整同步。
- **根因**：`handleBackgroundStreamMessage` 只实现了消息累积和状态同步，以下关键功能在后台**完全不执行**：

  | 功能 | 前台 | 后台 | 影响 |
  |------|------|------|------|
  | Auto-compact（>160K tokens） | ✓ | ✗ | 后台会话可能因上下文溢出而失败 |
  | Auto-retry（thinking 签名错误） | ✓ | ✗ | 后台 thinking 错误导致会话卡死 |
  | Agent 子代理创建/更新 | ✓ | ✗ | 多 agent 任务在后台看不到子树 |
  | 待发消息刷新（pendingUserMessages） | ✓ | ✗ | 排队消息不会在后台自动发出 |

- **修复**：将 auto-compact 和 auto-retry 逻辑从前台处理器提取为独立函数，在后台处理器中同样调用。Agent 创建可延迟到 `restoreFromCache()` 时补建。

### FI-3. [P1] `system` 消息仅处理 `init` 子类型

- **文件**：`src/hooks/useStreamProcessor.ts:567-571`
- **问题**：`system` 类型消息的 switch 只处理 `subtype === 'init'`，其余子类型静默丢弃。Claude CLI 可能发送 `system` 消息告知上下文压缩结果、警告信息等，全部被忽略。
- **影响**：CLI 发出的系统级通知（如 compact 完成统计、token 用量警告）无法到达用户。
- **修复**：为未知 `system` 子类型创建 system 类型的 ChatMessage 并渲染。至少记录到控制台日志。

### FI-4. [P1] `/compact` CommandProcessingCard 完成检测不可靠

- **文件**：`src/hooks/useStreamProcessor.ts:587-598, 1050-1057`
- **问题**：代码注释明确指出 `/compact` 可能不发 `result` 事件（行 592）。完成检测依赖下一条 `assistant` 消息的到达（行 587-598 兜底逻辑），但如果 compact 是最后一个操作且无后续 assistant 消息，`CommandProcessingCard` 会**永远显示转圈**。
- **修复**：添加超时机制——如果 60 秒内 `pendingCommandMsgId` 仍未被清除，自动标记为完成。同时在 `process_exit` 处理中清理所有未完成的 command card。

### FI-5. [P2] Auto-compact 触发时无醒目通知

- **文件**：`src/hooks/useStreamProcessor.ts:1180-1204`
- **问题**：Auto-compact 只在消息流中插入一条 `CommandProcessingCard`，没有 toast、banner 或其他醒目提示。用户可能正在输入或查看别处，完全错过这个重要事件。
- **建议**：在 auto-compact 触发时额外显示一个 toast 通知（如「上下文接近上限，正在自动压缩...」），确保用户感知到。

### FI-6. [P2] `tool_use_summary` 消息静默丢弃

- **文件**：`src/hooks/useStreamProcessor.ts:893-894`
- **问题**：`tool_use_summary` 类型有空 case 但无任何处理逻辑。Claude CLI 发送的工具使用摘要信息被完全忽略。
- **建议**：评估该消息类型的实际内容，决定是否需要展示或至少记录日志。

### FI-7. [P2] hook_callback 控制请求自动放行无前端通知

- **文件**：`src-tauri/src/lib.rs:1213-1224`
- **问题**：`control_request` 中 `hook_callback` 子类型在 Rust 后端被自动允许后直接丢弃，前端完全不知道 hook 在执行。用户无法了解 pre/post-tool hooks 的运行情况。
- **建议**：将 hook 执行事件转发到前端（可作为低优先级日志显示），帮助用户理解 CLI 行为。

### FI-8. [P2] 浮动交互卡片缺少视觉提示

- **文件**：`src/components/chat/MessageBubble.tsx:32-42`
- **问题**：Question、Permission、PlanReview 三类卡片在未 resolve 时不在消息流中渲染（返回 `null`），改为 InputBar 上方的浮动 overlay。如果用户不注意输入框上方区域，会以为 AI 卡住了。
- **建议**：在消息流中保留一条占位消息（如「等待你的确认...」），或在会话标题/侧边栏添加需要操作的视觉指示。

### FI-9. [P2] EnterPlanMode/ExitPlanMode 在 Code 模式下完全不可见

- **文件**：`src/hooks/useStreamProcessor.ts:632-636`
- **问题**：Code 模式下 `EnterPlanMode` 和 `ExitPlanMode` 工具调用被完全跳过，不创建任何消息。虽然这是设计意图（由 CLI 原生处理），但用户无从知道 Claude 进入了计划模式。
- **建议**：至少在日志级别记录 plan mode 切换事件。如果 CLI 原生处理成功，可在消息流中显示简短系统提示。

---

## 本次审计同步更新的文档

- **ARCHITECTURE.md** — 全量重写。从 ~244 行扩展到 ~397 行。主要变更：10 个 store（新增 providerStore，移除 snapshotStore）、55+ Tauri 命令（原 ~45）、lib.rs 4600 LOC（原 ~2000）、新增 SDK 控制协议文档、Provider 系统、CLI 安装链路、二进制发现机制、跨平台说明。

- **CLAUDE.md** — 全量重写。更新架构概览、按类别整理的完整命令表、10 条关键设计决策、调试速查表、文件快速参考。

---

## 建议修复顺序

### 第一阶段 — 安全（立即）
1. P0-1 `delete_session` 路径穿越
2. P0-3 默认权限模式改为 `"default"`
3. P0-4 停止自动放行未知权限
4. P0-7 添加 rehype-sanitize
5. P1-1 Git 参数验证

### 第二阶段 — 稳定性 + 用户体验（本周）
6. P0-2 真正杀死子进程
7. P0-5 清理事件监听器
8. P0-6 修复 stdinId 注册时序
9. P1-2 原子化 stdin 写入
10. P1-4 流处理器添加错误边界
11. **FI-1 `restoreFromCache()` 同步运行状态**（改一行）
12. **FI-4 `/compact` 完成检测超时兜底**
13. **FI-3 `system` 消息子类型处理**

### 第三阶段 — 后台标签页强化（本周/下周）
14. **FI-2 后台标签页功能链路补全**（auto-compact、auto-retry、agent 创建）
15. P1-5 sessionCache 清理

### 第四阶段 — 质量 + UX 打磨（下个迭代）
16. P1-8 会话列表虚拟化
17. P1-9 至 P1-11（事件监听器、轮询、拖拽）
18. **FI-5 Auto-compact toast 通知**
19. **FI-8 浮动交互卡片视觉提示**
20. FI-6、FI-7、FI-9 及所有 P2 项
