# E 系列中断点与复工指令 · 2026-11-09 23:10

上一轮在 22:33 被 ChatGPT 用量上限掐断（`usage_limit_exceeded`，提示 Nov 10 02:28 后可再用），主线程与 Luna 子线程都是 task_complete + 该错误，不是正常收尾。以下为外部主控（大肥鱼）在 23:10 独立核对的实际状态，不是代理自述。

## 已核对的事实

- HEAD `2abae89`（docs，`[skip ci]`）已在 origin `codex/knowledge-workspace-v0.1`；产品提交 `94130f5` 的 CI run #14 三平台 success（2026-11-09T13:45Z）。D01–D09 的交付记录成立。
- 工作区有 29 个已改文件 + 6 个未跟踪文件，全部是 E 系列进行中的东西，**未提交**。文件 mtime 22:26–22:33：
  - E03：`src-tauri/src/agent/tools.rs`、`runtime.rs`、`lib.rs`、`commands/platform.rs` 出现 `AgentRetrievalScope`；TS 侧 `modules/agent/domain/model.ts`、`service-api/domain/protocol.ts` 跟随。
  - E04：`modules/wiki/domain/provenance.ts`（+133/−25）、`app/wiki/provenance.ts`，以及 commit/pages/history/generated-pages/ingest/enrich-wikilinks/lint 等写入入口接线；新增 `components/workspace/wiki-authorship-view.tsx`。
  - E05–E07：只有骨架 `modules/wiki/domain/writeback.ts`、`application/writeback.ts` 及两个测试；**没有** `app/wiki/writeback*` journal/workflow、没有 `WritebackPanel`、没有 server 仓储/路由/SDK 接线。
  - E02、E08 本轮未动。
- 主控实测（node v24.22.2，项目内 vitest）：`src/modules/wiki` + `src/modules/agent` 共 7 文件，**3 个测试失败**，全在 `application/writeback.test.ts`。
- 主控实测 `tsc --build`：**14 条错误**。
- 主控只动了一个字符：`domain/writeback.ts:122` 的 `typeof k !== "object'`（单双引号混用，整文件无法解析）改为 `"object"`，否则连测试都跑不起来。其余一律未改。

## 必须先修的三个阻塞

1. 幂等键两套实现漂移。`application/writeback.ts:22-24` 自己算 SHA-256 得 64 位十六进制再拼 `wb1-`，而 `domain/writeback.ts:111` 的校验只认 `/^wb1-[a-f0-9]{16}$/`；domain 里已有的 `writebackIdempotencyKey()` 压根没被调用。结果 `submit()` 被自己的校验拒绝，3 个测试全红。按契约「幂等键绑定 run/scope/artifact versions/observations」，统一走 domain 导出的那一个函数，不要两份规范。
2. `.at()` 在目标 lib 下不可用（`domain/provenance.ts:80,109,112`、`wiki-authorship-view.tsx:11`）。要么按项目现有写法换下标，要么单独确认提升 lib 目标，别只为这四个调用点改全局编译目标。
3. 类型没补齐：`wiki-authorship-view.tsx:16-17` 用了 `WikiBodyRevision.taskId` / `.reason`，接口里还没有；`app/wiki/pages.ts:7` 未使用的 `WikiWriteAttribution`；`application/writeback.test.ts:1` 未使用的 `vi`。

## 复工顺序（按契约 e-series-contract-20261109.md，不扩范围）

1. 修上面三项，`tsc --build` 与 `vitest run src/modules/wiki src/modules/agent` 先回到全绿。
2. E04 收口：共享 metadata 只由 verified AccessContext 构造、伪造作者拒绝、legacy 未知不回填、同 body/metadata/review 不误记 mixed，这些用例要有实测证据；AuthorshipView 接进 `src/web/workspace.tsx` 前先确认 E05 独占该文件的约定。
3. E05–E07 做完到契约第 12 条：journal、幂等投递、并发冲突留稿、发布走同一 Wiki CAS、回流失败独立 retry、private/跨项目/撤权不发布、每次 publish/retry 重新授权。共享侧没有执行器（H/I），外部 Agent 声称的事件一律 unverified。若要新 SQLite 表/schema 迁移，先出方案再动。
4. E03 收尾：本机与 LLM 两种检索 scope 实质一致、模型参数不能放大范围、空白名单严格 0 结果、受限时禁用 shell/Web/AnyTXT 旁路并明确提示；共享检索仍是先授权再筛选分页。
5. E02 按项走查原检查/修复/规则/审阅/批量入口，结果留 Wiki、运行详情进任务管理器，逐项留证据。
6. E08 过 `d04-entrypoint-matrix.md`，仅覆盖本机 Agent 写入与共享来源投影。
7. 每批冻结后提交开发分支并收集真实 CI；最后改 TASKS/WORKLOG/HANDOFF。

## 纪律

- 不合并 main、不新建 worktree、不碰业务安装程序与真实 Vault/配置。
- K 系列仍未获用户确认，不启动；F–J 不因 E 顺手启动。
- 验收以主控独立重跑为准：测试、类型、边界/审计、桌面/Web/服务构建、真实 HTTP/浏览器/CLI/MCP。fixture 与 native 证据分开记，不凭自述勾选。
