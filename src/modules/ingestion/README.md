# 文档入库纯规则

domain/ 提供入库文本清洗规则。

旧 lib/ingest-sanitize.ts 保留兼容导出。解析、队列、模型编译和 Obsidian 回执尚未整体迁移。

公开入口和依赖见 `module.json`。调用者只使用声明的公开入口；领域层不依赖 React、Tauri、store 或文件系统。

验证：`npm run check:modules`、`npm run typecheck`、`npm run test:mocks`。现有算法的回归测试暂保留在旧入口路径，以同时验证兼容性。
