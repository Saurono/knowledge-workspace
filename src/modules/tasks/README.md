# 任务运行时

application/ 提供 createTaskRuntime、执行器注册、取消、作用域校验、进度与结果事件；domain/ 定义状态和取消异常。

当前是进程内执行器，已接入 Wiki 检查和入库执行器，支持外部 AbortSignal。入库队列的调度/持久化、深度研究和任务管理页面仍由旧适配器负责；不提供统一持久化调度。

公开入口和依赖见 `module.json`。调用者只使用声明的公开入口；领域层不依赖 React、Tauri、store 或文件系统。

验证：`npm run check:modules`、`npm run typecheck`、`npm run test:mocks`。现有算法的回归测试暂保留在旧入口路径，以同时验证兼容性。

`ui/` 的 TaskManagerView 是受控组件：只接收任务投影、选中项、错误、能力集合和操作回调，Obsidian/研究以插槽注入；模块不读取全局 Store。UI 单独通过 `tasks/ui` 导出，纯运行时入口不加载 React。
