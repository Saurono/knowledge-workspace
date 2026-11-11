# J05 发布验收矩阵（2026-11-10）

最后核对：2026-11-11 09:20

统计：绿 5 行 / 未验证 25 行 / 未做 24 行（仅计矩阵数据行，分类不互斥）。

**怎么用这张表**：发布前逐行核对证据与当前候选版本，任何“未验证”不得当成绿。绿仅限注明的验证口径；已有记录不等于本轮重跑。固定状态列使用绿 / 红 / 未做，“部分”写入备注。本轮只运行模块边界检查；不运行构建、基准或真实模型。工作区原有大量修改，状态检查应比较增量，不能要求整个工作区只剩本文件。

| 能力 | 证据在哪（文件/测试/命令） | 验证方式（自动测试 / 手工 / 未验证） | 现状（绿 / 红 / 未做） | 备注 |
| --- | --- | --- | --- | --- |
| 全量 mock 测试 | [脚本](../../package.json)、[回归记录](../implementation/project-gaps-20261110.md)；`npm run test:mocks` | 自动测试 | 绿 | 既有完整回归记录；排除 real-llm 与 mcp-server，本轮未重跑，不能代表并行修改后的结果。 |
| 类型检查 | [基线验证记录](../evaluation/retrieval-baseline-20261110.md)、[脚本](../../package.json)；`npm run typecheck` | 自动测试 | 绿 | 文档记录 tsc --build EXIT_CODE=0；本轮未重跑。 |
| 模块边界 | [检查器](../../scripts/check-module-boundaries.mjs)；`npm run check:modules` | 自动测试 | 绿 | 本轮直接用指定 Node 执行检查器，结果见下文。 |
| 检索基线 | [报告](../evaluation/retrieval-baseline-20261110.md)、[评估器](../../scripts/eval-retrieval.mjs)；`node scripts/eval-retrieval.mjs` | 自动测试 | 绿 | recall@5 与 citationHitRate 均为 0.9714285714285714；越权返回 0。仅 mock 索引契约层。 |
| 读路径基准 | [M10 报告](../evaluation/m10-read-path-20261110.md) | 自动测试 | 绿 | 1000 条 p50/p95 ms：A 22.9/27.6，B 29.8/33.5，C 3.6/4.0，D 并发组 A 111.6/190.1、C 17.5/29.4。D 为进程内同步调用；本轮未跑基准。 |
| 私有/角色记忆可见性 | [测试](../../server/memory-summaries-auth.test.ts) | 未验证 | 未做 | 已有自动测试源码；本轮未运行，缺候选版本通过日志。 |
| 记忆原子写并发 | [原子测试](../../server/memory-atomic.test.ts)、[规模测试](../../server/memory-scale-bench.test.ts) | 未验证 | 未做 | 源码覆盖不同记忆并发与同记忆版本竞争；缺本轮通过日志，不跑规模基准。 |
| HTTP 并发 | [路由测试](../../server/memory-routes.test.ts) | 未验证 | 未做 | 新查：断言不同记忆 [200,200]、同记忆 [200,409]；缺本轮执行结果。 |
| relations 不漏隐藏 id | [workspace-authorization.test.ts](../../src/modules/service-api/application/workspace-authorization.test.ts)：`filters hidden relations alongside relatedIds and preserves self references`；[memory-graph.test.ts](../../server/memory-graph.test.ts)：`removes private nodes and relations to them` | 未验证 | 未做 | 已核对直接断言：隐藏 B 后 relations 仅保留 C 与自身 A，原始数组保持 3 条；图测试也裁掉私有节点关系。缺候选版本测试通过日志。 |
| 记忆更新 409 修复 | [memory-update-metadata.test.ts](../../server/memory-update-metadata.test.ts)：`updates metadata over HTTP, skips equivalent writes and rejects stale versions` | 未验证 | 未做 | 已有回归断言：元数据更新返回 200、版本递增；等价写不增版本；旧版本仍返回 409。未验证：本轮未运行，缺通过日志。 |
| GET /memories/summaries | [memory-summaries-route.test.ts](../../server/memory-summaries-route.test.ts)：`routes memory summaries with pagination, defaults, validation and permission checks` | 未验证 | 未做 | 项目路径下接口已有分页、默认值、非法参数及 403 断言；未验证：缺本轮通过日志。 |
| GET /memories/graph | [memory-graph-route.test.ts](../../server/memory-graph-route.test.ts)：`routes graph before memory IDs, validates limits, orders nodes and checks permissions` | 未验证 | 未做 | 项目路径下接口已有路由优先级、数量限制、排序及权限断言；未验证：缺本轮通过日志。 |
| GET /workspace?memories=none | [workspace-projection.test.ts](../../server/workspace-projection.test.ts)：`projects memories to an empty array while preserving domains and real metadata`、`projects an authorized view without exposing a hidden memory ID in any field` | 未验证 | 未做 | 已断言 memories 为空、其余数据及 ETag 保持、隐藏 ID 不泄露；未验证：缺本轮通过日志。 |
| 重启恢复 running/report/ingest 为 queued | [队列测试](../../src/modules/tasks/application/task-queue.test.ts) | 未验证 | 未做 | 新查：存在 interrupted records 恢复测试；进程内模拟，缺本轮执行日志。 |
| 并发上限、同域串行、取消、重试 | [调度测试](../../src/modules/tasks/application/scheduler.test.ts) | 未验证 | 未做 | 新查：具备上述用例；进程内验证，缺本轮通过日志。 |
| 任务恢复接真实入库执行器 | [队列](../../src/modules/tasks/application/task-queue.test.ts)、[调度器](../../src/modules/tasks/application/scheduler.test.ts) | 未验证 | 未做 | 未验证（缺端到端接线）；两套进程内测试不能证明真实入库执行器恢复。 |
| real-llm 套件 | [脚本](../../package.json)、[模型测试](../../src/lib/llm-client.real-llm.test.ts)、[嵌入测试](../../src/lib/embedding.real-llm.test.ts)；`npm run test:llm` | 未验证 | 未做 | 有入口但本轮未运行，未确认真实凭据可用。嵌入测试需 RUN_LLM_TESTS=1、EMBEDDING_ENDPOINT、EMBEDDING_MODEL，按服务提供 EMBEDDING_API_KEY；缺真实模型通过日志，跳过不算通过。 |
| 本地小模型接入 | [缺口记录](../implementation/project-gaps-20261110.md)、[任务清单](../../TASKS.md) | 未验证 | 未做 | 没有实现；缺接入实现及实机验收。 |
| 嵌入/检索真实质量 | [契约基线](../evaluation/retrieval-baseline-20261110.md) | 未验证 | 未做 | 部分：只有契约层基线；缺真实嵌入、真实检索质量快照。 |
| Web 前端构建 | [脚本](../../package.json)；`npm run build` | 未验证 | 未做 | 本轮禁止运行；前提为依赖安装、模块边界与类型检查通过，随后 vite build。 |
| 服务构建与启动 | [入口](../../package.json)、[build-service.mjs](../../scripts/build-service.mjs)；`npm run build:service`、`npm run start:service` | 未验证 | 未做 | 构建脚本已使用 rolldown，并配置 @ 别名与 node: 外部依赖，输出 server.mjs、cli.mjs、vault-connector.mjs；已核对修复脚本，缺候选版本构建与启动通过日志，本轮未运行。 |
| 模块审计快照一致性 | [model-gateway README](../../src/modules/model-gateway/README.md)、[审计脚本](../../scripts/audit-modules.mjs)、[JSON 快照](../architecture/module-audit-v1.json)、[审计报告](../architecture/module-boundary-audit.md)；`npm run audit:modules -- --check` | 未验证 | 未做 | 缺失 README 已补，现有快照包含 model-gateway；未验证：本轮未运行审计，缺候选版本 --check 通过日志。 |
| Tauri 桌面构建 | [桌面目录](../../src-tauri)、[构建脚本](../../package.json) | 未验证 | 红 | 任务卡提供的环境阻塞：缺 MSVC Build Tools；报错摘要 `link.exe returned an unexpected error`。本轮未复现，仓库日志未定位；缺工具链修复后的构建证据。 |
| 安装包 | [桌面目录](../../src-tauri) | 未验证 | 未做 | 未产出；缺安装包文件、安装与启动验收。 |
| 摘要模式冲突块 | [手册](../operations/handbook-20261110.md) | 未验证 | 未做 | 手册明确摘要模式没有冲突块。 |
| 网页星图/审批页 | [星图组件](../../src/web/memory-graph-view.tsx)、[网页接线](../../src/web/workspace.tsx)、[手册](../operations/handbook-20261110.md) | 未验证 | 未做 | 星图已接入网页 graph 标签并检查 memory.read；未验证（没有浏览器交互验证）。审批页仍缺本轮页面验收证据。 |
| 全入口 Agent 强制审批 | [手册](../operations/handbook-20261110.md) | 未验证 | 未做 | 缺统一禁止 Agent 直写/自批的角色拦截及全入口验收。 |
| 跨进程队列 | [手册](../operations/handbook-20261110.md) | 未验证 | 未做 | 进程内队列不能作为跨进程调度证据。 |
| I01 完整适配 | [手册](../operations/handbook-20261110.md)、[任务清单](../../TASKS.md) | 未验证 | 未做 | 完整外部 CLI 适配契约未完成，缺本机真实 CLI 验收。 |
| Vault 双向同步 | [手册](../operations/handbook-20261110.md) | 未验证 | 未做 | 当前仅处理回执同步；缺任意 Vault 笔记上传及双向同步。 |

统计口径：仅计矩阵数据行，绿 5 行、验证方式含“未验证”25 行、状态“未做”24 行；三者不是互斥分类。已有测试源码与修复脚本不等于本轮执行通过；其他数字引用已有报告。

## 本轮（11-11）新证据

- relations：[workspace-authorization.test.ts](../../src/modules/service-api/application/workspace-authorization.test.ts) 的 `filters hidden relations alongside relatedIds and preserves self references` 直接断言隐藏关系裁剪；[memory-graph.test.ts](../../server/memory-graph.test.ts) 的 `removes private nodes and relations to them` 覆盖图投影。
- 元数据更新：[memory-update-metadata.test.ts](../../server/memory-update-metadata.test.ts) 的 `updates metadata over HTTP, skips equivalent writes and rejects stale versions` 覆盖正常更新、等价写及旧版本 409。
- 读接口：[memory-summaries-route.test.ts](../../server/memory-summaries-route.test.ts)、[memory-graph-route.test.ts](../../server/memory-graph-route.test.ts)、[workspace-projection.test.ts](../../server/workspace-projection.test.ts) 覆盖 summaries、graph 与 memories=none；用例名见矩阵。
- 服务构建：[scripts/build-service.mjs](../../scripts/build-service.mjs) 已配置 rolldown 三个入口；本轮只核对脚本，未执行构建。
- 模块审计：[scripts/audit-modules.mjs](../../scripts/audit-modules.mjs) 检查 README；[model-gateway/README.md](../../src/modules/model-gateway/README.md) 与 [module-audit-v1.json](../architecture/module-audit-v1.json) 已存在，本轮未执行 --check。
- 网页星图：[src/web/memory-graph-view.tsx](../../src/web/memory-graph-view.tsx) 已由 [src/web/workspace.tsx](../../src/web/workspace.tsx) 接入；未验证（没有浏览器交互验证）。
