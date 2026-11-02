# 知识领域

domain/ 定义扁平标签与资源多选关联；application/ 提供 list/add/toggle/remove 与 DomainRepository；ui/ 提供受控 DomainTagEditor。

D03a 增加规范资源引用、effectiveDomainIds 和统一 ANY/ALL/未分类筛选规则。稳定来源逻辑键为 raw/documents/sourceId，Wiki 使用 wiki 相对路径；调用方证明同源后才允许旧路径 fallback，canonical 显式空数组优先。setResourceDomains 一次更新完整选择，不改原始笔记或无关关联。纯契约交付不代表服务与界面已接入，进度见 TASKS 的 D03b/D03c。

跨模块的领域删除由 src/app/workspace 原子协调，清理资源和记忆引用。

公开入口和依赖见 `module.json`。调用者只使用声明的公开入口；领域层不依赖 React、Tauri、store 或文件系统。

验证：`npm run check:modules`、`npm run typecheck`、`npm run test:mocks`。现有算法的回归测试暂保留在旧入口路径，以同时验证兼容性。
