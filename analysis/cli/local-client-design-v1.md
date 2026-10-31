# 本地 CLI 客户端接入设计 v1

日期：2026-10-31（Asia/Shanghai）
状态：新增接入要求与适配设计，尚未完成全部双向链路。原生源码已有 Claude Code / Codex CLI 子进程传输与本地 MCP 接口；它们不等于新的跨 Agent 身份/记忆体系已经落地。

## 1. 两种接入方式都支持

| 方向 | 目标 | 承载 |
|---|---|---|
| 软件 → 本地 CLI | 在知识库内选择已安装的 CLI，让它执行对话或任务 | 本机 Runner / 各 CLI 适配器 |
| 外部 CLI → 知识库 | 在用户自己的终端使用 CLI Agent，读取或更新获授权的 Wiki/记忆 | MCP 优先；HTTP API 为通用接口 |

首批适配 Claude Code、Codex CLI，复用原生解析器和进程管理。其他 CLI 通过适配器扩展与能力声明接入，不宣称任意 CLI 均已兼容。

## 2. 身份、角色与会话

1. 每个 CLI Agent 注册独立 agent 身份，凭证绑定客户端与获准范围；不以所有进程共用的全局 Token 代表所有 Agent。
2. 用户选择获授权的 effectivePrincipalId、workRoleId 和 projectId，服务建立 contextId。可以沿用当前已登录会话提供的获准上下文，也可使用独立 Agent 凭证。
3. 一次 CLI 会话或任务固定一个上下文；切身份/角色时新建上下文与模型会话。并行终端互不覆盖角色或知识库绑定。
4. CLI 使用用户自己的模型供应商登录状态，并不自动取得知识库内该人员的全部权限。
5. Token 使用本机凭证存储、受控环境注入或 MCP 的客户端凭证能力传递，避免出现在命令行参数、Wiki 正文、回执或运行日志中。
6. CLI Agent 的正文贡献仍标 Agent，即使子进程使用人员的本机账户或某个获授权人员身份；实际操作者、CLI 客户端、有效身份和工作角色分别记录。

现有 MCP 的进程级项目固定可作为基础；新增角色/身份上下文时不能把它改成会话共享的可变全局身份。需要同时操作多个项目或角色时，使用独立会话上下文或独立 MCP 实例。

## 3. 软件调用 CLI 的 Runner

建议设置项：客户端类型、可执行文件路径、版本检测、工作目录、模型选项、能力列表、超时、并发与会话隔离规则。UI 只展示当前平台和适配器真实支持的能力。

采用参数数组和 stdin 调用，分别处理 stdout/stderr、退出码、取消与超时；不把用户输入拼接为任意 shell 命令。工作目录、工具权限和输出位置沿用任务范围授权与现有执行策略。

标准化事件：session_started、message_delta、tool_started、tool_result、artifact_created、verification_result、task_completed、task_failed、cancelled。原始 CLI 事件保留可追溯引用，但对展示和持久化做必要的数据规则处理。

进程正常退出只说明进程结束；判断“任务完成”“方案有效”“产出可用”仍需对应结果与验证证据。取消不记成成功，格式不兼容不静默丢失任务。

## 4. 外部 CLI 访问服务

MCP 适配建议提供：

- 身份与获准上下文：identity、authorized_contexts、create_context。
- Wiki：search/read、propose_write/revise、证据与版本读取。
- 记忆：search/read、propose/revise、冲突处理与 provenance。
- 任务：提交、查询、订阅、按执行器能力取消。
- 成果回流：提交问题/解决记录、产出清单、手册草稿与验证证据。
- 图谱：读取当前上下文授权的 Wiki/记忆场景。

名称为能力草案，实际工具命名与当前 llm_wiki_* 统一后实现。所有工具调用同一个后端服务，执行相同的身份委托、对象 ACL、版本和幂等规则；MCP 不直接修改 workspace.json 绕开授权。

现有源码有 12 个 llm_wiki_* 工具，可查询项目、文件、Review、搜索、聊天、图谱、重扫及写页等。新增记忆/身份能力要扩展服务和 MCP，不能仅通过 Skill 提示宣称具备。

## 5. 双前端与本机边界

- 桌面端通过本机 Runner 启动 CLI。
- Web 端通过用户连接并授权的本地 Companion/Runner 节点执行；浏览器不能直接启动本机任意程序。
- Web 管理端与 Runner 建立有期限的连接绑定，明确机器、项目、有效身份、工作角色和工作目录范围。推荐 Runner 主动连接服务，避免为每台机器开放未认证端口。
- 用户在终端运行的 CLI 也可直接连接共享记忆/Wiki 服务，不要求由桌面界面启动。
- CLI 登录、知识库登录和本机 Runner 连接是不同状态；连接失败分别定位，不能把某个模型已登录显示为“知识库已授权”。

## 6. 任务、Wiki 与记忆回流

复用既有统一任务模型与三类任务标签；clientType、runnerId、sessionId、contextId 作为任务元数据，不额外创建一个分散的 CLI 任务面板。分类依据任务目的：导入、研究或 Wiki/记忆维护，而非根据使用了哪个 CLI。

CLI 产生的问题、尝试、解决方案和验证事件，进入问题页回流链路；产出绑定版本和使用手册；经记忆政策允许的经验进入程序/反思记忆。来源徽标和实际贡献按既有 user/agent/system/mixed 规则判断，系统传输事件不自动变成正文创作者。

重复提交使用 idempotencyKey，Wiki/记忆修订要求 expectedVersion。CLI 断线可查询已登记任务；恢复连接后补传事件要按序列号去重，不把原任务再执行一遍。

## 7. 原生源码与缺口

| 原生基础 | 可复用 | 仍需补齐 |
|---|---|---|
| src/lib/claude-cli-transport.ts + Rust claude_cli.rs | 进程输入、stream-json 文本流 | 标准化工具/验证/产出事件与上下文身份 |
| src/lib/codex-cli-transport.ts + Rust codex_cli.rs | codex exec JSONL 与文本解析 | 完整事件投影、任务状态和回流 |
| src-tauri/src/commands/cli_resolver.rs | 可执行文件定位 | 统一配置与版本/能力探测 |
| mcp-server/ | 12 个现有工具、项目绑定、API client | 多 Agent Token、身份/角色上下文与记忆接口 |
| src/lib/llm-task-routing.ts | 模型/任务路由 | CLI Runner 与任务执行能力区分 |

当前两个 TypeScript 解析器主要提取回答文本，会忽略不少工具或执行事件。接入问题/方案回流时必须扩展事件链路，不能仅从最终回答中猜测是否执行和验证成功。

## 8. 验收

- 可检测本机已安装 CLI，未安装/版本不兼容有明确状态；不自动更改用户已有 CLI 登录配置。
- 两个 CLI Agent 使用独立身份，并行读写同一授权项目；角色与任务上下文互不串用。
- 未获授权的记忆、私有页面和身份组合被后端拒绝；切有效身份不改变来源中的真实 Agent 作者。
- stdout/stderr、工具事件、退出、取消、超时与断线可区分；不产生虚假的成功状态。
- 相同事件或提交重试不会重复写 Wiki/记忆；并发修订遵循版本冲突规则。
- CLI 产出及其问题/手册可在 Wiki、记忆和星图追溯到客户端、任务与版本。
- 桌面 Runner 和 Web Companion 使用同一任务/授权契约，真实本机程序只在被连接的机器执行。
