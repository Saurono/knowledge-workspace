# Wiki

公开入口和依赖见 `module.json`。模块通过端口接收存储、修订和解析能力，不依赖 React Store、Tauri 或文件系统。

- `domain/`：来源数组、页面类型、链接规则、页面修订及路径校验。Markdown 页面和通用 Wiki 存储分别校验，保留非 Markdown 入库输出。
- `application/pages`：页面仓储、条件保存与变换；`expectedRevision=null` 表示仅创建。纠错在锁内读取最新正文再变换；无变化不写入。
- `application/merge`：接收解析/链接规范化端口，模型与备份按调用注入；保护来源/标签并集、旧元数据、正文链接、代码及嵌入。
- `application/commit`：有生命周期的项目提交上下文。回调结束即关闭，等待已启动的 I/O 完成后释放仓储锁；不能将上下文保存供未来使用。失败保留已完成写入，不提供跨文件回滚。
- `application/generated-pages`：锁内分配未占用的 Markdown 文件名并发布正文/目录/日志；读取已有导航失败会报错，避免用空导航覆盖。
- `ui/file-history-view`：基于 documents 历史模型的受控面板，平台查询/恢复和请求世代由应用容器处理。

`app/wiki` 装配原生仓储、合并、历史和提交锁。生成提交适配保留原生 writer/history 行为；`withWikiProjectCommit` 为旧绝对路径 helper 提供上下文，不重复加锁。入库、对话/审阅、研究、去重和链接增强已接入。sidecar 与备份继续由各自适配写入。审阅保持稳定文件名优先，对话同秒保存不会互相覆盖。

B08c4 尚待元数据归属、版本统一和编辑器冲突 UI/平台解耦。词法路径规则不替代授权或 symlink 检查，当前锁不提供跨进程排他；原生历史格式保留，生产 Web 后端仍未实现。

验证：`npm run check:modules`、`npm run typecheck`、`npm run test:mocks`。并发测试覆盖旧编辑器共享锁、部分写入、上下文关闭、迟到 I/O、文件名碰撞、过期模型快照及保留最新正文/目录。
