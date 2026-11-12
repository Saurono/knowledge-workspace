# 后端验收矩阵与计划（2026-11-12）

> 范围：只覆盖**后端**（HTTP 服务、共享 CLI/MCP、SQLite 持久化、事件流、执行入口），不含前端界面。
> 前端视觉/布局单列，见 `acceptance-matrix-20261110.md` 与 `evidence/ui-20261111/`。
> 口径：**「已验」= 本轮（11-11/11-12）有实跑证据**；「源码有测未跑」不算已验；「需前置」写清卡在哪。
> 最近一次全量基线：`tsc --build` 0、`vitest run src server` **3008 通过 / 77 跳过**、边界 19、审计 19/544（HEAD `f42980d` 之后又加了星图修复，跑过全量）。

## 一、验收分层（怎么算过）

| 层 | 手段 | 算过的最低证据 |
| --- | --- | --- |
| L1 自动测试 | `vitest run server …` | 输出里该文件 `passed`，EXIT 0 |
| L2 真实服务冒烟 | 构建产物 `dist-service/server.mjs` + 脚本 | 脚本 `SMOKE_EXIT=0` 且每一步有状态码断言 |
| L3 进程级 | 重启、断电式中断、并发 | 重启后数据一致、无重复、无丢失 |
| L4 边界/恶意 | 越权、超限、坏引用、非法参数 | 返回预期错误码且**无副作用** |
| L5 需人/凭据 | 真实模型、Apple 签名、安装启动 | 有真实输出或截图，否则记「未验」 |

## 二、矩阵

### A. 鉴权、会话与身份

| # | 能力 | 端点/入口 | 验收方式 | 现状 | 证据/缺口 |
| --- | --- | --- | --- | --- | --- |
| A1 | 初始化管理员（需 setup key） | `POST /api/v1/auth/bootstrap` | L1+L2 | 已验 | 冒烟脚本每次跑；缺 key 时 403 |
| A2 | 登录/登出、会话 cookie | `/auth/login`、`/auth/logout` | L1 | 已验 | `server/auth.test.ts` |
| A3 | CSRF：带 cookie 的写请求必须 `X-KW-CSRF: 1` | 全站 | L1+L2 | 已验 | 冒烟踩过 403；`auth.test.ts` 断言 |
| A4 | Agent Token 签发 | `POST /auth/tokens`（201） | L1+L2 | 已验 | `cli-*.test.ts`、`i04-*` |
| A5 | Token 吊销即刻失效 | `DELETE /auth/tokens/:id` | L1+L2 | 已验 | 吊销后 `/cli` 401、事件流 3 秒内关闭 |
| A6 | Token 过期 | `expiresAt` + 注入时钟 | L1 | 已验 | `i04-agent-token-boundaries.test.ts` |
| A7 | Token 权限子集（缺权限 403） | 各资源路由 | L1 | 已验 | 403 覆盖 memory.read / wiki.write |
| A8 | 上下文切换（contexts） | `POST /projects/:id/contexts` | L1 | 已验 | 角色作用域三路径（未绑定/选中/绑定） |
| A9 | 委托（delegation）与身份选择 | `/projects/:id/delegations` | L1 | 源码有测未单独复跑 | 需补一条真实服务冒烟 |
| A10 | 成员与工作角色管理 | `/projects/:id/members`、`/roles` | L1 | 已验 | `cli-*` 夹具建成员 |
| A11 | 跨项目隔离 | 任意 `:id` | L1+L2 | 已验 | 跨项目 `/cli` 403 |
| A12 | 记忆级授权（grants） | `/memories/:id/grants` | L1 | 源码有测未复跑 | 需补冒烟 |

### B. 工作区与记忆

| # | 能力 | 端点/入口 | 验收方式 | 现状 | 证据/缺口 |
| --- | --- | --- | --- | --- | --- |
| B1 | 读 workspace（完整/轻量） | `GET /projects/:id/workspace[?memories=none]` | L1+L2 | 已验 | 轻量：memories=0、revision 保持（实测 4） |
| B2 | 整表 CAS 写 | `PUT /workspace` + `If-Match` | L1+L2 | 已验 | 缺 `If-Match` → 428 |
| B3 | 单条原子写 + 版本冲突 409 | `POST /memories`（`expectedVersion`） | L1+L2 | 已验 | 同记忆并发 200/409；不同记忆 200/200 |
| B4 | 摘要分页 | `GET /memories/summaries` | L1+L2 | 已验 | limit/cursor/403 |
| B5 | 图接口 | `GET /memories/graph` | L1+L2 | 已验 | 路由优先级、limit、排序、权限 |
| B6 | 冲突查询 | `GET /memories/conflicts` | L1+L2 | 已验 | 双向去重、裁定消除、归档排除、GET 不落库 |
| B7 | 检索/召回 | `POST /memories/search`、`/memories/recall`、`/search`、`/retrieval` | L1 | 已验（契约层） | **真实检索质量未验**（需模型凭据） |
| B8 | 过期清扫 | `POST /memories/expire` | L1 | 已验 | 惰性落库语义在 `memory-*` 测试里 |
| B9 | 生命周期（promote/archive/supersede/resolve） | `/memories/:id/{promote,archive}` 等 | L1 | 已验 | 状态机由 `memory/domain` 保证 |
| B10 | 私有/角色可见性不泄漏 | workspace/graph/relations | L1 | 已验 | 隐藏 id 不出现在 relations |
| B11 | 迁移（legacy→v1）与版本压缩 | 读路径 + `migrateMemoriesV1` | L1 | 已验 | 迁移幂等、压缩阈值 |
| B12 | 规模上限（2000 条 / 32KB 内容） | 写入校验 | L1 | 源码有测未复跑 | 需补一条真实服务冒烟 |

### C. Wiki

| # | 能力 | 端点/入口 | 验收方式 | 现状 | 证据/缺口 |
| --- | --- | --- | --- | --- | --- |
| C1 | 列表/读页（含 ETag） | `GET /wiki`、`GET /wiki/page?path=` | L1+L2 | 已验 | 冒烟写入后读回 |
| C2 | 创建（`If-None-Match: *`）/更新（`If-Match`） | `PUT /wiki/page` | L1+L2 | 已验 | 缺条件头返回 428 |
| C3 | 删除页 | `DELETE /wiki/page` | L1 | 源码有测 | 需冒烟 |
| C4 | 时间戳语义（创建保序、删除重置） | 读回 `sourceIngestedAt` 等 | L1 | 已验 | `wiki-timestamps.test.ts` |
| C5 | Wiki 搜索隔离 | `POST /search` | L1 | 已验 | 只在本项目内、越权不泄漏 |
| C6 | 路径规范化拒绝 | `canonicalWikiPagePath` | L1 | 已验 | 非法路径 400 |

### D. 文档与上传

| # | 能力 | 端点/入口 | 验收方式 | 现状 | 证据/缺口 |
| --- | --- | --- | --- | --- | --- |
| D1 | 上传（201）与幂等键 | `POST /documents` + `X-File-Name`/`Idempotency-Key` | L1+L2 | 已验 | 冒烟 201；幂等重放语义有测 |
| D2 | 读字节 | `GET /documents/:id/content` | L1 | 源码有测 | 需冒烟 |
| D3 | 级联删除 | `DELETE /documents/:id` + `If-Match` | L1+L2 | 已验 | 无 If-Match → 428；删后列表消失、字节消失 |
| D4 | 孤儿扫描/清理 | `GET/DELETE /orphans` | L1+L2 | 已验 | 无 `confirm=1` → 400 |
| D5 | 16 MiB 上限 | 读体 | L1 | 源码有测 | 需冒烟（413） |
| D6 | 入库摘要可观测 | `GET /documents/:id/ingestion` | L1 | 源码有测 | 需冒烟 |

### E. 提案与治理

| # | 能力 | 端点/入口 | 验收方式 | 现状 | 证据/缺口 |
| --- | --- | --- | --- | --- | --- |
| E1 | 提交提案（幂等/指纹） | `POST /proposals`、`/cli proposal.submit` | L1+L2 | 已验 | 同键同内容同 id；换证据 409 |
| E2 | 批准前不可见 | 批准前 `memory.summaries` | L2 | 已验 | 冒烟断言 |
| E3 | 批准（记忆/wiki 两类） | `POST /proposals/:id/approve` | L1+L2 | 已验 | 批准后记忆出现 |
| E4 | 拒绝（需理由） | `POST /proposals/:id/reject` | L1 | 源码有测 | 需冒烟 |
| E5 | 批量批准 | `POST /proposals/approve-batch` | L1+L2 | 已验 | dryRun/真批/按 ids 复批 not_pending |
| E6 | 证据必填 | 提交提案 | L1+L2 | 已验 | 空 evidence 400 |

### F. 导入 / 导出 / 生命周期

| # | 能力 | 端点/入口 | 验收方式 | 现状 | 证据/缺口 |
| --- | --- | --- | --- | --- | --- |
| F1 | 导出 bundle | `GET /export` | L1+L2 | 已验 | 含 wiki/记忆；文档只有元数据 |
| F2 | 导入 dryRun/真导/幂等 | `POST /import[?dryRun=1]` | L1+L2 | 已验 | 再导一次记忆不变两条 |
| F3 | 坏引用/版本不符 | 导入 | L1 | 已验 | 400 |
| F4 | 跨项目导入 | 导入 | L1 | 源码有测 | 已知限制：目标项目需先有引用对象 |

### G. 事件、任务与执行入口

| # | 能力 | 端点/入口 | 验收方式 | 现状 | 证据/缺口 |
| --- | --- | --- | --- | --- | --- |
| G1 | 事件查询 | `GET /events` | L1 | 已验 | `events` 测试 |
| G2 | SSE 流（`after` 游标） | `GET /events/stream` | L1+L2 | 已验 | 吊销后关闭 |
| G3 | 任务/CLI 执行入口 | `POST /tasks`、`/cli` | L1 | 已验（降级） | **未配执行后端 → 501**，取消语义未验 |
| G4 | 审计列表 | `GET /audit`、`/admin/audit` | L1+L2 | 已验 | 冒烟断言有 `POST …/mcp` 记录 |

### H. 共享 CLI / MCP

| # | 能力 | 端点/入口 | 验收方式 | 现状 | 证据/缺口 |
| --- | --- | --- | --- | --- | --- |
| H1 | 11 个共享操作（含 search/context.switch） | `POST /cli`、`/mcp` | L1+L2 | 已验 | 真实 cli 子进程 + 真实 MCP stdio 客户端（CI 也跑） |
| H2 | 权限矩阵 | 各工具 | L1 | 已验 | 200/403/501/400 四类 |
| H3 | 注册表与代码不漂移 | `server/api-surface.test.ts` | L1 | 已验 | cli-tool 11 / cli-special 1 / mcp-tool 12 / route 8 |
| H4 | 令牌吊销后共享入口失效 | `/cli` | L1 | 已验 | 401 |

### I. 持久化、健壮性与升级

| # | 能力 | 端点/入口 | 验收方式 | 现状 | 证据/缺口 |
| --- | --- | --- | --- | --- | --- |
| I1 | 重启后数据一致 | 进程重启 | L3 | 已验 | 共享客户端冒烟：重启（无 bootstrap key）后写读一致 |
| I2 | 会话/令牌跨重启 | 重启 | L3 | 已验 | 重启后旧令牌仍可用 |
| I3 | schema 版本与迁移 | SQLite `user_version` | L1 | 已验 | 版本断言引用 `SERVICE_SCHEMA_VERSION` |
| I4 | 无 setup key 时仅当已初始化可起 | 启动 | L3 | 已验 | 冒烟重启分支 |
| I5 | 并发写不同记忆 | 并发 HTTP | L1+L2 | 已验 | 200/200 |
| I6 | 登录限流 | `/auth/login` | L1 | 已验（阈值断言） | 真实 429 未冒烟 |
| I7 | 请求体上限 | 读体 | L1 | 源码有测 | 需冒烟（413） |
| I8 | 错误码一致性（400/401/403/404/409/413/428/429/501） | 全站 | L1 | 部分已验 | 缺一张错误码→触发条件的对照表 |

## 三、缺口清单（按修复价值排序）

| # | 缺口 | 为什么重要 | 前置 |
| --- | --- | --- | --- |
| 1 | 执行后端未配置（`/tasks`、`/cli` 恒 501），取消/重跑/断线语义没验 | H/I 线的总闸；不配它，任务系统只能演示 | 需产品决策：谁执行（本机子进程？外部 Agent？） |
| 2 | 真实检索质量（B7 只到契约层） | F05 分层与召回阈值都挂在这上面 | 需模型凭据（chat + embedding） |
| 3 | 错误码对照表缺失（I8） | 客户端和 Agent 都靠它判断重试策略 | 无 |
| 4 | A9/A12/B12/C3/D2/D5/D6/E4 只有源码有测、本轮未跑 | 可能是绿的，但没证据 | 无，跑一遍即可 |
| 5 | 升级路径（旧库 → 新 schema）没有回退演练 | 发版前必须有一次 | 需要一份旧版本库样本 |
| 6 | 安装后启动（Windows 包已产出） | 产物 ≠ 能用 | 需管理员点一次安装 |

## 四、执行计划（按依赖排序）

- **第 0 步（今天就能做，0 前置）**：把缺口 4 的 8 项跑一遍，全部翻成"已验"或暴露真问题；顺手产出错误码对照表（缺口 3）。
- **第 1 步（等凭据）**：接 real-llm，跑 B7 的真实检索/嵌入质量，给出 recall@k 与耗时；这是 F05 的前置。
- **第 2 步（等决策）**：定执行后端。建议顺序：本机子进程（codex/claude CLI）→ 外部 Agent HTTP → 任务事件回流 I03。定完再做 G3 的取消/断线/重跑三个语义。
- **第 3 步（等样本）**：旧库升级演练：拿一份 11-10 前的 SQLite 样本，跑迁移 → 校验 → 回退。
- **第 4 步（等管理员）**：Windows 包安装 + 启动 + 首登，补 L5 那一格。
- **第 5 步**：全矩阵签字：每条「已验」都要能在 `tools/reports/` 找到对应输出，否则退回"未验"。

## 五、怎么跑（命令原文）

```powershell
$node = "C:\Users\D1761\SnowLuma\nodedist\node-v24.22.2-win-x64\node.exe"
# L1 全量
& $node node_modules/typescript/bin/tsc --build
& $node node_modules/vitest/vitest.mjs run src server --reporter=dot
& $node scripts/check-module-boundaries.mjs
& $node scripts/audit-modules.mjs --check
# L2 真实服务冒烟（两个脚本，见 evidence 目录里的复现段）
#   smoke-i02-cli.mjs（共享 CLI 全链） / smoke-release-http.mjs（导出/导入/孤儿/文档/轻量/批量批准）
#   smoke-shared-clients.mjs（仓库内，真实 cli 子进程 + 真实 MCP stdio 客户端，CI 也跑）
```

**署名与时间**：本矩阵由主控在 2026-11-12 排定；每条「已验」的数字都能在 `tools/reports/` 的对应报告里对上。
