# 新会话交接

## 先读与工作约定

1. 读本文件、[TASKS](TASKS.md)、[WORKLOG](WORKLOG.md)、[ARCHITECTURE](ARCHITECTURE.md)。
2. 在 `/workspace/llm_wiki` 检查 `git status`、分支和最新日志；路径随环境变化时定位仓库，不假设旧后台进程仍运行。
3. 以 TASKS 为任务状态唯一入口：完成一项就勾选、追加 WORKLOG（实现/验证/限制）、更新本文件的执行点并提交。不能仅更新复选框。
4. 保持可回归的小批次迁移，旧调用者迁移完才删除兼容入口。业务规则放模块，通过公开 API 与依赖注入组合，禁止新模块依赖旧 store/Tauri/文件系统。
5. 用户要求继续工作时直接推进已授权的实现与验证。后续仓库默认公开，代码推送到用户 origin；不把机密、真实笔记或凭据加入仓库。

## 仓库与已确认选择

- 工作仓库：https://github.com/Saurono/knowledge-workspace ，公开。
- origin：该仓库；upstream：https://github.com/nashsu/llm_wiki.git 。
- 开发分支：`codex/knowledge-workspace-v0.1`；main 已有首批实现。
- 上游基线：v0.6.13 / `e08cfce`；首批迁移 `d8eeb78`；仓库接入 `da3e522`。当前最新提交以 Git 为准。
- 许可证：GPL-3.0，保留原版权与星图 MIT 声明。
- Agent 通过 API Token；账户角色 user/agent/admin；切换同时涉及工作角色和已授权权限身份。
- 记忆按项目/角色共享，私有需明确授权；最终专门记忆分类方案尚待用户补充。
- 领域为扁平、多选。Obsidian 仅生成独立 JSON 回执，不改原笔记。
- Wiki 来源为用户/Agent/系统自动生成/混合；Agent 问题、解决方案、产出手册和方法都应回流。
- 两前端为桌面与 Web；本机 CLI 与外部 CLI/MCP 都在范围内。

## 实际实现边界

已完成九个模块的部分实际代码：star-map、memory、domains、tasks、quality、wiki、ingestion、retrieval、cli；详见 `analysis/architecture/migration-progress.md`。后五项包含部分纯规则，不能称为对应完整功能已模块化。

数据仍为本地 `.llm-wiki/workspace.json` v1、`ingest-records.json` 和旧入库队列。应用层保持项目锁、原子更新和损坏文件保护。已有界面/预览不代表账号、共享后端、生产 Web 已完成。

## 当前执行点

- 本批完成 A10（任务与交接入口）、B01（外部取消契约，`227da96`）、B02（真实队列通过入库执行器运行；提交与本文件同批，查 Git 最新日志）。
- 下一项 B03：`lib/ingest-queue.ts` 仍包含调度与持久化，优先将其拆为可注入端口的应用服务，保留旧格式/兼容入口与现有竞态测试；不要一次改写全部状态机。
- 继而 B04：`lib/deep-research.ts`/`stores/research-store.ts` 的研究模型、证据规则与执行器；现有研究尚未接入 tasks。
- 当前入库入口：`modules/ingestion/application/execute-ingest.ts` → `app/tasks/ingestion.ts` → 旧 autoIngest，队列保留 epoch、并发提交顺序、部分写入和回执链路。
- 入库每次尝试独立运行时，以隔离同逻辑 ID 的恢复；它不提供持久状态或跨尝试历史。恢复/重试的排他仍由队列/锁负责。
- 最新验证：模拟回归 152 文件/2114 项、九模块边界、类型、正式/预览构建通过；详情 L006/L007。B03/B04 尚未开始，不误标完成。

## 验证与启动

```bash
npm ci
npm run check:modules
npm run typecheck
npm run test:mocks
npm run build
npm run build:preview
```

- 有针对性地运行受影响契约/集成测试；通过后再做必要整体回归。
- `npm run dev` 为前端；桌面需 `npm run tauri dev` 和 Rust/Tauri 依赖。
- 本环境此前没有 cargo，未进行真实模型/真实 Vault/原生 watcher 验收。新会话重新检查工具能力。
- 交互模拟预览源为 `preview.html` 与 `src/preview`，构建产物在 `dist-preview/preview.html`。它使用模拟文件系统，不使用生产身份和笔记。
- 旧临时浏览器脚本/端口可能已失效；可参考 `analysis/implementation/smoke-workspace.mjs`，不要依赖 `/tmp` 文件存在。
- 新增测试勿放被 `.gitignore` 忽略的 `tests/` 目录；优先与源码同目录，或明确跟踪。
