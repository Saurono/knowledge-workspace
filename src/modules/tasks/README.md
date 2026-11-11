# 任务运行时

## 任务协议

`domain/protocol.ts` 提供纯类型与纯函数，通过 domain 和模块根入口导出；尚未接入执行器。

| 字段 | 类型 / 含义 |
| --- | --- |
| id | string，非空任务 ID |
| kind | research / ingest / lint / export / other |
| stage | queued / running / report / ingest / done / failed / cancelled |
| parentId | string 或 null，父任务 ID |
| scopeId / executorId | string，作用域 / 执行器 ID |
| createdAt / updatedAt | string，创建 / 最近迁移时间 |
| startedAt / finishedAt | string 或 null，首次开始 / 首次终结时间，只写一次 |
| progress | string，进度说明，默认空字符串 |
| log | TaskLogEntry[]，默认空数组 |
| result | TaskResult，report / ingest 默认均为 null |
| error | TaskError 或 null，默认 null |

| 当前阶段 | 允许的目标阶段 |
| --- | --- |
| queued | running、cancelled |
| running | report、ingest、done、failed、cancelled |
| report | ingest、done、failed、cancelled |
| ingest | done、failed、cancelled |
| done / failed / cancelled | 仅允许各自原地重复 |

其余迁移抛出 `Invalid task transition: <from> -> <to>`。queued → running 填 startedAt，进入终态填 finishedAt，已有值不改。所有时间由调用者传入，now 必须可解析；领域层不读取当前时钟。

结果形状：`{ report: { ref: string | null, completedAt: string } | null, ingest: { completedAt: string, accepted: number, rejected: number } | null }`。只合并传入的字段，null 表示该部分未完成；已完成的 report 不允许清空。research / ingest 进入 done 必须分别具有 report / ingest，否则抛出 `Task result is incomplete for kind ...`。research 可以停在非终态 report，已有报告而尚未入库。

错误形状：`{ code: string, message: string, retriable: boolean }`；failTask 通过相同迁移规则进入 failed 并记录错误，不实现重试。日志形状：`{ at: string, level: "info" | "warn" | "error", message: string }`；追加时间按实际时间单调不减（允许相等），倒序抛错，不改变 updatedAt。所有函数返回新对象，不修改传入任务。

报告写完不等于入库完成，`result.report` 与 `result.ingest` 分开记；H03 接持久化、H04 接取消/重试，本模块只定协议。

application/ 提供 createTaskRuntime、执行器注册、取消、作用域校验、进度与结果事件；domain/ 定义状态和取消异常。

当前是进程内执行器，已接入 Wiki 检查和入库执行器，支持外部 AbortSignal。入库队列的调度/持久化、深度研究和任务管理页面仍由旧适配器负责；不提供统一持久化调度。

公开入口和依赖见 `module.json`。调用者只使用声明的公开入口；领域层不依赖 React、Tauri、store 或文件系统。

验证：`npm run check:modules`、`npm run typecheck`、`npm run test:mocks`。现有算法的回归测试暂保留在旧入口路径，以同时验证兼容性。

`ui/` 的 TaskManagerView 是受控组件：只接收任务投影、选中项、错误、能力集合和操作回调，Obsidian/研究以插槽注入；模块不读取全局 Store。UI 单独通过 `tasks/ui` 导出，纯运行时入口不加载 React。
## 持久队列

`createTaskQueue` 注入 `TaskStoragePort`、`now` 和可选的 `newId` / `onError`，用例层不做 I/O。

| 方法 | 行为 |
| --- | --- |
| enqueue | 创建 queued 任务，先落盘再通知 |
| list / get | 查询快照；list 按 createdAt、id 升序 |
| transition / progress / recordResult / fail | 先调用领域纯函数，再落盘，再通知；非法迁移原样抛错 |
| recover | 全量加载并恢复中断任务，返回 recovered / interrupted 数量 |
| subscribe | 返回退订函数；监听异常交给 onError，不影响后续监听者 |

存储布局：`<root>/.llm-wiki/tasks/<id>.json`，每个任务一个 JSON 文件，通过应用适配器原子写入。加载时跳过坏 JSON 或缺少有效 id / stage / kind 的记录，并汇总告警，不修改记录内容。

启动时调用 `recover()`：running / report / ingest 直接恢复为 queued，清空 startedAt 和 progress，更新 updatedAt，并追加 warn 日志 `Interrupted by restart; returned to queue`，然后落盘。queued 和终态保持原样；连续恢复第二次返回零条恢复记录。

`subscribe(listener, { replay: true })` 先同步推送当前全量快照（与 list 排序一致），再接收持久化成功后的增量；默认仅增量，退订后不再接收。

H04 才接执行器与取消/重试；本层不做并发控制。

## 视图投影

`src/app/tasks/view-projection.ts` 将统一任务协议纯映射为导入任务和活动视图；UI 只消费投影。协议没有的字段不编造：`result.ingest` 只有计数，没有写出文件路径，因此 `filesWritten` 始终为空数组。

## 调度器

`createTaskScheduler` 并发上限默认 2，最小 1；同域串行，按队列提交顺序启动，不同域可并行。执行期间的进度由调用方通过队列写入，runner 端口没有进度事件。

| 方法 | 行为 |
| --- | --- |
| start / notify | 扫描 queued 并补位，返回时不等待全部执行结束 |
| running | 当前占用槽位的任务 id |
| cancel | queued 直接取消；运行中调用 runner.cancel 并等待 settle、写 cancelled 和补位；终态不动作 |
| retry | 仅 failed / cancelled 可重试，创建 queued 子任务并记录 Retry of 原 id |

重试是新任务，原任务保持终态，继承 kind / scopeId / executorId，parentId 指向原任务。成功先写 onSucceeded 返回的结果再进入 done；无结果补丁时只记成功日志。执行失败不向外抛而是进 `onError`，并记录 execution_failed、retriable: true。

H04 只做本地内存调度，不做跨进程队列、不做优先级。所有时间来自注入的 now；不使用定时轮询。

## 组合层

`src/app/tasks/task-pipeline.ts` 是“队列 + 调度器 + 落盘”的唯一组装点，返回 `queue / scheduler / start / enqueue / recover / dispose`。`execute(task, signal?)` 是调用方注入的实际工作函数，返回可选的 report / ingest 结果补丁；模块层不认识入库/研究的具体工作。异常原样交给调度器，取消通过 AbortSignal 传给工作函数。

调用方必须注入 `now`（缺少时创建失败）；组合层不读取全局时钟。启动前 enqueue 只落盘，`start()` 先恢复再启动调度，返回恢复计数；启动后 enqueue 和重试子任务会唤醒调度。`dispose()` 取消所有正在执行的 runner，工作函数负责响应 signal 并结束。

重启恢复遵循 H03（见上方“持久队列”）：running / report / ingest 恢复为 queued，清空 startedAt 和 progress 并追加中断日志，queued 和终态保持原样；再次恢复返回零。`recover()` 透传队列恢复操作，应在调度启动前或停止执行后调用。
