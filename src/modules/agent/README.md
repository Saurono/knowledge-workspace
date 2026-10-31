# Agent

共享执行引擎继续使用 `src-tauri/src/agent`（路由、上下文、会话、取消与工具注册），不在 TypeScript 重建另一套工具/提示词引擎。

- `domain`：会话/消息/引用/工具事件/产出模型、后端事件投影、恢复上下文、有限 diff、持久化脱敏（移除图片与回滚全文快照）。
- `application/runtime`：通过运行时端口注册事件、启动/取消、查询技能和非流式回合；流式按 sessionId/runId 隔离，监听先于启动，空闲超时/AbortSignal 均清理监听并取消后端。原生 start 尚未返回时也可终止前端等待。
- `application/outputs`：经读取端口顺序收集文件产出；已知前后快照保留运行时撤销能力，Shell/未知前态只展示记录，不能伪造“新建文件”并删除用户内容。
- `app/agent/runtime`：唯一原生 Agent 命令/事件组合；ChatPanel 只消费运行时和呈现消息。CLI 进程适配由 cli 模块处理。

旧 chat-agent-types、agent-file-activity 保留重导出；聊天历史格式不变，运行时回滚快照仍不落盘。此模块不新增用户授权，也不改变 Rust 的工具策略；本环境无 cargo，原生执行及外部真实模型未验收。

端口测试覆盖监听/启动顺序、跨运行事件、取消注册竞态、原生启动悬挂、超时清理及未知文件快照。执行 `npm run check:modules`、`npm run typecheck` 和 `npm run test:mocks`。
