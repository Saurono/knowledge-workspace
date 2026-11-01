# 新会话交接

> 当前状态：用户授权 C 系列全部完成。C05–C09 已完成，继续 C10；不进入 D 系列。

## 工作约定

1. 先读本文件、TASKS、WORKLOG、ARCHITECTURE，检查真实 Git 状态/日志，不假设旧端口或进程还在。
2. 完成一项就勾选 TASKS、追加 WORKLOG（实现/验证/限制）、更新交接、提交并推送；不能只勾选。
3. 当前授权完成整个 C 系列，逐项推进 C06–C10。C05 已接入人员会话；主程序原服务密钥只用于首次管理员初始化。旧 Web 连接页将在 C10 替换，不能继续用旧密钥访问数据。
4. 业务属于模块，经公开入口与端口组合。模块不能依赖旧 Store/Tauri/文件系统；应用与 server 适配器不绕过模块公开接口。
5. 改变源文件/依赖/公开契约后运行 `npm run audit:modules` 并提交报告。所有后续仓库默认公开，不加入真实笔记、凭据或私人数据。

## 仓库与固定选择

- 工作目录 `/workspace/llm_wiki`；公开 origin：https://github.com/Saurono/knowledge-workspace ，upstream 为 nashsu/llm_wiki。
- 开发分支 `codex/knowledge-workspace-v0.1`，最新提交看 Git；本轮已推该分支，没有合并 main。
- GPL-3.0，保留上游及星图 MIT 声明。
- 桌面/Web 两端；将来 user/agent/admin，Agent 用 API Token；角色与已授权有效权限身份一起切换。
- 记忆按项目/角色共享，私有明确授权；用户专门记忆分类仍待补充。扁平多选领域。
- Obsidian 只生成独立 JSON 回执，不改原笔记。Wiki 来源为用户/Agent/系统/混合，Agent 问题/方案/手册/方法回流；CLI/API/MCP 在后续范围内。

## 已完成的迁移

现有十八模块：agent、cli、documents、domains、identity、ingestion、memory、obsidian、platform、projects、quality、research、retrieval、service-api、settings、star-map、tasks、wiki。

B01–B06、B07a/B07b、B08–B16 已完成既有本地链路的迁移。包含入库/研究执行器和有序队列、项目/来源身份、Wiki 条件编辑/冲突/历史/显式提交、检索/证据、Agent 流式生命周期/产出、检查审阅/批量修复、CLI/Obsidian/设置端口、Store 投影和星图查询。

B07/B07c 仍未完成：C02 已建立共享 API 基础，但 I02 新 MCP 的完整文档注册/版本/来源链路尚未实现。不得因此把 B07 勾选。部分解析/编译和模型传输仍是旧 lib 应用适配，不代表所有旧代码已消失。

## C01–C04 本轮结果

- C01 `b39ca60` / L028：部署/离线/同步决策见 analysis/architecture/deployment-and-offline.md。桌面独立数据和共享服务数据各自权威，无隐式双向同步或离线写队列。
- C02 `185ef89` / L029：service-api 共享协议/用例/SDK，server 的真实 Node HTTP/SQLite。项目、Wiki、记忆/领域工作区、文档目录、持久事件；ETag/If-Match、范围游标、统一错误、墓碑防 ABA，资源和事件同事务。
- C03 `8390184` / L030：本地文件/监听/Shell/Vault 端口与项目捕获；原生 watcher 所有者协调。Rust Shell 命令只桥接已有 Agent ToolRegistry，不复制引擎；Shell 确认不代表账号授权。
- Web 独立入口 web.html，app/platform/web 使用真实 API、上传和带 Authorization 的 fetch SSE。取消/项目切换关闭旧连接，断线按最后事件序号恢复。Web 不伪造 Tauri、没有本机桥接时明确拒绝本机文件/Shell/Vault。
- 共享页面实际支持项目、Wiki 编辑/预览、记忆/领域维护与文档上传，复用受控模块。远程仓储保留已加载基线，冲突不偷偷重读后覆盖；Wiki 保留冲突草稿。
- 上传为独立二进制和 received 元数据，sourceIngestedAt=null，不把接收当作解析/入库/索引完成。目录 ID 重用不覆盖旧文件；元数据失败清理文件。跨介质崩溃仍可能遗留孤立文件，恢复/去重是后续 D/J 工作。

- C04 / L031：新增 identity 独立模块，账号类型、成员级别与获授工作角色分别建模；纯权限矩阵和私有记忆 grant 检查。可信内部目录用例提供规范化唯一 handle、最后管理员保护、项目/角色引用和成员权限上限校验；修改已撤销成员不隐式恢复。未开放账号管理 HTTP 路由。
- 身份目录以独立修订/事务条件更新持久化到 SQLite。数据库 schema 1→2 只新增身份目录，保持原项目/资源/版本/墓碑/事件；未来版本或损坏目录拒绝启动。规则与边界见 analysis/architecture/identity-permission-matrix.md。schema 2 不可直接用旧 schema 1 程序回退，应停服备份完整目录。

## 运行与协议

要求 Node.js 24 LTS；操作说明 analysis/implementation/shared-service.md。

```bash
npm ci
npm run build:shared
# 通过运行环境设置 KW_SERVICE_TOKEN（至少 24 字符，绝不提交）。
npm run start:service
```

默认 127.0.0.1:4317，数据目录 `.knowledge-workspace-service`；可设置 KW_SERVICE_HOST/PORT/DATA/WEB_ROOT。静态 Web 与 API 同源。服务连接密钥仅属于当前部署信任域，保留在页面内存，不是人员登录或 Agent Token；C04 只有内部模型与目录，C05–C09 尚未完成。不要把此服务当作已完成多租户隔离的产品。

`npm run dev:web` 在 1422 代理 `/api` 到本机 4317。原桌面 `npm run tauri dev` 独立，原预览 `/preview.html` 仍是明确沙箱。

## 验证与限制

- 最新完整模拟回归：184 文件 / 2264 项通过；类型、十八模块边界/审计、共享 Web/服务、原桌面前端和单文件预览构建通过。
- 真实 HTTP/临时 SQLite 测试覆盖重启、条件并发、墓碑、事件、分页与错误；上传/SSE/端口测试覆盖接收状态、内容下载、路径/超限、顺序恢复、冲突、取消、清理及目录防覆盖。
- 身份回归覆盖三账号×三成员级别、角色切换收窄与跨项目拒绝、私有 grant、双连接条件更新/回滚、管理员保护、重启、真实 schema-1 升级和未来版本/损坏拒绝。CI 共享回归已纳入 identity 并排除旧 mcp-server 的 Node test 文件及真实模型测试。
- Chromium 真实双客户端脚本 `analysis/implementation/smoke-shared-web.mjs`：独立服务提供静态页面，无 Tauri 模拟；项目/Wiki、冲突草稿、SSE、上传、领域/记忆 API 均通过，页面异常为 0。脚本只用临时数据与随机凭据，退出清理。
- 当前无 cargo，新增 Rust 桥接及真实 watcher/Shell/Vault/桌面安装包尚未编译/真机验收，真实模型也未验收。CI 已增加 Node 24、共享 Web/服务和集成测试步骤，但远端 CI 未在本轮验收。
- C04 身份模型已完成但尚未接入 HTTP 鉴权。C05 登录、C06 Token、C07 访问上下文、C08 委托切换、C09 全路由授权均未完成。共享记忆权限、完整执行器后端、最终真实星图仍在后续任务。

复核命令：check:modules、audit:modules:check、typecheck、test:mocks、build、build:preview、build:shared。新会话重新检查临时 artifacts 与端口，不依赖 `/tmp` 工具存在。

## L032 / C05 增量

身份模块已增加人员登录/会话用例及密码校验端口，server 采用 scrypt 随机盐、随机会话摘要、HttpOnly/SameSite Cookie、绝对 12 小时/空闲 30 分钟到期、退出及改密全会话撤销、停用账号失效。初始化密钥只创建首个 admin，事务拒绝重复初始化；新增账号和停用接口只供 admin。数据库 schema 3 新增密码、会话和持久登录限流，5 次失败后 15 分钟窗口限制。真实 HTTP/SQLite 身份与升级 8 项通过，类型和审计通过。C06–C10 仍待实现；旧 HTTP 工厂的兼容测试模式将在 C09 移除，主程序已经使用人员认证。

C06 / L033 已完成：schema 4 Token 摘要持久化，发行/列表/吊销 HTTP 接口，单项目/权限/角色/到期限制，创建时一次返回明文。Agent 身份经 Bearer kwt_ 认证，与人员 Cookie 分开；Token 不可签发新 Token。真实认证/Token/升级 10 项通过。当前继续 C07，C09 尚需移除临时工厂兼容模式并统一人员资源授权。

C07 / L034 已完成：AccessContext 捕获真实/有效身份、项目/角色、凭据引用及授权依据，并冻结快照；服务端 access 路由从已验证身份生成，忽略客户端伪造身份头。上下文及认证回归 21 项+真实 HTTP 1 项通过。继续 C08 委托与切换。

C08 / L035 已完成：schema 5 委托和上下文持久化，/projects/:id/contexts 显式切换及 X-KW-Context 引用；委托需显式匹配授权人与接收者/项目/角色/操作/到期。上下文绑定凭据，解析时重验并保留捕获权限上限，旧任务不继承新权限。项目成员/角色管理只返回本项目目录。24 项定向回归通过。继续 C09，全资源路由仍需统一授权并关闭临时兼容分支。

C09 / L036 已完成：统一 guarded repository 与全资源/执行网关授权，关闭初始化密钥数据访问，项目创建者成员原子登记；记忆项目/角色/私有访问元数据、显式所有者授权及隐藏数据合并保护。任务/共享本机执行器未配置时 501，授权端口已就绪。schema 6；预 C05 无口令 admin 可保持原 ID 初始化密码。真实定向 52 项、独立 CLI/MCP stdio 验证通过。共享 MCP 入口 dist/src/shared.js，旧 index.js 明确保留本机独立信任域。继续 C10 身份与角色 UI、审计查询。操作说明已更新，旧 Web 连接密钥页待替换。
