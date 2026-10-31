# 新会话交接

> 当前状态：已按用户最新要求暂停。当前 B08c2 已完成；下一项 B08c3 尚未开始，需等待用户恢复工作指令。

## 先读与工作约定

1. 读本文件、[TASKS](TASKS.md)、[WORKLOG](WORKLOG.md)、[ARCHITECTURE](ARCHITECTURE.md)。检查实际 Git 分支、状态和日志，不假设旧后台进程存在。
2. TASKS 是状态入口。完成一项就勾选、追加 WORKLOG（实现/验证/限制）、更新本交接点并提交；不能只更新复选框。
3. 用户此前要求每项完成后自动继续，但**最新指令是完成当前任务后暂停**，因此现在不得自动开始新任务。用户明确恢复后，再按其新指令推进。
4. 保持小批次可回归迁移，业务放模块，通过公开 API 和端口组合。旧调用者迁完才删兼容入口；新模块不得依赖旧 Store/Tauri/文件系统。
5. 后续仓库默认公开，推送到用户 origin；不加入真实笔记、凭据或机密。当前工作目录 `/workspace/llm_wiki`，新环境路径变化时重新定位。

## 仓库与确定选择

- 工作仓库：https://github.com/Saurono/knowledge-workspace ，公开；origin 指向它，upstream 指向 nashsu/llm_wiki。
- 开发分支：`codex/knowledge-workspace-v0.1`；后续迁移已推此分支，main 仍为之前基线，未自动合并。
- 上游 v0.6.13 / `e08cfce`；首批迁移 `d8eeb78`；仓库接入 `da3e522`。最新提交以 Git 日志为准。
- GPL-3.0，保留原版权与星图 MIT 声明。
- 桌面/Web 两端；user/agent/admin，Agent 用 API Token；工作角色与已授权有效权限身份一起切换。
- 记忆按项目/角色共享，私有明确授权；用户最终专门记忆分类方案尚待补充。
- 扁平多选领域；Obsidian 只生成独立 JSON 回执，不改原笔记。
- Wiki 来源为用户/Agent/系统生成/混合；Agent 问题、解决方案、产出手册和方法回流；本机 CLI 和外部 API/MCP 都在范围内。

## 实现边界与完成点

现有十二个模块：star-map、memory、domains、tasks、quality、wiki、ingestion、retrieval、cli、research、projects、documents。部分模块仅迁出核心规则，不能将目录存在当作完整能力已交付。

- B01–B03：任务外部取消、入库执行器、独立队列服务/恢复/快照端口。有序提交、epoch、部分写入、暂停/重试保留。队列活动快照仍 best-effort、读取失败视空，未升级为统一强持久化任务服务。
- B04/B05：research 模型/正文引用校验/执行器；tasks/ui 与 research/ui 受控页面。app/research 注入搜索/模型/文件。新研究任务绑定项目，项目切换取消旧执行；部分搜索 I/O 本身还不能取消，但迟到结果丢弃。
- B06：projects 模型、身份/注册表/最近项目仓储。身份持锁原子写入成功才返回；注册表/偏好更新串行。配置方法仍在 lib/project-store，待 B14。
- B07a/B07b：documents 来源规则/目录/修订查询，app/document-records 保持旧聚合格式；本地监听/定时导入登记原路径，来源移动协调目录和 Wiki 引用/摘要时间，历史回执不改。跨文件失败恢复不是事务。B07c 新 API/MCP 统一入口依赖 C02/I02；B07 总项未完成。
- B08a/B08b：Wiki 页面仓储、修订冲突接口与编辑预览接入；合并服务和正文链接规则迁出，解析/模型/备份由端口注入。旧编辑器仍用无条件保存，冲突提示和完整历史统一待后续。
- B08c1：单条/批量纠错在项目锁内变换最新内容，跳过无变化写入；并发补建页只创建一次。
- **B08c2（本次收尾）**：documents 文件历史模型和服务、app/wiki 历史查询/恢复适配、wiki/ui 受控展示；Wiki Markdown 也有历史入口。查询/恢复晚到结果按文件/项目世代丢弃，恢复使用项目提交锁；原生历史库格式与命令保留。Rust 原生运行未验收。

现有本地数据格式仍兼容：workspace.json v1、ingest-records.json v1、队列数组、project.json 及 app-state.json 原 key。未实现生产账号/授权、共享记忆后端、生产 Web 服务；模拟预览不能证明这些能力存在。

## 恢复后的下一步（当前暂停）

下一项 B08c3：迁移生成/入库写入，必须显式传递提交上下文，避免已有项目锁内再次加锁造成死锁。

只读梳理结果，尚无该项代码修改：

- `lib/ingest.ts` autoIngestImpl 的 runCommit 已包项目锁（两处回调）；executeIngestWrites 也包项目锁。
- Wiki 写入分布在 writeFileBlocks、更新 index/overview、旧摘要迁移、图片注入和 executeIngestWritesImpl。应通过一个有生命周期的提交 writer 复用原锁，再逐个传参。
- ingest-warnings.log、generation checkpoint、解析缓存和备份是 sidecar，不应误作为 Wiki 页面迁移。
- 旧 isSafeIngestPath 允许 wiki/ 下非 Markdown 文件；提交作用域须区分通用 Wiki 存储路径与 Markdown 页面接口，避免无故改变旧行为。
- 再处理 B08c4 元数据归属/版本历史统一/编辑器冲突 UI；B08/B08c 均保持未完成。其后按清单推进 B09 等。

## 验证与启动

```bash
npm ci
npm run check:modules
npm run typecheck
npm run test:mocks
npm run build
npm run build:preview
```

最新完整模拟回归：160 文件 / 2168 项通过。十二模块边界、类型、正式/预览构建通过。历史相关契约/文件接口 33 项通过；Chromium 验证历史入口、选择/恢复、预览更新与项目 ABA 切换丢弃迟到结果，页面异常为 0。

- 真实模型、真实 Vault、原生 Rust/watcher/桌面安装包尚未验收；本环境此前没有 cargo，新环境重新检查。
- `npm run dev` 是前端；桌面需 `npm run tauri dev` 与 Rust/Tauri 依赖。
- 显式沙箱入口 preview.html / src/preview，构建为 dist-preview/preview.html，使用模拟文件系统和合成数据。
- 可复现浏览器脚本在 analysis/implementation：smoke-task-ui.mjs、smoke-wiki-repository.mjs、smoke-file-history.mjs；需要 PLAYWRIGHT_MODULE、CHROMIUM_PATH 与 Vite。禁止将夹具脚本指向真实知识库。
- `/tmp` 工具、端口与 `/workspace/artifacts` 预览是环境临时产物，不保证新会话存在。新增测试避免放进被忽略的 tests/ 目录。
