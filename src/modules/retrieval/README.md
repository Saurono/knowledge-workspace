# 检索纯规则

domain/ 提供 Markdown 分块算法。

旧 lib/text-chunker.ts 保留兼容导出。索引、搜索和模型查询仍在旧代码中。

公开入口和依赖见 `module.json`。调用者只使用声明的公开入口；领域层不依赖 React、Tauri、store 或文件系统。

验证：`npm run check:modules`、`npm run typecheck`、`npm run test:mocks`。现有算法的回归测试暂保留在旧入口路径，以同时验证兼容性。
