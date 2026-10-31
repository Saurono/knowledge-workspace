# 知识领域

domain/ 定义扁平标签与资源多选关联；application/ 提供 list/add/toggle/remove 与 DomainRepository；ui/ 提供受控 DomainTagEditor。

跨模块的领域删除由 src/app/workspace 原子协调，清理资源和记忆引用。

公开入口和依赖见 `module.json`。调用者只使用声明的公开入口；领域层不依赖 React、Tauri、store 或文件系统。

验证：`npm run check:modules`、`npm run typecheck`、`npm run test:mocks`。现有算法的回归测试暂保留在旧入口路径，以同时验证兼容性。
