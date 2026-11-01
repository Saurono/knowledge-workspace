# 共享服务运行说明

要求 Node.js 24 LTS。原桌面 `npm run tauri dev` 路径保持独立。

```bash
npm ci
npm run build:service
# 通过部署环境设置 KW_SERVICE_TOKEN（至少 24 字符）；不要提交该值。
npm run start:service
```

默认监听 `127.0.0.1:4317`，数据目录 `.knowledge-workspace-service`。可通过 KW_SERVICE_HOST、KW_SERVICE_PORT、KW_SERVICE_DATA 配置。远程使用 HTTPS 反向代理和同源 Web；不要默认公开未完成账号授权的服务。密钥仅用于当前部署信任域，人员登录和 Agent Token 仍在后续 C05/C06。

`GET /api/v1/health` 返回版本与认证模式。其余路径需要 `Authorization: Bearer <服务连接密钥>`。客户端应使用 service-api 的 SDK，不直接读 SQLite 或上传目录。

| 路径 | 方法 | 行为 |
| --- | --- | --- |
| `/api/v1/projects` | GET / POST | 有游标的项目列表 / 创建项目 |
| `/api/v1/projects/:id` | GET | 项目元信息 |
| `/api/v1/projects/:id/wiki` | GET | Wiki 资源分页 |
| `/api/v1/projects/:id/wiki/page?path=wiki/…md` | GET / PUT / DELETE | 带版本的页面读写/删除 |
| `/api/v1/projects/:id/workspace` | GET / PUT | 记忆/领域工作区快照 |
| `/api/v1/projects/:id/documents` | GET | 已接收文档元数据分页 |
| `/api/v1/projects/:id/events?after=0` | GET | 持久化事件序号查询 |

写入返回 ETag 与资源 revision，更新/删除使用 `If-Match: "vN"`，仅创建使用 `If-None-Match: *`。缺少前提为 428，版本冲突为 409；失败不会确认写入，用户应保留草稿并重新读取合并。错误具有 code/message/requestId，内部异常不回传调用栈。

列表支持 limit（1–200）与不透明 cursor，游标不能跨项目/资源类型复用。事件携带单调序号，可从最后处理位置继续查询；资源和事件同事务提交。数据库只接受受支持 schema，备份时停止服务再复制完整数据目录；本阶段不提供热备份、分布式写入或自动双向同步。

验收入口：`npx vitest run server/http.test.ts`；这些测试实际启动临时本机 HTTP 服务并写临时 SQLite，包含关闭/重开验证。

## C03：Web、上传与事件

```bash
npm run build:shared
# 在同一终端的环境中设置 KW_SERVICE_TOKEN；启动后打开 http://127.0.0.1:4317
npm run start:service
```

默认从 dist-web 提供独立页面，KW_SERVICE_WEB_ROOT 可指定已构建静态目录。页面只在内存持有连接密钥，刷新后需重新连接；这不是人员登录页。连接后支持项目创建、Wiki 编辑/预览、记忆/领域维护和文档上传。Wiki 冲突保留草稿，服务不可达时不确认保存；刷新资源是显式放弃当前未保存内容。

`npm run dev:web` 在 1422 提供开发入口，`/api` 代理到本机 4317 服务。生产反向代理需同源转发并对 SSE 禁用缓冲；不要在 URL 查询串传访问密钥。

- `POST /api/v1/projects/:id/documents`：原始二进制请求体，`X-File-Name` 为 encodeURIComponent 后的文件名；默认最大 16 MiB。返回 sourceId/hash/receivedAt，状态为 received，sourceIngestedAt 为 null，不能当作解析/编译/索引完成。
- `GET /api/v1/projects/:id/documents/:id/content`：经过相同认证与项目定位的附件下载，不渲染上传的 HTML。
- `GET /api/v1/projects/:id/events/stream?after=N`：受认证 SSE，支持 Last-Event-ID；使用 fetch 流读取以携带 Authorization，不把凭据写入 URL。事件是持久序列，客户端按序号去重并在断线后重连。

本地端口使用现有文件/监听/Vault 服务，Shell 桥接复用 Rust Agent 工具；Web 没有本机桥接时这些能力不可用。完整 LLM/解析/向量/本机 CLI、多人账号授权、Vault 连接器与双向同步均不是这个 Web 基础入口已经交付的能力。

验收：`npx vitest run server src/modules/platform src/modules/service-api`；真实双客户端浏览器脚本为 analysis/implementation/smoke-shared-web.mjs，使用临时服务进程、临时数据和随机凭据，结束后清理，不连接用户 Vault 或运行本机 Shell。
