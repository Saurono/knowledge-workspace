# I01：本机 CLI / Agent 适配契约

## 1. 两条独立调用链

桌面链 A：模型提供方 `claude-code` / `codex-cli` → app transport → application 端口 → Tauri invoke → Rust 子进程。入口分别见 `src/app/cli/claude.ts:6`、`src/app/cli/codex.ts:6`，设置页选择见 `src/components/settings/sections/llm-provider-section.tsx:629`。本链执行模型请求，不使用共享 Agent Token；Claude 依赖本机登录配置（`src-tauri/src/commands/claude_cli.rs:4`），版本探测不能证明 OAuth 有效（设置页同文件 `:1182`）。Codex 登录有效性未核实。

共享链 B：外部 Node CLI 或 stdio MCP → HTTP 服务 → 授权资源服务；不借用桌面子进程。`server/cli-main.ts:4`、`:8` 使用 KW_API_URL、KW_AGENT_TOKEN 发 Bearer 请求，KW_ACCESS_CONTEXT 在 `:17` 传入；项目取位置参数，不读取 KW_PROJECT_ID。MCP 则读取 KW_PROJECT_ID 固定项目和 KW_ACCESS_CONTEXT，见 `mcp-server/src/shared.ts:9-24`。两者只接受 HTTPS origin 或 loopback HTTP，拒绝重定向；身份由服务端 authenticate / contexts.resolve 决定（`server/http.ts:82-86`），请求参数不是身份凭证。

资源请求分别进入 `/api/v1/projects/<id>/cli` 和 `/mcp`，context.switch 单走 `/contexts`（`src/modules/cli/application/remote.ts:8-11`；`mcp-server/src/shared.ts:21`）。能力是授权资源读写及提案，不是任意 shell（`server/resource-tools.ts:9-33`）。

## 2. 能力探测

`CliCapability` 的 installed、version、path、error 类型见 `src/modules/cli/domain/model.ts:5`。installed 表示找到命令且 `--version` 成功退出，不表示完成登录或模型调用成功。成功时 version 为 trim 后 stdout（可能空串）、path 为解析路径、error 为 null；失败时 version=null，找到路径后执行失败仍保留 path，找不到时 path=null（`src-tauri/src/commands/claude_cli.rs:174-240`；`src-tauri/src/commands/codex_cli.rs:73-131`）。

error 是人可读原因：解析失败原因、非零退出 stderr / 退出状态、Failed to spawn 或版本探测超时；Claude 还识别 quarantine/damaged 给出 xattr 提示（Claude Rust `:214-221`）。因此 installed=false 不能一律叫“未安装”；桥接 reject 也不同于正常返回的未就绪结果。探测上限 10 秒（`src-tauri/src/commands/cli_resolver.rs:12`）。

`CliCapabilityPort.detect(provider)` 只委托端口，不补齐或校验字段（`src/modules/cli/application/capabilities.ts:2-3`）；native adapter invoke `${provider}_cli_detect`（`src/app/cli/native-ports.ts:14`）。两个 pill 挂载探测、允许按钮重试，reject 时转为 installed=false / path=null / version=null 并保留异常消息；优先直接显示 error，再用 cliUnavailable（设置页 `:1124-1151`、`:1198`、`:1219-1246`、`:1288`）。

## 3. 会话时序与终态

- 先同步捕获当前项目 CWD，再 await 注册数据与 done 两个监听，最后 spawn；没有项目直接失败（`src/modules/cli/application/claude.ts:94-165`；`codex.ts:92-197`）。
- 数据通道为 `<provider>-cli:<streamId>`，完成通道追加 `:done`；数据 payload 为字符串，done 至少含 code、stderr，Codex 还含 stdout、timedOut、timeoutMinutes（Claude application `:102-125`；Codex application `:97-122`；Rust `claude_cli.rs:419`、`codex_cli.rs:273-302`）。
- finishWith 只执行一次，注销监听并 resolve completion；finished/aborted 后迟到 token 被忽略。spawn 返回后仍 await completion（Claude application `:71-85`、`:103`、`:177`；Codex application `:60-65`、`:98`、`:204`）。
- Claude 非零退出使用结构化错误/诊断构造错误，零退出仍检查 structuredError 和 emittedToken；Codex 优先 timedOut，再非零退出，再回放 stdout 寻找 agent_message，无消息显式失败（Claude application `:126-149`；Codex application `:129-176`）。两者不能笼统声称都有同样的结构化错误优先级。
- abort 先 best-effort kill 并 onDone；若 abort 与 spawn 交错，spawn 返回后再次 kill，避免漏杀新建进程（Claude application `:79-91`、`:165-177`；Codex application `:197-204`）。监听注册和 spawn 自身不保证立即可中断（`src/modules/cli/README.md:7`）。
- Codex Rust 定时移除并 kill 子进程，以 timedOut 独立标记，前端即使已有部分输出仍报超时；范围 1–240 分钟（`src-tauri/src/commands/codex_cli.rs:202-212`、`:308`；Codex application `:129-149`）。Claude transport 未见同等会话超时机制；版本探测超时不能当会话超时。

## 4. 实际错误映射

| 情况 | 实际表现与来源 |
| --- | --- |
| 无项目 | Error：Claude Code CLI / Codex CLI requires an active project working directory；application/claude.ts:94-96、codex.ts:92-94 |
| 启动或监听异常 | catch 转 Error 交 onError；匹配 not found / No such file / executable file not found 时替换为 CLI not found 安装提示；否则保留消息。application/claude.ts:178-191、codex.ts:205-215 |
| 非零退出 | Claude 用 buildExitError；Codex 为 Codex CLI exited with code… 加诊断。domain/claude-protocol.ts:178-211、application/codex.ts:151-158 |
| 无有效输出 | Claude Code CLI completed but returned no content…；Codex CLI completed but did not emit an agent_message…；application/claude.ts:134-144、codex.ts:163-171 |
| 协议解析失败 | 非法 JSON 不直接抛协议异常，返回 null；最终可能成为无输出或退出诊断。domain/claude-protocol.ts:26、domain/codex-protocol.ts:5-10 |
| 会话超时 | Codex CLI did not report completion within… timeout…，附 stderr 优先、否则 stdout；application/codex.ts:129-145 |
| 环境 / PATH | detect 的 error 与 installed=false，或 spawn 异常映射；不另造环境错误码。Rust claude_cli.rs:174-240、codex_cli.rs:73-131 |

以上 application/domain 相对路径均以 `src/modules/cli/` 为根。Claude buildExitError 还按 stderr/诊断/静默退出分支生成说明，不保证每次都有结构化错误（domain/claude-protocol.ts:178-211）。

## 5. 新提供方的扩展要求

以下是适配约束，不代表已有通用插件注册机制：

- 实现 Rust detect、spawn 两个命令，并提供 kill 生命周期能力；连接命令注册与 `<provider>-cli:<streamId>` / `:done` 事件。当前映射模板见 `src/app/cli/native-ports.ts:5-14`，不能只加两个命令而漏掉取消。
- 实现 CliTransportPorts：process.spawn/kill、泛型 events.listen 返回注销函数、workingDirectory、createId、development；回调为 onToken/onDone/onError（`src/modules/cli/application/ports.ts:1-9`）。应用 transport 经此端口，禁止绕过端口直接连进程。
- 增加无平台依赖的协议解析、提示词构造与 domain 导出，保留转义边界；参考 `src/modules/cli/domain/claude-protocol.ts:1`、`codex-protocol.ts:1`、`prompt.ts:12-22`、`index.ts:1`。扩大当前 capability/provider 联合类型和 app adapter（capabilities.ts:2、native-ports.ts:5）。
- 保持 CWD 验证、显式 isolate_local_config、Windows CREATE_NO_WINDOW 和子进程 PATH；参考 Rust claude_cli.rs:166、:296-304、:431-472 与 codex_cli.rs:68、:151-161、:315-338。隔离开关不等于安全沙箱。
- 设置页增加对应 pill 与探测重试、失败文案；补齐 i18n key，沿用 detectingCli、cliDetected、cliUnavailable、cliAuthAfter 等模式（设置页 :1171-1198、:1266-1288）。本卡不改 key。
- 禁止把凭据写入日志；这是一项扩展约束，不声称现有代码已全面脱敏审计。共享链禁止把调用参数变成身份，必须仍经过 authenticate / resolve 与权限检查（server/http.ts:82-86、:212-214）。

## 6. 共享工具矩阵

白名单见 `src/modules/cli/application/remote.ts:2-11` 与 `mcp-server/src/shared-tools.ts:1-13`；context.switch 是单独分支，不是 resourceTool 内的资源动作。

| 操作 | 读写性质 | 权限 / 实现依据 |
| --- | --- | --- |
| wiki.list | 读 | wiki.read；server/resource-tools.ts:11，src/modules/service-api/application/authorized-repository.ts:110 |
| wiki.read | 读 | wiki.read；resource-tools.ts:12，authorized-repository.ts:107 |
| wiki.write | 写 | wiki.write；resource-tools.ts:13-18；expectedRevision=null 创建，否则正整数版本，拒绝额外字段 |
| documents.list | 读 | documents.read；resource-tools.ts:20，authorized-repository.ts:110 |
| memory.list | 读 | memory.read；server/http.ts:199，resource-tools.ts:21 |
| memory.summaries | 读 | memory.read；resource-tools.ts:22 |
| memory.graph | 读 | memory.read；resource-tools.ts:23 |
| proposal.submit | 写提案 | wiki.write；resource-tools.ts:24-27；不是直接批准或执行 |
| proposal.list | 读 | wiki.read；resource-tools.ts:29-31 |
| search | 读 | wiki.read；server/http.ts:198，resource-tools.ts:38-56；keyword 模式，vectorHits=0 |
| context.switch | 写访问上下文 | server/auth-http.ts:81-84 调用 contexts.switch；自身身份重新捕获角色权限；切换他人需 actor 的 project.read 及未撤销、未过期、项目/双方/角色匹配的 delegation，权限取交集；src/modules/identity/application/delegation.ts:13-24、:50-52 |

表内 resource-tools.ts 指 `server/resource-tools.ts`，authorized-repository.ts 指上表完整路径。资源层授权继续受上下文/可见性过滤约束，不能仅凭工具在白名单就认为获准（server/http.ts:85-86）。

## 7. 诚实清单

- 未实际启动用户本机 claude/codex，未验证真实登录、模型输出与平台进程行为（`src/modules/cli/README.md:9`）。
- 未运行 Rust 原生测试；本次 TypeScript 检查不能替代它（同上）。
- 生产未配置 options.executions 时 tasks/cli 执行返回 unsupported：A shared execution backend is not configured；资源工具分支先返回，不因此失效（`server/http.ts:196-215`）。本卡不声称生产配置已实测。
- 共享 MCP 有工具列表和 CallTool HTTP 转发实现，但未端到端运行 MCP 客户端；不能把 ListTools 实现当客户端验收（`mcp-server/src/shared.ts:15-28`）。

## 8. 任务对应

I01 本卡补契约，不勾任务；I02 当前按“只读资源 + 提案写已交付，任务读写未接”记录交付范围，同时代码确实存在 wiki.write，不能描述成全链严格只读（resource-tools.ts:13-18）。tasks 仍依赖执行后端（server/http.ts:204-215）。I03/I04 未做；任务定义见 `TASKS.md:125-128`，本卡不修改任务状态、不扩做关联回流或故障验证。
