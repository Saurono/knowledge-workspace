# 证据：共享 CLI 工具链真实服务冒烟（2026-11-11 13:58）

**这是什么**：不是单测。用**构建产物** `dist-service/server.mjs` 起真实 HTTP 服务，走完整鉴权流程（初始化 → 登录 → 建项目 → 建 agent 账号 → 加成员 → 签 Agent Token），再用 **Agent Token** 调 `/api/v1/projects/<id>/cli`，验证 I02 的四个工具与审批门。

**环境**：本机，`KW_SERVICE_DATA` 指向临时目录（跑完删除），端口 4319，只监听 127.0.0.1。

**构建**：`node scripts/build-service.mjs` → `EXIT_CODE=0`。

**冒烟脚本**：`C:\Users\D1761\Documents\Codex\tools\smoke-i02-cli.mjs`（仓库外，避免把本地临时口令写进仓库；口令与 bootstrap key 都来自环境变量）。

**真实输出（尾部，`SMOKE_EXIT=0`）**：

```
ok auth/status -> 200
ok auth/bootstrap -> 201
ok auth/login -> 200
ok create project -> 201
ok seed memory a -> 200
ok seed memory b -> 200
ok seed memory c -> 200
ok admin/accounts -> 200
ok create agent account -> 201
ok add member -> 200
ok issue agent token -> 201
ok cli memory.summaries -> 200
ok cli memory.graph -> 200
ok cli proposal.submit -> 200
ok proposed memory invisible before approval
ok cli proposal.submit replay -> 200
ok cli proposal.submit fingerprint conflict -> 409
ok cli proposal.list -> 200
ok approve proposal -> 200
ok approved memory visible in summaries
SMOKE_OK project=ee43a42b-d0b6-43e1-a24a-6ae0bce402d8 proposal=6435d910-9cba-433f-884d-104304a6a21f
SMOKE_EXIT=0
```

**它证明了什么**：

- 构建产物能启动、鉴权链可用（bootstrap / login / agent token）。
- Agent Token 能调 `/cli` 的 `memory.summaries`、`memory.graph`、`proposal.submit`、`proposal.list`。
- **审批门有效**：提案提交后 `memory.summaries` 看不到；走 `POST /projects/:id/proposals/:id/approve` 批准后才出现。
- 幂等重放返回同一条提案；同 key 换证据返回 409。

**它没证明什么**：

- 没跑 `dist-service/cli.mjs` 与 `mcp-server` 共享入口这两个客户端（只验了它们调用的服务端路由）。
- 没有浏览器交互验收；没有真实模型调用。
- 冒烟用的是临时 SQLite 目录，不代表既有数据目录升级路径。

**复现**：

```powershell
$env:KW_SERVICE_PORT="4319"; $env:KW_BOOTSTRAP_KEY="<至少24字符>"; $env:KW_SERVICE_DATA="<临时目录>"
node dist-service/server.mjs
# 另一个终端
$env:KW_BOOTSTRAP_KEY="<同一个>"; node C:\Users\D1761\Documents\Codex\tools\smoke-i02-cli.mjs
```
