# 任务运行时

application/ 提供 createTaskRuntime、执行器注册、取消、作用域校验、进度与结果事件；domain/ 定义状态和取消异常。

当前是进程内执行器，已接入 Wiki 检查。导入队列、深度研究和任务管理页面仍由旧适配器运行；不提供持久化调度。

公开入口和依赖见 `module.json`。调用者只使用声明的公开入口；领域层不依赖 React、Tauri、store 或文件系统。

验证：`npm run check:modules`、`npm run typecheck`、`npm run test:mocks`。现有算法的回归测试暂保留在旧入口路径，以同时验证兼容性。
