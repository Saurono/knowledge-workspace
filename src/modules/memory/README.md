# 记忆库

domain/ 定义记忆记录、校验、引用清理；application/ 提供 list/save/remove 与 MemoryRepository 端口；ui/ 提供受控 MemoryLibrary。

本地仓储由 src/app/workspace 注入。模块不读取全局 store、不识别 workspace.json，不包含尚未实现的共享权限服务。

公开入口和依赖见 `module.json`。调用者只使用声明的公开入口；领域层不依赖 React、Tauri、store 或文件系统。

验证：`npm run check:modules`、`npm run typecheck`、`npm run test:mocks`。现有算法的回归测试暂保留在旧入口路径，以同时验证兼容性。
