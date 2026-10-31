# 检索

模块公开入口和依赖见 `module.json`。模块没有 Store、Tauri 或本机文件依赖；生产 Web 适配可实现相同端口，当前只装配桌面与显式预览。

## 职责

- `domain/markdown-chunker`：Markdown 分块。
- `domain/query`：现有中英文检索分词；`domain/embedding`：目录限定页面 ID、过长输入错误识别；`domain/vector-ranking`：分块命中按页聚合、保留匹配片段。
- `application/search`：`createRetrievalService(index)` 接收共享后端索引端口，显式传入项目、查询、模型配置和 localOnly。关键词/向量/图扩展融合排序继续由原 Rust search_project 完成，不在前端复制排序规则。响应保留 mode 与命中计数，结果映射回项目路径；拒绝路径穿越。
- `application/search.evidence`：请求正文并组装有序引用，正文缺失时退回片段；默认最多 5 条，每页 2000 字符、合计 8000 字符。空内容不占引用编号。证据负责上下文，模型回答/会话/工具运行仍归 Agent 运行时。
- `application/embedding`：`createEmbeddingService(ports)` 管理分块、批处理/逐条回退、请求并发、重建和页级向量查询。索引/模型/来源/标题解析/时钟/重试等待均注入。每个实例独立拥有错误、监听器、重建状态、优化计数及旧 ID 清理缓存。
- `application/ports`：明确区分模型向量生成、分块索引存储和源文件读取。模型端口负责原生请求及超长重试，索引端口负责持久化，服务负责编排。

## 应用装配与兼容

`app/retrieval/native-ports` 适配原 embedding_fetch、vector_*、文件读取和目录命令；`app/retrieval/search` 适配 search_project 并捕获当前配置；`app/retrieval/embedding` 注入原 frontmatter 标题解析。`lib/search`、`lib/embedding` 和 `lib/text-chunker` 保留兼容重导出，调用点和配置文件无需迁移。EmbeddingConfig 的结构归检索领域，旧 Store 保留类型别名。

本地搜索绝不向索引传入模型配置。查询在原生请求开始前及完成后检查取消；底层 I/O 不保证物理中断，迟到结果被丢弃。搜索容器在新查询、项目变化及卸载时取消旧请求，避免旧项目结果显示到新项目。编辑器选区问答已使用证据服务。

保留 v2 分块 ID、Float32 入库、按页替换、结构页排除、全量准备后清表、旧表清理及每 20 页优化规则。读取/模型失败时保留既有向量；成功清表后的数据库写入失败仍可能留下不完整索引，须重建，未新增数据库事务。跨实例/跨进程重建调度及统一任务历史留给后续任务。

## 验证

旧入口回归覆盖原生命令参数、批处理回退、并发、部分失败、全量重建与旧向量兼容；新端口测试覆盖独立实例、重建失败保留索引、本地模型隔离、取消迟到结果、证据预算/引用及结果路径校验。运行 `npm run check:modules`、`npm run typecheck`、`npm run test:mocks`。

浏览器复现：`analysis/implementation/smoke-retrieval.mjs`，仅指向显式沙箱。未在当前无 cargo 环境重新验收 Rust 排序、真实模型服务或真实向量数据库。
