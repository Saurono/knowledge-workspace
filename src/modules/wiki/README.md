# Wiki 纯规则

domain/ 提供来源数组合并、页面类型和 Wiki 链接转换。

旧 lib 文件仅重导出公开入口；文档读写、版本、编辑器和来源追踪编排尚未迁移。

公开入口和依赖见 `module.json`。调用者只使用声明的公开入口；领域层不依赖 React、Tauri、store 或文件系统。

验证：`npm run check:modules`、`npm run typecheck`、`npm run test:mocks`。现有算法的回归测试暂保留在旧入口路径，以同时验证兼容性。
