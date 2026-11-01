# D01 固定试运行任务书

基线：f4c9bb2。两组使用相同任务书、相同基线、独立上下文和目录。产品组 Luna，隔离对照组继承主控模型；对照代码不进入产品。主控负责独立审查和验收，生成者不得提交 Git。

## 任务与边界

实现 D01：定义接收、解析、知识编译、索引、回传五阶段及可恢复检查点，避免部分成功被报告为全成功。只交付状态协议、纯规则、仓储端口、共享文档持久化适配、上传初始记录和受保护只读查询。不实现真实解析/模型/索引/Vault 执行器、调度器、去重、来源修订或来源时间全入口迁移（D02/D04/D05/D06/H/I）。不改旧桌面队列 done 含义、不伪造外部执行成功、不改账号授权或数据库 schema。

## 固定公开契约

在 ingestion/domain 新建 checkpoint.ts，从 domain/index.ts 公开；在 ingestion/application 新建 lifecycle.ts 并公开。命名可增加辅助类型，下面名字与参数需保留，供独立验收使用。

- IngestionStage：receive / parse / compile / index / feedback。
- StageStatus：pending / running / succeeded / failed / blocked / cancelled / skipped。
- IngestionCheckpointV1：schemaVersion:1、projectId、documentId、createdAt、updatedAt、policy:{index:'required'|'disabled',feedback:'required'|'disabled'}、stages（以五个阶段为键）。
- 每阶段记录 status、attempt（非负整数）、attemptId:string|null、startedAt:string|null、finishedAt:string|null、evidence:string[]、error:{code:string,message:string}|null。
- createReceivedCheckpoint({projectId,documentId,receivedAt,artifactRef,indexPolicy?,feedbackPolicy?})：receive 确认成功；parse/compile 待处理；index 默认 required，feedback 默认 disabled。只有明确 disabled 的可选阶段可为 skipped。artifactRef 非空。sourceIngestedAt 在上传后仍为 null。
- beginStage(checkpoint,stage,{attemptId,now})：只允许 pending 且所有前序阶段 succeeded/skipped 的阶段开始，增加 attempt，捕获 attemptId 和 startedAt；receive 已成功不能重跑。
- finishStage(checkpoint,stage,{attempt,attemptId,now,outcome,evidence?,error?})：outcome 为 succeeded/failed/blocked/cancelled，必须匹配当前 running 的 attempt 与 attemptId。成功必须有非空 evidence；失败/阻塞/取消要有结构化 error。拒绝晚到的旧尝试结果。
- retryStage(checkpoint,stage,now)：仅 failed/blocked/cancelled 可重回 pending，不重跑已成功的上游阶段；disabled 阶段不可重试。
- recoverInterrupted(checkpoint,now)：将遗留 running 转为 blocked，error.code='interrupted'；绝不把中断当成功，旧结果不能提交；没有 running 时保持无变化。
- validateCheckpoint(unknown)：运行时校验版本、标识、policy、完整阶段集、状态/时间/计数/证据/错误的自洽性和阶段依赖；损坏数据报错，不重置或推断 ready。标识遵循项目 UUID/ID 的既有格式；时间为有效 ISO 日期，操作不得早于已有时间。
- summarizeIngestion(checkpoint)：返回 {status,contentReady,knowledgeReady,feedbackDelivered,complete}。status 为 received/processing/waiting/failed/cancelled/partial/ready。contentReady 仅 compile 已成功且证据有效；knowledgeReady 还要求 index 成功或显式 disabled/skipped；feedbackDelivered 仅真正 feedback 成功，disabled 不是 delivered。complete 还要求 required feedback 成功；故 index 或 feedback 失败、阻塞/未知不能误报 ready。内容已落盘但后续未完成时报告 partial；running 为 processing；初始为 received。上述布尔结论优先于文案状态。

所有纯函数不得修改输入（含嵌套数组），不得调用全局时钟/随机数或做 I/O；时间与尝试标识由调用者注入。checkpoint 中只存证据引用和可行动错误，不放口令/Token/文档正文。

## 用例与持久化

createIngestionLifecycleService(repository)，仓储端口提供 read(projectId,documentId) -> {revision,checkpoint}|null 和 save(projectId,documentId,expectedRevision,checkpoint) -> 同类型。服务提供 read/begin/finish/retry/recover，可自行选择这些服务方法的具体参数封装，但须显式预期 revision，不偷偷重读后覆盖。先校验项目/文档归属再变更；失败保留旧持久状态。恢复无变化时不新增版本。

server/ingestion-checkpoints.ts 提供 createDocumentCheckpointRepository(sharedRepository)，使用既有 document 资源存储 JSON checkpoint 和条件版本；保存时保留上传元数据/未知字段，拒绝跨项目/跨文档快照。沿用资源+事件同事务及冲突语义，不新增 SQLite 表。仓储接收受保护端口时不能绕过授权。无 checkpoint 的旧 received 文档，只有可靠的旧接收元数据才能构造保守初始状态；不根据旧 done 或时间戳推断解析/编译/索引成功，不覆盖损坏的已有 checkpoint。

service-api/application/uploads.ts 的 ReceivedDocument 增加向后兼容的 ingestion checkpoint 字段，真实上传在二进制写入后与 document 元数据一起保存 receive 已成功的初始快照。其他四阶段不能因收到文件自动成功。索引未知时默认 required，不视为已禁用。回传只有明确未配置时 disabled。

增加 GET /api/v1/projects/:id/documents/:documentId/ingestion：走已有人员/Agent 身份和 documents.read，返回 data:{revision,checkpoint,summary}，ETag 对应 document 资源版本。只有查询，没有让普通客户端自行标记成功的变更 HTTP 接口。SDK 增加 documentIngestion(projectId,documentId)。浏览器业务页不另加任务进度列表（统一任务页后续 H 系列实现）。

## 必须提交的证据

1. 单元测试：初始接收不 ready；逐阶段合法完成；disabled 索引/回传；编译空证据拒绝；索引失败 partial；回传失败不抹去 knowledgeReady；各自重试不重跑编译；取消后晚到结果拒绝；恢复 running 后必须新 attempt；输入不可变；损坏/跳阶段/非法时间拒绝。
2. 真实临时 SQLite / HTTP：上传初始快照与只读查询；会话/只读 Token/跨项目授权；条件竞争仅一次成功；关闭重开后 checkpoint 持久且可恢复；损坏已有快照不重置；旧 received 文档保守兼容。
3. 文档：analysis/architecture/ingestion-checkpoints.md（规则/完成边界/恢复与兼容/后续范围）。更新 ingestion README、service-api 相关说明和模块依赖/公开入口，运行 audit:modules。
4. 作者自行运行 typecheck、check:modules、定向测试，修复实际错误；给主控报告改动、测试日志路径、限制与耗时。不修改 TASKS/HANDOFF/WORKLOG，不提交/推送。

## 允许修改

src/modules/ingestion/domain/checkpoint*、application/lifecycle*、两层 index.ts、ingestion README；service-api/application/uploads.ts、client.ts、必要公开类型/依赖、相关新测试与 README；server/ingestion-checkpoints*、http.ts 该 GET 路由、必要测试；上述架构文档、module-audit-v1.json。不得修改其他业务、身份权限模型、原生 Rust、既有队列行为或依赖版本。不读取另一组实现。
