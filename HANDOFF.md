# 新会话交接

> 当前状态：用户已恢复 B 系列，B14 已完成，继续 B15–B16。

## 先读与工作约定

1. 读本文件、[TASKS](TASKS.md)、[WORKLOG](WORKLOG.md)、[ARCHITECTURE](ARCHITECTURE.md)。检查实际 Git 分支、状态和日志，不假设旧后台进程存在。
2. TASKS 是状态入口。完成一项就勾选、追加 WORKLOG（实现/验证/限制）、更新本交接点并提交；不能只更新复选框。
3. 用户最新指令是**继续运行 B 系列**；完成一项记录和提交后继续下一项，B07c 的共享 API/MCP 依赖仍未实现。
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

现有十五个模块：star-map、memory、domains、tasks、quality、wiki、ingestion、retrieval、cli、research、projects、documents、agent、obsidian、settings。部分模块仅迁出核心规则，不能将目录存在当作完整能力已交付。

- B01–B03：任务外部取消、入库执行器、独立队列服务/恢复/快照端口。有序提交、epoch、部分写入、暂停/重试保留。队列活动快照仍 best-effort、读取失败视空，未升级为统一强持久化任务服务。
- B04/B05：research 模型/正文引用校验/执行器；tasks/ui 与 research/ui 受控页面。app/research 注入搜索/模型/文件。新研究任务绑定项目，项目切换取消旧执行；部分搜索 I/O 本身还不能取消，但迟到结果丢弃。
- B06：projects 模型、身份/注册表/最近项目仓储。身份持锁原子写入成功才返回；注册表/偏好更新串行。配置方法仍在 lib/project-store，待 B14。
- B07a/B07b：documents 来源规则/目录/修订查询，app/document-records 保持旧聚合格式；本地监听/定时导入登记原路径，来源移动协调目录和 Wiki 引用/摘要时间，历史回执不改。跨文件失败恢复不是事务。B07c 新 API/MCP 统一入口依赖 C02/I02；B07 总项未完成。
- B08a/B08b：Wiki 页面仓储、修订冲突接口与编辑预览接入；合并服务和正文链接规则迁出，解析/模型/备份由端口注入。编辑器在 B08c4 接入条件保存/冲突提示，版本仍沿用原生历史库。
- B08c1：单条/批量纠错在项目锁内变换最新内容，跳过无变化写入；并发补建页只创建一次。
- **B08c2**：documents 文件历史模型和服务、app/wiki 历史查询/恢复适配、wiki/ui 受控展示；Wiki Markdown 也有历史入口。查询/恢复晚到结果按文件/项目世代丢弃，恢复使用项目提交锁；原生历史库格式与命令保留。Rust 原生运行未验收。

现有本地数据格式仍兼容：workspace.json v1、ingest-records.json v1、队列数组、project.json 及 app-state.json 原 key。未实现生产账号/授权、共享记忆后端、生产 Web 服务；模拟预览不能证明这些能力存在。

## 下一步

B08c3 已完成：Wiki application 提供有生命周期的提交上下文，app/wiki 装配共享项目锁和原生读写；上下文在回调结束后关闭，并等待已启动的 I/O 结束才释放锁。入库显式传入该上下文，复用队列提交回合，不再在内部重复获取项目锁。

- 覆盖入库正文/目录/概览/日志/旧摘要迁移/图片注入、补充生成、对话与审阅发布、研究落盘、去重合并及链接增强。
- 页面服务仍只接收 Markdown；提交存储接口保留 wiki/ 下非 Markdown 输出兼容。缓存、检查点、警告和备份 sidecar 保持原路径/写入语义。
- 对话/审阅共用发布服务，锁内分配文件名并更新最新目录/日志，保留审阅稳定名优先。读取已有目录失败不会伪造空目录覆盖。
- 去重提交前验证模型输入快照，正文变动则要求重试；目录独立处理并保留模型准备期间新增条目。链接增强基于最新正文应用结果。
- 这不是跨文件回滚事务；失败保留已完成写入。保留原生写入与历史格式，不代表身份授权、跨进程锁或生产 Web 后端完成。

B08c4 已完成：Wiki 领域拥有页面创建时间/来源关联及移动规则，现有 ingest-records v1 文件仍由应用层聚合。Wiki 页面、生成写入和历史共用桌面存储适配，保留原生 before/after 历史记录和格式。编辑会话串行条件保存，冲突后阻止队列/后续自动覆盖；界面保留草稿、提供复制和显式放弃后重载，读取/保存失败显示错误。预览读写编排迁入 app/wiki hook，编辑组件不直接导入文件命令；原文选择编辑与历史恢复后重新加载基线。

B08/B08c 的现有本地链路迁移完成；生产 Web 存储/权限和跨进程排他仍在后续任务。本地 native writer 仍按上游记录 human，真实身份归因待账号/Agent 链路，不把它称为安全审计。B07c 仍依赖 C02/I02。

B09 已完成：retrieval/domain 拥有分块/分词、向量配置/页面 ID、分块聚合；application 提供独立 embedding 服务、模型/索引/来源端口及搜索/证据服务。app/retrieval 装配原生模型/向量/搜索和 frontmatter 标题解析，旧 lib 入口重导出。排序继续使用原 Rust 共享后端，不在前端复制；LanceDB 文件/命令参数不变。证据默认 5 条、每页 2000/合计 8000 字符，空内容不占引用编号；选区问答接入。本地搜索不传模型配置，查询/项目切换/卸载取消旧请求并丢弃迟到结果。底层 I/O 不保证物理中断。

B10 已完成：agent/domain 拥有会话/事件/产出与持久化规则；application 注入后端运行时和文件读取端口，负责流式生命周期、取消、超时及产出顺序。ChatPanel 不直接调用原生 Agent 命令/事件。共享执行/工具策略仍在已有 Rust agent 模块，未在前端复制引擎。未知文件前态不能撤销。

B11 已完成：quality 拥有语义/结构检查与审阅清理服务、纠错/审阅规则、占位页与批量修复用例。app/quality 注入文件/模型/worker/活动和项目世代；同页纠错合并一次提交，部分失败保留已完成结果。检查/审阅组件不直接调用文件命令，审阅删除使用项目锁和路径校验。

B12 已完成：cli/application 拥有 Claude/Codex 进程/事件/会话 transport 和能力查询端口；app/cli 注入 Tauri 与调用时 CWD，lib 兼容。设置页不直接 invoke 检测命令。保留协议/超时/隔离与取消启动竞态再次 kill；新增调用目录绑定与完成后迟到 token 契约。

B13 已完成：obsidian 拥有回执模型/生成/Vault 归属和连接/投递服务；app/obsidian 复用 ingest-records 聚合锁与文件适配。来源和 Wiki 元数据仍各归其模块，app/document-records 组合。只写独立 JSON 回执，源笔记不改；失败 pending、稳定文件重试和重连校验保留。相关 3 文件/17 项通过；十四模块边界/类型/正式构建通过，无真实 Vault 验收。

B14 已完成：settings 拥有配置类型、预设/路由/推理/Azure 策略、键值仓储与平台能力服务，app/settings 注入 Tauri/路径/监听/缩放适配；Store/旧入口重导出兼容。保持 app-state.json 键和模型覆盖串行更新，凭据存储未改变。关于页区分模拟/桌面/Web，能力状态不代表授权或实际 CLI/Vault 健康。设置相关 7 文件/40 项、十五模块边界/类型/正式构建通过。

下一项 B15：清理旧 Store 的业务规则，迁移 Wiki/记忆星图查询并审计兼容入口，然后 B16 全树依赖审计。

## 验证与启动

```bash
npm ci
npm run check:modules
npm run typecheck
npm run test:mocks
npm run build
npm run build:preview
```

最新完整模拟回归：172 文件 / 2220 项通过。十三模块边界、类型、正式/预览构建通过。新增提交/发布、条件编辑、元数据和检索端口测试通过。Chromium 验证正常保存/冲突保留草稿/显式重载、本地搜索/迟到结果丢弃/证据引用；最新检索脚本页面异常及外部请求均为 0，先前历史/项目 ABA、对话/审阅发布验证记录保留。

- 真实模型、真实 Vault、原生 Rust/watcher/桌面安装包尚未验收；本环境此前没有 cargo，新环境重新检查。
- `npm run dev` 是前端；桌面需 `npm run tauri dev` 与 Rust/Tauri 依赖。
- 显式沙箱入口 preview.html / src/preview，构建为 dist-preview/preview.html，使用模拟文件系统和合成数据。
- 可复现浏览器脚本在 analysis/implementation：smoke-task-ui.mjs、smoke-wiki-repository.mjs、smoke-file-history.mjs、smoke-generated-pages.mjs、smoke-wiki-conflict.mjs、smoke-retrieval.mjs；需要 PLAYWRIGHT_MODULE、CHROMIUM_PATH 与 Vite。禁止将夹具脚本指向真实知识库。
- `/tmp` 工具、端口与 `/workspace/artifacts` 预览是环境临时产物，不保证新会话存在。新增测试避免放进被忽略的 tests/ 目录。
