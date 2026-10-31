# 文档入库

- `domain/`：纯文本清洗规则。
- `application/`：`createIngestExecutor`、`IngestCompiler` 端口和输入/提交回调契约；执行前后检查取消，拒绝空输出，保留编译器错误供队列判断重试。
- 公开入口与依赖见 `module.json`。应用层依赖 tasks 的公开契约；领域层无业务或平台依赖。

`src/app/tasks/ingestion.ts` 注入现有 autoIngest（解析、模型、写入与回执）。`src/lib/ingest-queue.ts` 通过注册执行器运行任务，继续负责 epoch、并发、暂停/重试、持久化、提交顺序和部分写入保护。

每次入库尝试有独立的进程内运行时；恢复后的逻辑任务 ID 可继续用于回执，不与尚未退出的旧尝试共享执行槽。跨尝试排他性仍由现有队列和源文件/项目锁保证；此层不替代持久队列或统一任务服务。

取消不会撤销已经完成的原子写入，写入回调仍用于记账；不能删除已合并到原有页面的内容。无 taskId 的旧 autoIngest 调用暂未迁移。解析/队列/编译的全部 I/O、Obsidian 回执仍待进一步拆分。

验证：`npm run check:modules`、`npm run typecheck`，执行器/应用适配契约测试及原入库队列单元/集成测试。旧 `lib/ingest-sanitize.ts` 继续重导出规则以验证兼容。
