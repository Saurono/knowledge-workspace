# 文档来源与版本

`domain` 拥有来源原路径/稳定 ID/首次时间、已确认移动后的键迁移及既有摘要命名规则；`application` 注入目录仓储、修订哈希、版本查询和通用文件历史端口。模块不依赖 Store、Tauri、Wiki 或 Obsidian。

`app/document-records` 保持 ingest-records v1 聚合文件兼容，组合文档来源、Wiki 页面元数据与 Obsidian 回执。本地手动/监听/定时导入和已确认内容相同的移动链路已在 B07a/B07b 接入；移动保持稳定 sourceId、原始时间和历史回执，不把旧时间未知伪造为当前时间。

B08c2 的通用文件历史模型供 Wiki/原文展示，app/wiki 适配原生命令并复用提交锁。生产 Web 版本存储与新 API/MCP 文档注册链路仍未实现（B07c 依赖 C02/I02）；没有跨文件事务、自动 Vault 移动同步或服务端授权。

旧 lib 入口与原 JSON 保留，目录/回执/移动/历史/路径碰撞测试验证兼容性。运行 `npm run check:modules`、`npm run typecheck`、`npm run test:mocks`。
