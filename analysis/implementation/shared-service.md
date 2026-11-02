# 共享服务、账号与客户端操作说明

状态：C01–C10 已实现。桌面独立模式和共享服务模式各自拥有数据，没有隐式同步或离线写队列。共享服务要求 Node.js 24 LTS；SQLite 是资源、身份与授权的持久化来源，上传原始文件另存于数据目录。

## 构建与启动

```bash
npm ci
npm --prefix mcp-server ci
npm run build:shared
npm run mcp:build
npm run start:service
```

首次启动前，通过运行环境注入 KW_BOOTSTRAP_KEY（至少 24 字符的随机初始化密钥）。打开 http://127.0.0.1:4317，设置首位 admin 的账号、显示名称和 12–256 字符密码，随后使用人员账号登录。初始化完成后可从运行环境移除初始化密钥，后续启动不再要求它；它从不授权数据访问。旧环境变量 KW_SERVICE_TOKEN 仅作为初始化密钥别名保留，不恢复旧服务密钥访问模式。

| 环境变量 | 默认/用途 |
| --- | --- |
| KW_BOOTSTRAP_KEY | 首次管理员初始化；已有密码后不再需要 |
| KW_SERVICE_HOST / KW_SERVICE_PORT | 127.0.0.1 / 4317 |
| KW_SERVICE_DATA | .knowledge-workspace-service，含数据库、WAL 和上传 |
| KW_SERVICE_WEB_ROOT | dist-web |
| KW_SECURE_COOKIE | HTTPS 部署设置为 1，使用 Secure Cookie |

Web 与 API 同源。远程部署用 HTTPS 反向代理并配置 Secure Cookie，跨域请求默认拒绝。Web 不读取本机路径、Shell、文件监听或 Obsidian Vault；无本机连接器时能力明确不可用。原桌面 npm run tauri dev 仍是本机独立模式，原 preview.html 是明确沙箱，不冒充共享账号服务。

开发：npm run dev:web 在 1422 代理 /api 到本机 4317。生产先构建再由 Node 服务提供静态页面，不使用预览模拟 FS。

## 人员、Agent 与角色

人员通过 HttpOnly / SameSite=Strict Cookie 登录，会话绝对期限 12 小时、空闲期限 30 分钟。退出立即吊销当前会话，改密吊销该账号全部人员会话，停用账号同时吊销其会话和 Agent Token。登录失败按地址及账号摘要持久限流，不记录口令明文。Agent 不支持口令登录。

登录后“身份与授权”提供账号、项目成员、工作角色、Agent Token、显式委托、审计和改密。只有真实 admin 管理全局账号；项目 manager 管理成员/角色。创建项目会在同一事务给创建者授予 manager，admin 不默认读取其他项目。

创建 Agent 后先把它加入项目，再签发 Token。必须指定单个项目、显式操作权限（含 project.read）、可选固定角色和不超过 90 天的到期时间，范围不超过发行者与 Agent 当前获授权限。Token 明文只显示一次，保存到凭据管理器或进程环境，不放进 URL、命令行参数、笔记、Git 或日志。后续列表只有公共前缀和范围，吊销即时生效。

顶部“有效身份与工作角色”只列出已获授角色和有效委托；同时显示真实操作者、有效身份及操作范围。切换产生独立上下文，旧任务不继承新权限。未保存 Wiki 切换前可取消，冲突/会话失败保留草稿供复制。项目/角色可见性和私有记忆仍由服务端校验，界面隐藏按钮不构成权限控制。

委托最多七天，授权人只能授予自己当前权限，接收者须为同项目成员。借用身份不产生全局 admin 权限，也不自动开放该身份的私有记忆。具体规则见 [服务端授权](../architecture/server-authorization.md)。

## v1 API

GET /api/v1/health 公开返回 API 版本、accounts 认证和平台能力。所有数据路径需要人员会话或 Bearer Agent Token；初始化密钥不会被接受为数据凭据。

成功响应为 {data,meta:{requestId,page?}}；错误为 {error:{code,message,requestId,details?}}。常用状态：400 参数、401 未认证/失效、403 越权、404 不存在、409 版本冲突、413 超限、428 缺版本条件、429 登录限流、501 未配置能力。错误不回传内部调用栈。

| 路径（均以 /api/v1 开头） | 方法与用途 |
| --- | --- |
| /auth/status、/auth/bootstrap、/auth/login | 引导状态、首次设置、人员登录 |
| /auth/me、/auth/logout、/auth/password | 当前人员/Agent、退出、改密 |
| /admin/accounts、/admin/accounts/:id/status | admin 账号管理，变更需目录 revision |
| /auth/tokens、/auth/tokens/:id | Token 创建/列表/吊销 |
| /projects | 授权项目列表、创建 |
| /projects/:id/wiki、/wiki/page?path=wiki/...md | Wiki 列表、读取、保存、删除 |
| /projects/:id/workspace、/memories | 过滤后的领域/记忆工作区 |
| /projects/:id/documents、/documents/:doc/content | 文档列表、二进制接收、附件下载 |
| /projects/:id/events、/events/stream | 持久事件查询、受认证 fetch SSE |
| /projects/:id/access、/access/options、/contexts | 当前授权、可切换选项、显式切换 |
| /projects/:id/members、/roles、/delegations | 项目成员、角色和显式委托 |
| /projects/:id/memories/:memory/grants | 真实所有者管理私有记忆授权 |
| /projects/:id/retrieval | 受 wiki.read 控制的关键词检索 |
| /projects/:id/cli、/mcp | 受保护资源工具调用 |
| /projects/:id/tasks | 受保护执行端口；无共享执行器时 501 |
| /projects/:id/audit、/auth/audit、/admin/audit | 本项目、本人账号、全局安全审计 |

Cookie 变更请求必须带 X-KW-CSRF: 1。首次设置另带 X-KW-Setup-Key；角色切换返回的 ID 通过 X-KW-Context 引用，但不能代替凭据。客户端 SDK 分别在 service-api 和 identity 模块，UI 不直接读数据库。

资源创建用 If-None-Match: *，修改/删除用 If-Match: "vN"。缺失返回 428，冲突返回 409；删除保留递增版本墓碑，重建后旧版本仍无效。资源与持久事件同事务。资源列表支持 limit（1–200）和绑定范围的不透明 cursor；审计另用 before、limit（1–100）、result 和获授权的 actor 过滤，返回 nextCursor。

上传 POST /documents 直接发送原始二进制，以 X-File-Name 提供 encodeURIComponent 文件名，默认上限 16 MiB。服务器生成独立目录 ID，received 元数据只表示已接收，sourceIngestedAt=null，不等于解析/知识入库/索引完成。上传后元数据写入会再次检查授权；失败清理对应二进制，目录重用不会覆盖旧文件。

SSE 用 fetch 携带凭据/上下文，按持久序号恢复，项目切换取消连接。轮询会重查授权并过滤无权读取的资源事件；退出或吊销后关闭流。

## 共享 CLI / MCP

先构建服务/CLI 与 MCP。通过进程环境设置 KW_API_URL、KW_AGENT_TOKEN；只允许 HTTPS 服务地址或本机 loopback HTTP，不在地址里传凭据。可选 KW_ACCESS_CONTEXT 固定已生成的上下文。

CLI 从 stdin 接收 JSON：

```bash
node dist-service/cli.mjs <项目ID> wiki.read
node dist-service/cli.mjs <项目ID> wiki.write
node dist-service/cli.mjs <项目ID> context.switch
```

支持 wiki.list/read/write、documents.list、memory.list、search 和 context.switch。Wiki 写入必须提供 expectedRevision，null 表示创建，冲突不会自动覆盖。上下文切换返回新 ID，后续使用 KW_ACCESS_CONTEXT 引用。资源工具不解释任意 Shell 命令。

共享 MCP 入口：node mcp-server/dist/src/shared.js。同样使用上述环境变量，可用 KW_PROJECT_ID 固定项目。提供七个资源/切换工具，调用时捕获上下文，角色切换不更改已发出的调用。原 dist/src/index.js 继续服务旧本机桌面 API，两个模式不回退或混用。完整文档来源注册/MCP 工具扩充仍在 I02，B07c 不能因此勾选。

## 数据升级与已知边界

当前服务数据库 schema 8，支持从 C02 的 schema 1 逐步迁移：身份目录、口令/会话/限流、Token、委托/上下文、私有授权、审计，以及 D02 的上传来源、内容修订与请求幂等登记。升级前停止服务并备份完整数据目录；旧资源/版本/墓碑/事件保留。未知高版本或损坏身份目录拒绝启动，不静默重置；回退旧程序需恢复备份，schema 7 及更早程序不能直接打开 schema 8。已有 C04 admin 元数据但无口令时，可给相同 handle 初始化密码并保留稳定身份。

D02 上传接收协议及验收边界见 [来源与幂等](d02-source-idempotency.md)。来源稳定 ID 与文档资源 ID 分离：同源不同字节修订保留独立文档资源及接收检查点。原始字节摘要不代表解析或知识编译完成；无 key 的旧客户端保持兼容，需要可重放的调用方应保留同一 `Idempotency-Key`。

审计在处理前写入 pending，响应结束后补记结果、真实/有效身份和授权引用；不保存密码、Token、正文、检索词或原始路径参数。进程崩溃可能留下 pending，审计不是资源写事务的一部分，也不宣称已完成防篡改归档/保留策略。普通成员仅查询自己的记录；项目管理权限可查本项目，全局 admin 不通过全局日志读取其他项目的记录。

SQLite 与上传不是跨介质事务，崩溃仍可能遗留孤立文件；强恢复、去重和入库阶段在 D/J。共享任务/本机执行器默认未配置，授权网关就绪但不冒充 H/I 的执行器/持久调度。记忆访问元数据不是用户尚待补充的记忆分类；完整记忆业务及最终星图仍在 F/G。本轮没有 cargo，Rust 桥接、真实 Vault/模型及桌面安装包尚未真机验收。

## 验证

```bash
npm run check:modules
npm run audit:modules:check
npm run typecheck
npm run test:mocks
npm run mcp:test
node analysis/implementation/smoke-shared-clients.mjs
# 安装 Playwright/Chromium 后，设置 PLAYWRIGHT_MODULE 与可选 CHROMIUM_PATH
node analysis/implementation/smoke-shared-web.mjs
```

两份 smoke 脚本使用临时目录和随机凭据，结束后清理。Web 脚本验证管理员设置/登录、跨会话 Wiki 冲突、真实上传/SSE、领域/记忆、账号/角色/成员、一次性 Token、切换草稿保护、显式借用身份、审计与退出；CLI/MCP 脚本实际启动 CLI 子进程和 MCP stdio 客户端。未使用 Tauri 模拟来充当服务端验收。

人员会话负责签发身份委托；Agent Token 可以使用已获授的角色/委托，但不能签发持久委托，以免短期凭据留下超期权限。Bearer Token 的凭据管理只允许查看/吊销自身，不能操作同一 Agent 的其他 Token（包括其他项目）。
