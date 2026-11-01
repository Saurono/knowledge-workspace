# 新会话交接

> 当前状态：用户要求 C 系列全部完成，本轮 C05–C10 已逐项完成，C01–C10 全部勾选。当前无进行中的 C 项；下一阶段从 D01 开始，尚未启动。不要按旧“停在 C04”状态恢复。

## 工作约定

1. 先读本文件、TASKS、WORKLOG、ARCHITECTURE，检查真实 Git 状态/日志，不假设旧端口或进程仍在。
2. 每项完成需勾选 TASKS、追加 WORKLOG（实现/验证/限制）、更新交接、提交并推送，不能只勾选。
3. 用户本轮授权仅为完成整个 C 系列；已完成后结束，不自动扩展到 D/F/H/I。新指令继续时从 D01 的入库阶段/可恢复状态开始。
4. 业务归独立模块，经公开入口和端口组合。领域不依赖 React/Tauri/Store；server/app 不绕过模块公开接口。
5. 源文件清单/依赖/公开契约变更后运行 audit:modules 并提交报告。所有后续仓库默认公开，不提交真实笔记、凭据或私人数据。

## 模型分工（用户固定要求）

- 主控负责需求分析、任务拆分、接口与验收标准、依赖排序、调度、代码审查、验证与最终交付。
- 程序及测试代码的生成、修改和缺陷修复默认交给 Luna 子代理，模型标识为 `gpt-6-luna`；该分工已获用户明确授权，后续不需重复确认是否委派。
- 主控下发明确范围、允许修改的文件、模块契约、验收条件和禁止触碰的边界。使用模型覆盖时按工具约束以独立上下文启动，并传入必要需求与仓库信息。
- 只有相互独立且文件边界不重叠的任务才并行；跨模块接口和数据迁移先由主控确定，再交给 Luna 实现。
- 主控审阅真实 diff，独立运行适当检查，重点复核权限、持久化、并发、错误恢复和范围；不把 Luna 的自述作为通过依据。发现问题交回 Luna 修复，再审查验证。
- 最终任务勾选、WORKLOG/HANDOFF 更新、提交和推送由主控负责。仍按已授权阶段推进，这条分工本身不启动 D 系列。
- 如果当前环境无法调用 Luna，应如实说明实际限制，不静默更换模型或声称代码由 Luna 生成。

## 仓库与固定需求

- 路径 /workspace/llm_wiki；公开 origin https://github.com/Saurono/knowledge-workspace ，upstream 保留 nashsu/llm_wiki。
- 分支 codex/knowledge-workspace-v0.1；已推该分支，没有合并 main；最新 SHA 以 Git 为准。
- GPL-3.0，保留上游及星图 MIT 声明。
- 桌面独立与共享 Web 两种模式，无隐式同步。人员 user/admin 使用会话，agent 使用 API Token，工作角色与已授权有效身份同时切换。
- 记忆按项目/角色共享，私有明确授权；用户专门记忆分类仍待补充，访问元数据不是最终分类。扁平多选知识领域。
- Obsidian 只写独立 JSON 回执，不改原笔记。Wiki 来源支持用户/Agent/系统/混合，问题/方案/手册/方法需回流；完整业务仍在后续 D/F/H/I。

## 已完成模块与 B 系列

十八模块：agent、cli、documents、domains、identity、ingestion、memory、obsidian、platform、projects、quality、research、retrieval、service-api、settings、star-map、tasks、wiki。

B01–B06、B07a/B07b、B08–B16 已完成既有本地链路迁移。部分解析/编译和模型传输仍在旧 lib 作应用适配，不代表旧代码全部消失。

B07/B07c 保持未完成：共享 API 与共享 MCP 已有授权入口，但 I02 的完整文档注册/版本/来源工具链尚未完成，不能因 C09 的资源工具就勾选 B07c。

## C 系列完成记录

| 项目 | 提交/记录 | 主要交付 |
| --- | --- | --- |
| C01 | b39ca60 / L028 | 部署、权威数据、离线/同步与本机能力边界 |
| C02 | 185ef89 / L029 | v1 HTTP/SDK、条件版本、SQLite 资源/事件、墓碑 |
| C03 | 8390184 / L030 | 本机能力端口、独立 Web、真实上传与 SSE |
| C04 | a686672 / L031 | 账号、成员、工作角色、矩阵与身份目录 |
| C05 | 3b8605e / L032 | 首次 admin、密码登录、人员会话、限流/失效 |
| C06 | 0345e4e / L033 | Agent Token 范围/到期/吊销/仅摘要持久化 |
| C07 | ae3bb11 / L034 | 真实/有效身份、项目/角色及授权依据的不可变上下文 |
| C08 | f508bed / L035 | 显式委托、凭据绑定切换、旧执行权限上限 |
| C09 | 6354fcc / L036 | 全资源与执行端口授权、私有/角色可见性、共享 CLI/MCP |
| C10 | 本轮最新提交 / L037 | 登录/管理/切换 UI、授权提示、持久审计与查询 |

人员会话负责签发身份委托；Agent 可使用已获授身份/角色，但不签发持久委托，Bearer Token 仅可查看/吊销自身，不能管理同一 Agent 的其他 Token。最后管理员保护还会检查实际登录凭据，不把无口令的旧账号元数据当作可用管理员。

身份 UI 位于 identity/ui，通过传输端口的 identity client 组合到 src/web；不直接读库。共享资源一律经 authorized-repository，上传接收/检索/CLI/MCP/执行器获得受保护端口；任务上下文独立捕获，检查点、写入和结果交付重验授权。无共享任务/本机执行器时返回 501，网关完成不代表 H/I 执行器已实现。

记忆可选 access 元数据为 project/role/private。私有授权匹配真实操作者，借用所有者身份也不能自动读取；管理员无项目或私有内容绕过。过滤后的保存保留隐藏记录/边，不让局部客户端覆盖不可见内容。分类/自动提炼/审核合并/星图仍在 F/G。

审计在处理前持久 pending，响应完成后记录实际结果与真实/有效身份/上下文；路径泛化，不保存口令/Token/正文/检索词。本人、项目管理、全局安全查询分别限范围，global admin 不经全局审计读取未加入项目的数据。崩溃可留 pending，防篡改归档/保留策略仍待运维阶段。

## 运行、迁移与入口

详细手册：[shared-service.md](analysis/implementation/shared-service.md)；规则：[server-authorization.md](analysis/architecture/server-authorization.md)。

Node.js 24，npm ci；可选共享 MCP 先 npm --prefix mcp-server ci。npm run build:shared 构建 Web、服务与 CLI，npm run mcp:build 构建 MCP，npm run start:service 启动默认 127.0.0.1:4317。

首次启动通过运行环境注入 KW_BOOTSTRAP_KEY（至少 24 字符），页面创建首位 admin 后可移除。旧 KW_SERVICE_TOKEN 只是初始化别名，不再授予数据访问；已有密码后无初始化密钥也可启动。HTTPS 设置 KW_SECURE_COOKIE=1。凭据不得放 URL/命令行参数/Git/笔记中。

数据库 schema 7，支持 schema 1 起顺序升级，保留原资源/事件/墓碑。未知未来版本或损坏身份目录拒绝启动，不重置。C04 已有无口令 admin 可同 handle 初始化，保持 ID 和成员关系。升级/回退前停服备份完整数据目录；旧版本不直接打开 schema 7。

共享 CLI：node dist-service/cli.mjs <项目ID> <操作>，JSON 从 stdin 输入；环境 KW_API_URL、KW_AGENT_TOKEN，可选 KW_ACCESS_CONTEXT。共享 MCP：node mcp-server/dist/src/shared.js，同样环境，可选 KW_PROJECT_ID。旧 MCP index.js 与原桌面仍为独立本机信任域，不回退到共享服务或自动同步。

## 验证与已知边界

- 完整回归 190 文件/2284 项通过；旧 MCP 自身 Node test 25 项通过。类型、十八模块边界/477 个生产源文件审计、独立 Web/服务/CLI/MCP、原桌面前端和预览构建通过。
- 真实 HTTP/临时 SQLite 包括升级、重启、条件写/墓碑/事件、会话/Token/上下文/委托/审计持久化、运行中撤权、跨项目/私有/角色越权、上传与 SSE。
- Chromium 全流程 12 组通过，页面异常 0：初始设置/登录、独立会话恢复、Wiki 冲突草稿、真实上传/SSE、领域/记忆、账号/成员/角色、Token 一次展示/吊销、切换草稿取消/只读、显式借用写入、真实/有效身份审计、退出。修复了身份面板与项目面板同 key 造成重挂载的问题，最终浏览器重跑通过。
- 真正 CLI 子进程与 MCP stdio 握手/资源操作、只读/项目固定和连接中吊销全部通过；独立服务移除初始化密钥重启后，会话、Token、Wiki 和审计仍可读取。
- 目前无 cargo，Rust 桥接和真实 watcher/Shell/Vault/模型/桌面安装包未编译或真机验收；远端 CI 也未在本轮验收。构建警告仍有既有分包/动态导入提示。
- 上传只报告 received，sourceIngestedAt=null；跨介质崩溃可遗留孤立文件，D/J 补恢复去重。最终共享执行器/持久任务、完整来源 MCP、最终记忆分类/星图未冒充 C 系列已完成。

复核：check:modules、audit:modules:check、typecheck、test:mocks、mcp:test、build、build:preview、build:shared。端到端脚本为 analysis/implementation/smoke-shared-web.mjs 与 smoke-shared-clients.mjs，均用临时数据及随机凭据并清理；Playwright/Chromium 路径以当前环境为准，不依赖 /tmp 工具必然存在。
