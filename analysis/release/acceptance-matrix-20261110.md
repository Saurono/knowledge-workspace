# J05 发布验收矩阵（2026-11-10）

最后核对：2026-11-11 13:43

统计：绿 30 行 / 未验证 15 行 / 未做 15 行（仅计矩阵数据行，分类不互斥）。

**怎么用这张表**：发布前逐行核对证据与当前候选版本，任何“未验证”不得当成绿。绿仅限注明的验证口径；已有记录不等于本轮重跑。固定状态列使用绿 / 红 / 未做，“部分”写入备注。本轮（11-11 下午）运行了类型检查、全量 mock 测试、模块边界与模块审计；不运行构建、基准或真实模型。工作区原有大量修改，状态检查应比较增量，不能要求整个工作区只剩本文件。

| 能力 | 证据在哪（文件/测试/命令） | 验证方式（自动测试 / 手工 / 未验证） | 现状（绿 / 红 / 未做） | 备注 |
| --- | --- | --- | --- | --- |
| 全量 mock 测试 | [脚本](../../package.json)、[回归记录](../implementation/project-gaps-20261110.md)；`vitest run src server --reporter=dot` | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑：Test Files 284 passed \| 8 skipped (292)，Tests 2989 passed \| 77 skipped (3066)，EXIT 0；跳过不算通过。 |
| 类型检查 | [基线验证记录](../evaluation/retrieval-baseline-20261110.md)、[脚本](../../package.json)；`tsc --build` | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑：tsc --build，EXIT 0。 |
| 模块边界 | [检查器](../../scripts/check-module-boundaries.mjs)；`node scripts/check-module-boundaries.mjs` | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑：Module boundaries passed (19 modules)，EXIT 0。 |
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
| 任务恢复接真实入库执行器 | [队列](../../src/modules/tasks/application/task-queue.test.ts)、[调度器](../../src/modules/tasks/application/scheduler.test.ts) | 未验证 | 未做 | 未验证（缺端到端接线）；两套进程内测试不能证明真实入库执行器恢复。 |
| real-llm 套件 | [脚本](../../package.json)、[模型测试](../../src/lib/llm-client.real-llm.test.ts)、[嵌入测试](../../src/lib/embedding.real-llm.test.ts)；`npm run test:llm` | 未验证 | 未做 | 有入口但本轮未运行，未确认真实凭据可用。嵌入测试需 RUN_LLM_TESTS=1、EMBEDDING_ENDPOINT、EMBEDDING_MODEL，按服务提供 EMBEDDING_API_KEY；缺真实模型通过日志，跳过不算通过。 |
| 本地小模型接入 | [缺口记录](../implementation/project-gaps-20261110.md)、[任务清单](../../TASKS.md) | 未验证 | 未做 | 没有实现；缺接入实现及实机验收。 |
| 嵌入/检索真实质量 | [契约基线](../evaluation/retrieval-baseline-20261110.md) | 未验证 | 未做 | 部分：只有契约层基线；缺真实嵌入、真实检索质量快照。 |
| Web 前端构建 | [脚本](../../package.json)；`npm run build` | 自动测试 | 绿 | CI run [42970068338](https://github.com/Saurono/knowledge-workspace/actions/runs/42970068338)（提交 `fb0852e`）在 ubuntu/macos/windows 三平台跑 `npm run typecheck && npx vite build` 与 `npm run build:web`，全绿；本地 11-11 早上也单独跑过 vite build EXIT 0。 |
| 服务构建与启动 | [入口](../../package.json)、[build-service.mjs](../../scripts/build-service.mjs)；`npm run build:service`、`npm run start:service` | 自动测试 | 绿 | CI 三平台 `npm run build:service` 绿（run 42970068338）；CI 的共享客户端冒烟会真起 `dist-service/server.mjs`；本地 11-11 下午用构建产物起服务 + Agent Token 全链冒烟 `SMOKE_EXIT=0`（见证据文件）。 |
| CI 三平台 | [工作流](../../.github/workflows/ci.yml) | 自动测试 | 绿 | 提交 `976670d` 的 [run 42987214141](https://github.com/Saurono/knowledge-workspace/actions/runs/42987214141)：ubuntu / macos / windows **全部 success**，且**这次 CI 含 `src + server` 全量 mock 套件**（不是早先的子集）；含类型/构建/服务测试/CLI-MCP 冒烟/Rust `cargo build`+`cargo test --lib`。 |
| 模块审计快照一致性 | [model-gateway README](../../src/modules/model-gateway/README.md)、[审计脚本](../../scripts/audit-modules.mjs)、[JSON 快照](../architecture/module-audit-v1.json)、[审计报告](../architecture/module-boundary-audit.md)；`node scripts/audit-modules.mjs --check` | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑：Module audit passed (19 modules, 544 production source files)，EXIT 0；快照已在本轮重生成并随提交落库。 |
| Tauri 桌面构建 | [桌面目录](../../src-tauri)、[构建脚本](../../package.json) | 未验证 | 红 | 本机缺 MSVC Build Tools（`link.exe returned an unexpected error`），本地 `tauri build` 未跑。**但 CI 三平台已绿**：run 42970068338 里 `cargo build`、`cargo test --lib`、`cargo build --features custom-protocol` 全过（含 Windows）。差别是 CI 不是本机、也没打安装包。 |
| 安装包 | [桌面目录](../../src-tauri)、[CI 产物证据](evidence/2026-11-11-windows-installer.md) | 手工（产物产出，未安装） | 未做 | 部分：CI run [42971789528](https://github.com/Saurono/knowledge-workspace/actions/runs/42971789528) 已产出 MSI / NSIS / portable zip（0.6.13，未签名，SHA256 见证据文件）；**未安装、未启动、未验数据目录与端口**。 |
| 摘要模式冲突块 | [手册](../operations/handbook-20261110.md) | 未验证 | 未做 | 手册明确摘要模式没有冲突块。 |
| 网页星图/审批页 | [星图组件](../../src/web/memory-graph-view.tsx)、[网页接线](../../src/web/workspace.tsx)、[手册](../operations/handbook-20261110.md) | 未验证 | 未做 | 星图已接入网页 graph 标签并检查 memory.read；未验证（没有浏览器交互验证）。审批页仍缺本轮页面验收证据。 |
| 全入口 Agent 强制审批 | [手册](../operations/handbook-20261110.md) | 未验证 | 未做 | 缺统一禁止 Agent 直写/自批的角色拦截及全入口验收。 |
| 跨进程队列 | [手册](../operations/handbook-20261110.md) | 未验证 | 未做 | 进程内队列不能作为跨进程调度证据。 |
| I01 完整适配 | [手册](../operations/handbook-20261110.md)、[任务清单](../../TASKS.md) | 未验证 | 未做 | 完整外部 CLI 适配契约未完成，缺本机真实 CLI 验收。 |
| Vault 双向同步 | [手册](../operations/handbook-20261110.md) | 未验证 | 未做 | 当前仅处理回执同步；缺任意 Vault 笔记上传及双向同步。 |
| 统一任务收养通道（不进调度器） | [队列](../../src/modules/tasks/application/task-queue.ts)、[调度器](../../src/modules/tasks/application/scheduler.ts)、[收养测试](../../src/app/tasks/task-pipeline-adopt.test.ts)、[运行时](../../src/app/tasks/task-runtime.ts) | 未验证 | 未做 | H06-E1：只有类型与单测，没有浏览器/真实 MCP 客户端验证。 |
| 旧入库队列→统一任务镜像（执行权仍在旧队列） | [镜像](../../src/app/tasks/ingest-mirror.ts)、[测试](../../src/app/tasks/ingest-mirror.test.ts)、[接线](../../src/components/workspace/task-manager.tsx) | 未验证 | 未做 | H06-E2：只有类型与单测，没有浏览器/真实 MCP 客户端验证。 |
| 任务页镜像去重与旧队列操作映射 | [镜像测试](../../src/app/tasks/ingest-mirror.test.ts)、[任务页](../../src/components/workspace/task-manager.tsx) | 未验证 | 未做 | H05-C1：payload.legacyTaskId → toActivityViews.taskId；只有类型与单测，没有浏览器/真实 MCP 客户端验证。 |
| 共享 CLI `/cli` 记忆只读工具（memory.summaries / memory.graph） | [工具](../../server/resource-tools.ts)、[测试](../../server/cli-resource-tools.test.ts)、[远程入口](../../src/modules/cli/application/remote.ts) | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑 `server/cli-resource-tools.test.ts`：5 passed、EXIT 0；覆盖 200/403/501/400 四类。 |
| 共享 CLI `/cli` 提案工具（proposal.submit / proposal.list） | [工具](../../server/resource-tools.ts)、[测试](../../server/cli-proposal-tools.test.ts)、[远程入口](../../src/modules/cli/application/remote.ts) | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑 `server/cli-proposal-tools.test.ts`：8 passed、EXIT 0；覆盖 pending、批准前不可见、幂等、指纹冲突、空证据、多余字段、列表、降权 403。 |
| 共享 CLI 端到端（构建产物 + Agent Token + 审批门） | [证据](evidence/2026-11-11-shared-cli-smoke.md)、[构建脚本](../../scripts/build-service.mjs) | 手工（真实服务冒烟） | 绿 | 本轮（11-11 下午）主控起 `dist-service/server.mjs`（构建 EXIT 0），走完整鉴权链后由 Agent Token 调 `/cli`：summaries/graph/submit/list 全 200，批准前不可见、批准后可见，幂等重放与 409 指纹冲突均符合预期，`SMOKE_EXIT=0`；未验 `cli.mjs`/MCP 客户端与浏览器。 |
| 共享 MCP 工具表扩展（kw_memory_summaries / kw_memory_graph / kw_proposal_submit / kw_proposal_list） | [共享工具表](../../mcp-server/src/shared-tools.ts)、[断言](../../mcp-server/test/shared-tools.test.ts) | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑 `mcp-server` 构建与 `node --test version.test.js shared-tools.test.js`：8 pass / 0 fail、EXIT 0；真实 MCP 客户端未端到端验证。 |
| I01 CLI/Agent 适配契约文档 | [契约文档](../implementation/cli-agent-contract-20261111.md) | 未验证 | 未做 | 文档完成不等于本机真实 CLI 验证；实现证据只有类型与单测，没有浏览器/真实 MCP 客户端验证。 |
| I04 Agent 令牌与越权边界 | [测试](../../server/i04-agent-token-boundaries.test.ts) | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑：7 passed、全量 285 文件 / 2996 通过、EXIT 0；覆盖吊销/过期/缺权限/角色作用域/跨项目/事件流关闭/无执行后端 501。**取消语义未验证**（没有执行后端）。 |
| B07c 共享 API/MCP 注册表与漂移测试 | [注册表](../architecture/shared-api-surface.json)、[测试](../../server/api-surface.test.ts)、[单一来源常量](../../src/modules/cli/application/remote.ts) | 自动测试 | 绿 | 本轮（11-11 下午）主控实跑：4 passed、全量 286 文件 / 3000 通过、EXIT 0；注册表 cli-tool 10 / cli-special 1 / mcp-tool 11 / route 7，测试断言清单与代码双向相等、路由非 404、9 个 resourceTool 操作非 501。 |
| 项目导出接口 | [路由](../../server/http.ts)、[测试](../../server/project-export.test.ts)、[冒烟证据](evidence/2026-11-11-release-http-smoke.md) | 手工（真实服务） | 绿 | 本轮（11-11 下午）主控用构建产物起真实服务：`GET /projects/:id/export` 200，包内有 wiki 页面与记忆；Web 面板的下载按钮没点过。 |
| 项目导入接口（dryRun + 幂等） | [路由](../../server/http.ts)、[测试](../../server/project-import.test.ts)、[冒烟证据](evidence/2026-11-11-release-http-smoke.md) | 手工（真实服务） | 绿 | 本轮（11-11 下午）真实服务：dryRun 200、真导入 200（`{memories:1,wikiUpdated:1}`）、再导一次 200 且记忆仍是 1 条；文档字节不在包里，导入侧如实返回 0。 |
| 孤儿上传扫描/清理 HTTP | [路由](../../server/http.ts)、[测试](../../server/orphan-uploads-route.test.ts)、[冒烟证据](evidence/2026-11-11-release-http-smoke.md) | 手工（真实服务） | 绿 | 本轮（11-11 下午）真实服务：磁盘造孤儿 → 扫描发现 → 不带 `confirm=1` 删除 400 → 带 `confirm=1` 删除 200 且文件消失。 |
| 文档上传与级联删除 HTTP | [路由](../../server/http.ts)、[测试](../../server/document-lifecycle.test.ts)、[冒烟证据](evidence/2026-11-11-release-http-smoke.md) | 手工（真实服务） | 绿 | 本轮（11-11 下午）真实服务：上传 201（`X-File-Name` + 原始字节）→ 无 `If-Match` 删除 **428** → 带 `If-Match` 删除 200，字节与记录一起消失。 |

统计口径：仅计矩阵数据行，绿 30 行、验证方式含“未验证”15 行、状态“未做”15 行；三者不是互斥分类。已有测试源码与修复脚本不等于本轮执行通过；其他数字引用已有报告。

## 本轮（11-11）新证据

- relations：[workspace-authorization.test.ts](../../src/modules/service-api/application/workspace-authorization.test.ts) 的 `filters hidden relations alongside relatedIds and preserves self references` 直接断言隐藏关系裁剪；[memory-graph.test.ts](../../server/memory-graph.test.ts) 的 `removes private nodes and relations to them` 覆盖图投影。
- 元数据更新：[memory-update-metadata.test.ts](../../server/memory-update-metadata.test.ts) 的 `updates metadata over HTTP, skips equivalent writes and rejects stale versions` 覆盖正常更新、等价写及旧版本 409。
- 读接口：[memory-summaries-route.test.ts](../../server/memory-summaries-route.test.ts)、[memory-graph-route.test.ts](../../server/memory-graph-route.test.ts)、[workspace-projection.test.ts](../../server/workspace-projection.test.ts) 覆盖 summaries、graph 与 memories=none；用例名见矩阵。
- 服务构建：[scripts/build-service.mjs](../../scripts/build-service.mjs) 已配置 rolldown 三个入口；本轮只核对脚本，未执行构建。
- 模块审计：[scripts/audit-modules.mjs](../../scripts/audit-modules.mjs) 检查 README；[model-gateway/README.md](../../src/modules/model-gateway/README.md) 与 [module-audit-v1.json](../architecture/module-audit-v1.json) 已存在，本轮未执行 --check。
- 网页星图：[src/web/memory-graph-view.tsx](../../src/web/memory-graph-view.tsx) 已由 [src/web/workspace.tsx](../../src/web/workspace.tsx) 接入；未验证（没有浏览器交互验证）。

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
