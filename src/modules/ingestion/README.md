# 文档入库

- `domain/`：文本清洗、队列任务模型和 v1 JSON 数组编码/解码。
- `application/execute-ingest.ts`：编译端口与执行器，执行前后检查取消、拒绝空输出并保留原错误。
- `application/queue.ts`：`createIngestQueue(ports)`，每个实例独立拥有调度、恢复、并发、暂停/取消、重试、订阅与持久化写入串行状态。
- `application/queue-ports.ts`：快照仓储、项目路径、模型、执行器、懒加载清理/审阅、时钟和调度接口。
- `application/commit-coordinator.ts`：按任务启动顺序分配提交回合，准备阶段仍可并行。
- `domain/checkpoint.ts`：五阶段检查点纯协议、运行时验证、恢复和结论汇总。
- `application/lifecycle.ts`：带显式资源 revision 的检查点读写服务；并发冲突交由仓储拒绝。

公开入口和依赖见 `module.json`。领域层无业务/平台依赖；应用层只依赖 tasks 的公开契约，不读取旧 store、Tauri 或文件系统。

## 应用装配与兼容

`src/app/ingestion/queue.ts` 装配桌面队列，注入当前项目注册表、模型配置、路径规则、执行器与懒加载能力。`queue-repository.ts` 适配原 `.llm-wiki/ingest-queue.json`。Web/测试可创建自己的服务实例与适配器，但生产 Web 后端尚未实现。

`src/app/tasks/ingestion.ts` 为每次编译尝试创建独立运行时，注入旧 autoIngest 的解析、模型、原子写入与回执；逻辑 taskId 保留用于来源/回执，不与尚未退出的旧尝试共享运行槽。队列/源文件/项目锁继续保证排他性。

B08c3：`lib/ingest.ts` 在队列提交回合内通过 `app/wiki/commit` 获取一次项目提交锁，将 `ProjectWikiCommit` 显式传入正文、目录/概览/日志、旧摘要迁移和图片注入等 helper。helper 不重复加锁，补充生成也使用同一作用域。wiki/ 下非 Markdown 输出保持兼容；警告、解析缓存、检查点和备份仍用原 sidecar 适配。上下文关闭后不能继续写，已启动 I/O 完成才释放锁；失败不回滚已完成的文件写入。

旧 `lib/ingest-queue.ts` 和 `lib/ingest-commit-coordinator.ts` 仅重导出兼容入口。现有调用者和原回归测试不需要更换导入路径。

## 状态与数据规则

- D01 的接收、解析、编译、索引、回传检查点使用独立协议；上传只记录真实接收证据，解析/编译/索引/回传需要各自可信执行器提供证据后才可成功。
- 恢复会把遗留 running 标为 blocked/interrupted，重试保留阶段历史 attempt 计数并分配新 attemptId；旧结果不能提交。
- disabled 的索引和回传记为 skipped；只有编译成功才表示内容可用，只有索引成功或明确 disabled 才表示知识可检索。回传关闭不算回传成功。

- 恢复中每个异步边界检查 restore epoch；旧项目或同项目旧恢复结果不能覆盖新队列。
- 活动队列在入列时捕获不可变 JSON 快照，按原先顺序串行写；后台非活动项目写入也保持串行和错误恢复。
- v1 快照仍是普通任务数组，兼容缺失的 projectId，保留未知字段。恢复时剔除显式不匹配项目的任务。
- 切换项目应先等待 `pauseQueue()`；它等待已进入提交区的写入，并持久化可恢复状态。`clearQueueState()` 仅清内存，主要供测试使用。
- 取消不撤销已完成的原子写入；写入回调仍用于记账，不能删除已合并到原页面的内容。
- 普通活动快照保留旧 best-effort 语义；D02 的编译幂等绑定必须持久化成功才能继续。缺失快照可视为空，损坏快照和非法身份绑定拒绝恢复并阻止覆盖，需修复后重新恢复。本模块仍不提供 H03/J01 的完整强持久任务服务和损坏数据自动修复。
- 此层不提供跨进程调度或统一任务历史。无 taskId 的旧 autoIngest 入口和部分解析/编译 I/O 仍作为兼容应用适配存在；Obsidian 规则/投递已在 B13 归独立模块，入库层只组合现有回执流程。

## 验证

运行模块边界、类型、队列/执行器契约测试、旧队列单元与真实 FS 集成、提交顺序测试。独立队列测试只注入内存仓储与可控时钟，不模拟 Tauri，也不加载应用 Store。

D02 的 `ingestionIdempotencyKey` 将项目 ID、稳定来源 ID、实际编译输入的 SHA-256 修订和 `compile` 操作编码为规范任务键。路径、随机任务 ID 和 attempt 不参与。队列在准备完成后接收可信绑定，已有 v1 数组可不包含这些可选字段；不允许部分字段或不匹配的键。实际编译输入和成功回执在应用适配层组合，成功输出缺失可修复，原始来源变化或持久化失败不报告完成。跨进程调度与跨文件事务仍未实现。
