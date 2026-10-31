# 星图

领域层保留独立三维布局/投影/颜色与图模型，UI 仅负责 Canvas、相机和交互，保留参考项目 MIT 声明。

应用层 `createWikiGraphQuery` 经文件、frontmatter、检索关联和社群分析端口加载 Wiki，查询缓存/进行中构建按实例隔离；传入的数据版本同时用于关联权重，避免读取可变全局 Store。`buildWorkspaceScene` 将 Wiki/记忆转换为统一点线场景，处理领域/搜索过滤、可见边和数量限制，标签由调用者提供。

`app/star-map` 注入本地文件与 worker/Louvain 适配；`app/retrieval/graph` 装配关联检索，旧 wiki-graph/graph-relevance 入口兼容。工作区组件仅组装数据和交互状态；项目切换使旧查询失效并清空旧场景，避免切走再回来的迟到覆盖。

公开入口：根入口是 Canvas；domain 是纯规则；application 是查询/场景用例。模块通过声明依赖使用 memory/domains/retrieval 的公开契约，不读取 Store 或原生 I/O。当前内存分类/星体映射与视觉规则保持原行为，最终真实星图及授权记忆查询仍在后续 G/C/F 系列。

契约验证覆盖查询实例隔离、版本传递、过滤后边的端点一致和 Windows 领域路径映射；旧图谱/关联/社群回归保留。
