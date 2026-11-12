# J05 发布验收矩阵（2026-11-10）

最后核对：2026-11-12；候选 f42980d。历史证据按行内日期/提交保留。

统计：绿 30 行 / 红 1 行 / 部分 3 行 / 待验收 11 行 / 未实现 5 行（互斥状态；仅计矩阵数据行，不等于整体完成率）。

**怎么用这张表**：发布前逐行核对证据与当前候选版本，任何“未验证”不得当成绿。绿仅限注明的验证口径；已有记录不等于本轮重跑。固定状态列使用绿 / 红 / 部分 / 待验收 / 未实现。绿只代表该行限定的检查；部分表示已有实现或产物但范围未齐；待验收表示有实现/测试但缺目标场景证据；未实现表示相应目标能力仍缺。11-12 本轮重跑类型、src/server mock、模块边界与审计；核对实时远端 CI。未重跑构建、基准、浏览器、安装器或真实模型。核对开始工作区干净，旧文档所述脏工作区仅为历史。

| 能力 | 证据在哪（文件/测试/命令） | 验证方式（自动测试 / 手工 / 未验证） | 现状 | 备注 |
| --- | --- | --- | --- | --- |
| 全量 mock 测试 | [本次对齐报告](status-reconciliation-20261112.md)；`vitest run src server --exclude **/*.real-llm.test.ts --reporter=dot` | 自动测试 | 绿 | 2026-11-12，基线 f42980d 本机重跑：283 文件通过、2 跳过；2999 项通过、6 跳过，EXIT 0。不含 analysis/evaluation、独立 MCP Node test、原生或真实模型，跳过不算通过。 |
| 类型检查 | [本次对齐报告](status-reconciliation-20261112.md)；`tsc --build --pretty false` | 自动测试 | 绿 | 2026-11-12，f42980d 本机重跑 EXIT 0。 |
| 模块边界 | [检查器](../../scripts/check-module-boundaries.mjs)、[本次报告](status-reconciliation-20261112.md) | 自动测试 | 绿 | 2026-11-12，f42980d 本机重跑：19 modules，EXIT 0。 |
| 检索基线 | [报告](../evaluation/retrieval-baseline-20261110.md)、[评估器](../../scripts/eval-retrieval.mjs)；`node scripts/eval-retrieval.mjs` | 自动测试 | 绿 | recall@5 与 citationHitRate 均为 0.9714285714285714；越权返回 0。仅 mock 索引契约层。 |
| 读路径基准 | [M10 报告](../evaluation/m10-read-path-20261110.md) | 自动测试 | 绿 | 1000 条 p50/p95 ms：A 22.9/27.6，B 29.8/33.5，C 3.6/4.0，D 并发组 A 111.6/190.1、C 17.5/29.4。D 为进程内同步调用；本轮未跑基准。 |
| 私有/角色记忆可见性 | [测试](../../server/memory-summaries-auth.test.ts) | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑 `memory-summaries-auth.test.ts` 通过；同批 9 文件 / 75 用例全绿。 |
| 记忆原子写并发 | [原子测试](../../server/memory-atomic.test.ts)、[规模测试](../../server/memory-scale-bench.test.ts) | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑 `memory-atomic.test.ts` 通过（同批 9 文件 / 75 用例）；**规模基准 `memory-scale-bench.test.ts` 仍按 `KW_BENCH` 门控跳过**，未重跑。 |
| HTTP 并发 | [路由测试](../../server/memory-routes.test.ts) | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑 `memory-routes.test.ts` 通过（不同记忆 [200,200]、同记忆 [200,409] 均按断言成立，同批 9 文件 / 75 用例）。 |
| relations 不漏隐藏 id | [workspace-authorization.test.ts](../../src/modules/service-api/application/workspace-authorization.test.ts)：`filters hidden relations alongside relatedIds and preserves self references`；[memory-graph.test.ts](../../server/memory-graph.test.ts)：`removes private nodes and relations to them` | 自动测试 | 绿 | 断言已在源码里核对（隐藏 B 后 relations 只剩 C 与自身 A，原始数组仍 3 条；图测试裁私有节点关系）；本轮（11-11 下午）`workspace-authorization.test.ts` 实跑通过（同批 9 文件 / 75 用例）。 |
| 记忆更新 409 修复 | [memory-update-metadata.test.ts](../../server/memory-update-metadata.test.ts)：`updates metadata over HTTP, skips equivalent writes and rejects stale versions` | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑通过：元数据更新 200 且版本递增、等价写不增版本、旧版本仍 409（同批 9 文件 / 75 用例）。 |
| GET /memories/summaries | [memory-summaries-route.test.ts](../../server/memory-summaries-route.test.ts)：`routes memory summaries with pagination, defaults, validation and permission checks` | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑通过：分页、默认值、非法参数、403 均按断言成立（同批 9 文件 / 75 用例）。 |
| GET /memories/graph | [memory-graph-route.test.ts](../../server/memory-graph-route.test.ts)：`routes graph before memory IDs, validates limits, orders nodes and checks permissions` | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑通过：路由优先级、limit 校验、排序、权限均按断言成立（同批 9 文件 / 75 用例）。 |
| GET /workspace?memories=none | [workspace-projection.test.ts](../../server/workspace-projection.test.ts)、[冒烟证据](evidence/2026-11-11-release-http-smoke.md) | 手工（真实服务） | 绿 | 本轮（11-11 下午）真实服务：`memories` 为空、`revision` 与完整 GET 相同（元数据真实）、非法投影 `memories=all` 返回 **400**；单测另有"隐藏 ID 不泄露"断言。 |
| 提案批量批准 HTTP | [路由](../../server/http.ts)、[测试](../../server/proposal-batch.test.ts)、[冒烟证据](evidence/2026-11-11-release-http-smoke.md) | 手工（真实服务） | 绿 | 本轮（11-11 下午）真实服务：两条提案 dryRun 能列出 eligible、真批 approved 两条、批准后 `memory.summaries` 里出现两条；**按 ids 再批一次逐条报 `not_pending`**（不带 ids 时 `failed` 恒为空，是既有语义）。 |
| 重启恢复 running/report/ingest 为 queued | [队列测试](../../src/modules/tasks/application/task-queue.test.ts) | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑 `task-queue.test.ts` 通过：被中断记录恢复为 queued 且计数正确；进程内模拟，不代表跨进程恢复。 |
| 并发上限、同域串行、取消、重试 | [调度测试](../../src/modules/tasks/application/scheduler.test.ts) | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑 `scheduler.test.ts` 通过：并发上限、同域串行、取消让位、重试新开任务均按断言成立。 |
| 任务恢复接真实入库执行器 | [队列](../../src/modules/tasks/application/task-queue.test.ts)、[调度器](../../src/modules/tasks/application/scheduler.test.ts) | 未验证 | 待验收 | 未验证（缺端到端接线）；两套进程内测试不能证明真实入库执行器恢复。 |
| real-llm 套件 | [脚本](../../package.json)、[模型测试](../../src/lib/llm-client.real-llm.test.ts)、[嵌入测试](../../src/lib/embedding.real-llm.test.ts)；`npm run test:llm` | 未验证 | 待验收 | 有入口但本轮未运行，未确认真实凭据可用。嵌入测试需 RUN_LLM_TESTS=1、EMBEDDING_ENDPOINT、EMBEDDING_MODEL，按服务提供 EMBEDDING_API_KEY；缺真实模型通过日志，跳过不算通过。 |
| 本地小模型接入 | [缺口记录](../implementation/project-gaps-20261110.md)、[任务清单](../../TASKS.md) | 未验证 | 未实现 | 没有实现；缺接入实现及实机验收。 |
| 嵌入/检索真实质量 | [契约基线](../evaluation/retrieval-baseline-20261110.md) | 未验证 | 待验收 | 部分：只有契约层基线；缺真实嵌入、真实检索质量快照。 |
| Web 前端构建 | [脚本](../../package.json)；`npm run build` | 自动测试 | 绿 | CI run [42970068338](https://github.com/Saurono/knowledge-workspace/actions/runs/42970068338)（提交 `fb0852e`）在 ubuntu/macos/windows 三平台跑 `npm run typecheck && npx vite build` 与 `npm run build:web`，全绿；本地 11-11 早上也单独跑过 vite build EXIT 0。 |
| 服务构建与启动 | [入口](../../package.json)、[build-service.mjs](../../scripts/build-service.mjs)；`npm run build:service`、`npm run start:service` | 自动测试 | 绿 | CI 三平台 `npm run build:service` 绿（run 42970068338）；CI 的共享客户端冒烟会真起 `dist-service/server.mjs`；本地 11-11 下午用构建产物起服务 + Agent Token 全链冒烟 `SMOKE_EXIT=0`（见证据文件）。 |
| CI 三平台 | [当前 run 43042394303](https://github.com/Saurono/knowledge-workspace/actions/runs/43042394303)、[诊断](status-reconciliation-20261112.md) | 自动测试（实时远端核对） | 红 | 2026-11-12 查询 f42980d：三平台均失败。Windows memory-routes 10000ms 超时；macOS MCP 工具数实际 12/预期 11；Ubuntu apt DNS 失败。历史 976670d/42987214141 和 b5ec9dc/42991687625 全绿不能代表当前候选。 |
| 模块审计快照一致性 | [审计脚本](../../scripts/audit-modules.mjs)、[快照](../architecture/module-audit-v1.json)、[本次报告](status-reconciliation-20261112.md) | 自动测试 | 绿 | 2026-11-12，f42980d 本机 `--check`：19 modules / 544 production source files，EXIT 0。 |
| Tauri 桌面构建 | [构建脚本](../../package.json)、[安装包证据](evidence/2026-11-11-windows-installer.md) | 历史 CI / 本机环境受限 | 部分 | 历史候选有三平台 cargo 构建/测试与 dc40efa 安装包；本机缺 MSVC 的限制不能等同产品构建失败。当前 f42980d CI 尚未全部通过，本次未重新执行 Rust/打包。 |
| 安装包 | [桌面目录](../../src-tauri)、[CI 产物证据](evidence/2026-11-11-windows-installer.md) | 手工（产物产出，未安装） | 待验收 | 部分：CI run [42971789528](https://github.com/Saurono/knowledge-workspace/actions/runs/42971789528) 已产出 MSI / NSIS / portable zip（0.6.13，未签名，SHA256 见证据文件）；**未安装、未启动、未验数据目录与端口**。 |
| 摘要模式冲突块 | [路由](../../server/http.ts)、[路由测试](../../server/memory-conflicts.test.ts)、[组件](../../src/modules/memory/ui/memory-library.tsx)、[组件测试](../../src/modules/memory/ui/memory-library.test.tsx)、[Web 接线](../../src/web/workspace.tsx)、[浏览器证据](evidence/ui-20261111/README.md) | 自动测试 + 手工（真 Edge） | 绿 | 2026-11-11：服务端 `GET /memories/conflicts`（7 场景）+ 组件三模式渲染断言 + Web 每次摘要加载后刷新；**真浏览器里选中「构建时间 30 秒」后，详情里出现「冲突」段并显示 `conflict-b / 构建时间 5 分钟`**（截图 `05-conflict-detail.png`、文本 `05-conflict-detail.txt`）。 |
| 网页星图页 | [星图组件](../../src/web/memory-graph-view.tsx)、[网页接线](../../src/web/workspace.tsx)、[浏览器证据](evidence/ui-20261111/README.md) | 手工（真 Edge + CDP） | 绿 | 2026-11-11 17:20 真浏览器：登录 → 记忆库 → 星图标签，**8 个节点按语义渲染、连线与工具条正常**；17:20 发现"退不回主页"，22:55 已修：画布套定位容器（不再盖住标签栏）、加「← 返回」、滚轮只在 Ctrl/⌘ 时缩放；CDP 复验 `hasBack=true`、画布 1236×633/视口 907、返回后 `BACK_OK=true`。**导出/导入控件在页面上但没实际点**；桌面端未验。 |
| 网页审批页 | [手册](../operations/handbook-20261110.md)、[TASKS.md](../../TASKS.md) | 未验证 | 未实现 | Web 目前只有 Wiki/文档/记忆库/星图/知识领域五个标签，**没有审批页**（提案只能在管理员侧走 API/桌面端），别把它当"页面存在但没测"。 |
| 全入口 Agent 强制审批 | [手册](../operations/handbook-20261110.md) | 未验证 | 未实现 | 缺统一禁止 Agent 直写/自批的角色拦截及全入口验收。 |
| 跨进程队列 | [手册](../operations/handbook-20261110.md) | 未验证 | 未实现 | 进程内队列不能作为跨进程调度证据。 |
| I01 完整适配 | [CLI/Agent 契约](../implementation/cli-agent-contract-20261111.md)、[任务清单](../../TASKS.md) | 未验证（真实本机链路） | 待验收 | 适配契约已写，桌面子进程与共享调用为两条链；仍缺真实 Claude/Codex 登录、模型调用与完整错误/取消验收，不再写成“契约未完成”。 |
| Vault 双向同步 | [手册](../operations/handbook-20261110.md) | 未验证 | 未实现 | 当前仅处理回执同步；任意 Vault 笔记上传/双向同步未实现，属额外能力边界，不据此撤销 D06–D09 的回执验收。 |
| 统一任务收养通道（不进调度器） | [队列](../../src/modules/tasks/application/task-queue.ts)、[调度器](../../src/modules/tasks/application/scheduler.ts)、[收养测试](../../src/app/tasks/task-pipeline-adopt.test.ts)、[运行时](../../src/app/tasks/task-runtime.ts) | 未验证 | 待验收 | H06-E1：只有类型与单测，没有浏览器/真实 MCP 客户端验证。 |
| 旧入库队列→统一任务镜像（执行权仍在旧队列） | [镜像](../../src/app/tasks/ingest-mirror.ts)、[测试](../../src/app/tasks/ingest-mirror.test.ts)、[接线](../../src/components/workspace/task-manager.tsx) | 未验证 | 待验收 | H06-E2：只有类型与单测，没有浏览器/真实 MCP 客户端验证。 |
| 任务页镜像去重与旧队列操作映射 | [镜像测试](../../src/app/tasks/ingest-mirror.test.ts)、[任务页](../../src/components/workspace/task-manager.tsx) | 未验证 | 待验收 | H05-C1：payload.legacyTaskId → toActivityViews.taskId；只有类型与单测，没有浏览器/真实 MCP 客户端验证。 |
| 共享 CLI `/cli` 记忆只读工具（memory.summaries / memory.graph） | [工具](../../server/resource-tools.ts)、[测试](../../server/cli-resource-tools.test.ts)、[远程入口](../../src/modules/cli/application/remote.ts) | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑 `server/cli-resource-tools.test.ts`：12 passed、EXIT 0；覆盖 200/403/501/400 四类。**2026-11-11 17:05 追加 `memory.conflicts`**（limit 1–1000、只读、授权后计算），CLI/MCP/注册表三处同步。 |
| 共享 CLI `/cli` 提案工具（proposal.submit / proposal.list） | [工具](../../server/resource-tools.ts)、[测试](../../server/cli-proposal-tools.test.ts)、[远程入口](../../src/modules/cli/application/remote.ts) | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑 `server/cli-proposal-tools.test.ts`：8 passed、EXIT 0；覆盖 pending、批准前不可见、幂等、指纹冲突、空证据、多余字段、列表、降权 403。 |
| 共享 CLI 端到端（构建产物 + Agent Token + 审批门） | [证据](evidence/2026-11-11-shared-cli-smoke.md)、[构建脚本](../../scripts/build-service.mjs) | 手工（真实服务冒烟） | 绿 | 本轮（11-11 下午）主控起 `dist-service/server.mjs`（构建 EXIT 0），走完整鉴权链后由 Agent Token 调 `/cli`：summaries/graph/submit/list 全 200，批准前不可见、批准后可见，幂等重放与 409 指纹冲突均符合预期，`SMOKE_EXIT=0`；未验 `cli.mjs`/MCP 客户端与浏览器。 |
| 共享 MCP 工具表扩展（含 kw_memory_conflicts） | [工具表](../../mcp-server/src/shared-tools.ts)、[测试](../../mcp-server/test/shared-tools.test.ts) | 历史自动测试 / 当前远端冒烟失败 | 部分 | 工具表当前 12 项，新增 conflicts 已接线；独立 Node test 本轮未重跑。当前 CI 冒烟仍预期 11，真实 stdio 全链未通过，不能用旧 11 工具记录替代。 |
| I01 CLI/Agent 适配契约文档 | [契约文档](../implementation/cli-agent-contract-20261111.md) | 未验证 | 待验收 | 文档完成不等于本机真实 CLI 验证；实现证据只有类型与单测，没有浏览器/真实 MCP 客户端验证。 |
| I04 Agent 令牌与越权边界 | [测试](../../server/i04-agent-token-boundaries.test.ts) | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑：7 passed、全量 285 文件 / 2996 通过、EXIT 0；覆盖吊销/过期/缺权限/角色作用域/跨项目/事件流关闭/无执行后端 501。**取消语义未验证**（没有执行后端）。 |
| B07c 共享 API/MCP 注册表与漂移测试 | [注册表](../architecture/shared-api-surface.json)、[漂移测试](../../server/api-surface.test.ts) | 自动测试 | 绿 | 当前清单 cli-tool 11 / cli-special 1 / mcp-tool 12 / route 8；漂移测试包含在 11-12 本机 src/server 通过范围。仅证明注册表一致，不等同 B07c 全文档来源/修订链已完成，也不代替 CLI/MCP 冒烟。 |
| 项目导出接口 | [路由](../../server/http.ts)、[测试](../../server/project-export.test.ts)、[冒烟证据](evidence/2026-11-11-release-http-smoke.md) | 手工（真实服务） | 绿 | 本轮（11-11 下午）主控用构建产物起真实服务：`GET /projects/:id/export` 200，包内有 wiki 页面与记忆；Web 面板的下载按钮没点过。 |
| 项目导入接口（dryRun + 幂等） | [路由](../../server/http.ts)、[测试](../../server/project-import.test.ts)、[冒烟证据](evidence/2026-11-11-release-http-smoke.md) | 手工（真实服务） | 绿 | 本轮（11-11 下午）真实服务：dryRun 200、真导入 200（`{memories:1,wikiUpdated:1}`）、再导一次 200 且记忆仍是 1 条；文档字节不在包里，导入侧如实返回 0。 |
| 孤儿上传扫描/清理 HTTP | [路由](../../server/http.ts)、[测试](../../server/orphan-uploads-route.test.ts)、[冒烟证据](evidence/2026-11-11-release-http-smoke.md) | 手工（真实服务） | 绿 | 本轮（11-11 下午）真实服务：磁盘造孤儿 → 扫描发现 → 不带 `confirm=1` 删除 400 → 带 `confirm=1` 删除 200 且文件消失。 |
| 文档上传与级联删除 HTTP | [路由](../../server/http.ts)、[测试](../../server/document-lifecycle.test.ts)、[冒烟证据](evidence/2026-11-11-release-http-smoke.md) | 手工（真实服务） | 绿 | 本轮（11-11 下午）真实服务：上传 201（`X-File-Name` + 原始字节）→ 无 `If-Match` 删除 **428** → 带 `If-Match` 删除 200，字节与记录一起消失。 |
| Wiki 结构化回流产品闭环（E05–E07） | [草稿服务](../../src/modules/wiki/application/writeback.ts)、[对齐报告](status-reconciliation-20261112.md) | 源码核对 + 规则自动测试 | 部分 | 领域/应用规则已有实现与测试；未找到产品 journal/发布编排/UI/服务接线，缺同 Wiki CAS 发布及重验授权/失败独立重试。记忆提案不等同 Wiki 回流。 |
| Web 布局与视觉规范（G06） | [既有截图](evidence/ui-20261111/03-workspace.png)、[诊断](status-reconciliation-20261112.md) | 截图与源码审查；用户反馈 | 待验收 | 当前管理/身份面板占据首屏，导航/导入导出/连接状态混排；功能可操作不等于设计达标。需统一框架、层级、排版、间距及三页原型后验收。 |
| Web 多尺寸与无障碍（G07） | [既有浏览器证据](evidence/ui-20261111/README.md)、[任务清单](../../TASKS.md) | 未验证（专项验收） | 待验收 | 只有单项目桌面宽度操作记录；手机/平板/桌面宽度、键盘焦点、对比度及低动态未全面验证。 |

统计口径：绿 30 行 / 红 1 行 / 部分 3 行 / 待验收 11 行 / 未实现 5 行。仅计矩阵数据行，状态互斥；历史证据不自动升级为当前候选通过。

## 2026-11-12 对齐结论

当前发布门槛未满足：最新远端 CI 红；旧安装包未安装/启动；真实模型/检索质量与真实执行器恢复等仍缺。详见 [状态报告](status-reconciliation-20261112.md)。本次未修改程序、测试或工作流。下方旧轮次的“本轮”均指 11-11，不能当成今天重跑。

## 历史证据（2026-11-11；按原轮次保留）

- relations：[workspace-authorization.test.ts](../../src/modules/service-api/application/workspace-authorization.test.ts) 的 `filters hidden relations alongside relatedIds and preserves self references` 直接断言隐藏关系裁剪；[memory-graph.test.ts](../../server/memory-graph.test.ts) 的 `removes private nodes and relations to them` 覆盖图投影。
- 元数据更新：[memory-update-metadata.test.ts](../../server/memory-update-metadata.test.ts) 的 `updates metadata over HTTP, skips equivalent writes and rejects stale versions` 覆盖正常更新、等价写及旧版本 409。
- 读接口：[memory-summaries-route.test.ts](../../server/memory-summaries-route.test.ts)、[memory-graph-route.test.ts](../../server/memory-graph-route.test.ts)、[workspace-projection.test.ts](../../server/workspace-projection.test.ts) 覆盖 summaries、graph 与 memories=none；用例名见矩阵。
- 服务构建：[scripts/build-service.mjs](../../scripts/build-service.mjs) 已配置 rolldown 三个入口；本轮只核对脚本，未执行构建。
- 模块审计：[scripts/audit-modules.mjs](../../scripts/audit-modules.mjs) 检查 README；[model-gateway/README.md](../../src/modules/model-gateway/README.md) 与 [module-audit-v1.json](../architecture/module-audit-v1.json) 已存在，该句为上午记录；11-12 已独立执行 --check 通过，见上方矩阵。
- 网页星图：[src/web/memory-graph-view.tsx](../../src/web/memory-graph-view.tsx) 已由 [src/web/workspace.tsx](../../src/web/workspace.tsx) 接入；该描述为上午状态，已被当日真 Edge 记录取代，见上方矩阵与 evidence/ui-20261111/README.md。

### 下午段（13:45 前后）

以下为主控提供的本轮实跑证据；上方上午段记录保留原貌。

- 仓库根 `tsc --build`（按任务卡原文：`node C:\Users\D1761\SnowLuma\nodedist\node-v24.22.2-win-x64\node.exe node_modules/typescript/bin/tsc --build`）→ EXIT 0。
- `vitest run src server --reporter=dot` → Test Files 284 passed | 8 skipped (292)，Tests 2989 passed | 77 skipped (3066)，EXIT 0。
- `node scripts/check-module-boundaries.mjs` → Module boundaries passed (19 modules)，EXIT 0。
- `node scripts/audit-modules.mjs --check` → Module audit passed (19 modules, 544 production source files)，EXIT 0；快照已在本轮重生成并随提交落库。
- `vitest run server/cli-resource-tools.test.ts` → 5 passed；`vitest run server/cli-proposal-tools.test.ts` → 8 passed（同一轮定向跑过）。
- `mcp-server`：`tsc -p tsconfig.json` EXIT 0；`node --test dist/test/version.test.js dist/test/shared-tools.test.js` → 8 pass / 0 fail。
- 真实服务冒烟：`node scripts/build-service.mjs` EXIT 0 后起 `dist-service/server.mjs`，用 Agent Token 走 `/cli` 全链（summaries / graph / proposal.submit / proposal.list / 批准），**SMOKE_EXIT=0**；记录见 [证据](evidence/2026-11-11-shared-cli-smoke.md)。
- 发布面 HTTP 冒烟：同一份真实服务脚本覆盖导出 / 导入 / 孤儿清理 / 文档级联删除 / 轻量 workspace / 批量批准，**SMOKE_EXIT=0**；记录见 [证据](evidence/2026-11-11-release-http-smoke.md)。
- 旧「未验证」批量补跑（11-11 15:18）：`memory-summaries-auth`、`memory-atomic`、`memory-routes`、`workspace-authorization`、`memory-update-metadata`、`memory-summaries-route`、`memory-graph-route`、`task-queue`、`scheduler` —— **9 文件 / 75 用例全过，EXIT 0**；对应 9 行据此翻绿（规模基准仍按 `KW_BENCH` 门控跳过）。
