# CLI 协议

domain/ 提供 Claude 流式协议解析、结构化错误、诊断缓冲和 Codex 行协议解析。

进程启动、Tauri 事件、会话与取消仍由旧 transport 适配器负责；旧路径重导出协议函数。

公开入口和依赖见 `module.json`。调用者只使用声明的公开入口；领域层不依赖 React、Tauri、store 或文件系统。

验证：`npm run check:modules`、`npm run typecheck`、`npm run test:mocks`。现有算法的回归测试暂保留在旧入口路径，以同时验证兼容性。
