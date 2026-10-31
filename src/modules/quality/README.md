# Wiki 检查

domain/ 提供结构检查、配置规范化、检查结果类型；application/ 提供 Wiki 检查执行器和平台/模型端口。

src/app/tasks/maintenance.ts 注入文件、模型和活动记录适配。语义检查的现有 I/O 实现保留在旧 lib/lint.ts。

公开入口和依赖见 `module.json`。调用者只使用声明的公开入口；领域层不依赖 React、Tauri、store 或文件系统。

验证：`npm run check:modules`、`npm run typecheck`、`npm run test:mocks`。现有算法的回归测试暂保留在旧入口路径，以同时验证兼容性。
