# 新会话交接

## 先读与工作约定

1. 读本文件、[TASKS](TASKS.md)、[WORKLOG](WORKLOG.md)、[ARCHITECTURE](ARCHITECTURE.md)。
2. 在 `/workspace/llm_wiki` 检查 `git status`、分支和最新日志；路径随环境变化时定位仓库，不假设旧后台进程仍运行。
3. 以 TASKS 为任务状态唯一入口：完成一项就勾选、追加 WORKLOG（实现/验证/限制）、更新本文件的执行点并提交。不能仅更新复选框。
4. 保持可回归的小批次迁移，旧调用者迁移完才删除兼容入口。业务规则放模块，通过公开 API 与依赖注入组合，禁止新模块依赖旧 store/Tauri/文件系统。
5. 用户已明确要求任务完成后自动继续：完成、验证、记账与提交后直接推进下一项；仅遇到必要用户信息或权限阻塞时暂停。后续仓库默认公开，代码推送到用户 origin；不把机密、真实笔记或凭据加入仓库。

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

已完成十二个模块的部分实际代码：star-map、memory、domains、tasks、quality、wiki、ingestion、retrieval、cli、research、projects、documents；详见 `analysis/architecture/migration-progress.md`。后五项包含部分纯规则，不能称为对应完整功能已模块化。

数据仍为本地 `.llm-wiki/workspace.json` v1、`ingest-records.json` 和旧入库队列。应用层保持项目锁、原子更新和损坏文件保护。已有界面/预览不代表账号、共享后端、生产 Web 已完成。

## 当前执行点

- 已完成 A10（任务与交接入口）、B01（外部取消，`227da96`）、B02（入库执行器接入，`a4c2641`）、B03（本批队列服务迁移；提交与本文件同批，查最新 Git 日志）。
- B04/B05 已完成：research 模型/证据/执行器（ef25e89）；tasks/ui 和 research/ui 为受控页面，应用容器注入数据与操作。B06 项目模型/仓储也已完成（相关 95 项测试、类型通过）；B07a 文档来源规则/仓储/版本查询也已完成；B07b 本地登记/移动链路也已完成；B07c 依赖新增 API/MCP（C02/I02），B08a Wiki 仓储/编辑预览接入也已完成；当前自动继续 B08b 页面合并规则/解析与备份端口。B08c 和 B08 总项仍未完成。
- 队列入口已变更：`modules/ingestion/application/queue.ts` 的 `createIngestQueue(ports)` 拥有完整调度/恢复/串行快照写入；`app/ingestion/queue.ts` 装配桌面实例，`queue-repository.ts` 适配旧文件路径；旧 `lib/ingest-queue.ts` 仅兼容重导出。
- 入库执行入口：`modules/ingestion/application/execute-ingest.ts` → `app/tasks/ingestion.ts` → 旧 autoIngest。每次尝试独立运行时，逻辑 taskId 继续用于回执；恢复/重试排他仍由队列和源文件/项目锁负责。
- 保持 `pauseQueue()` 项目切换握手、队列 epoch、并发提交顺序、部分写入记账、重试/限额自动恢复与回执链路。restore 的异步边界现有版本校验，不能删掉。
- 原快照数组和存储路径不变。活动写入 best-effort、读取失败视空的旧语义没有升级为强持久化；损坏恢复和统一任务服务仍是 H03/J01。
- 最新验证：完整模拟回归 156 文件/2133 项；十模块边界、类型、正式/预览构建与受控任务 UI 浏览器交互通过。记录见 L009/L010；Rust/真实 Vault/真实模型仍未验收。

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

B06 新入口为 modules/projects 与 app/projects；项目身份原子持久化失败会抛错，不再返回临时 ID。配置方法还在 lib/project-store，后续 B14 处理。

最新全量验证：158 文件/2146 项、十二模块边界、类型与正式构建通过（L012）。来源快照组合入口 app/document-records；B07 不可在 B07b/B07c 完成前勾选。

B07b：app/document-records/source-paths 提供批次观察登记和来源移动组合，原历史回执不改写。定时复制记录外部原路径；相同来源自路径可被可靠连接器补充。元数据移动失败保留错误活动，不是跨文件事务。相关 117 项测试、类型和正式构建通过。

最新验证 L014：159 文件/2160 项、十二模块边界/类型/正式与预览构建、实际 Wiki 编辑保存浏览器冒烟通过。新仓储支持 expectedRevision，旧编辑器保持无条件兼容保存；冲突 UI、历史存储、所有生成/纠错入口迁移仍属 B08c。
