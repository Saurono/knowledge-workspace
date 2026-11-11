# 项目整体不足盘点 · 2026-11-09

范围：`knowledge-workspace` 当前工作区（HEAD 2abae89 + 未提交 E 系列）。每条都指到文件行号，能复现的能复现。K01/K03/K06 已在试跑队列里，这里只写它们没覆盖的。

## P0 结构性缺口

### 1. 共享侧检索是假检索（不是"没有检索"，是"有但不能用"）

`server/resource-tools.ts:24-47`：`keywordSearch` 把该项目**所有** Wiki 页按 200 一页全量读出，对每页 `content.toLowerCase().includes(token)` 打分。没有 FTS5、没有倒排、没有向量；`topK` 只裁结果不裁扫描；`snippet` 永远取正文前 300 字，跟命中位置无关。

后果：页数上千后每次查询就是全表解码 + 字符串扫描；检索质量退化成一堆 substring 命中，排序靠"命中 token 个数"。桌面端走 LanceDB 向量，共享端走这个，同一份知识在两个模式里答案不同。

### 2. 两种模式能力不对等

向量索引只存在于桌面 Rust 侧（LanceDB）。共享服务没有向量、没有图检索、没有 rerank。E03 契约要求"本地与 LLM 检索 scope 实质一致"——现在能做到字段一致，能力不一致。用户换个入口就换了套结果。

### 3. CI 只跑一小撮测试

`.github/workflows/ci.yml:69` 跑的是 `server` + `platform` + `service-api` + `identity` + `ingestion` + 三个 D 验收文件。本地那套 219 文件 / 2463 项完整回归**不在 CI 里**：wiki、agent、quality、tasks、retrieval、memory、domains 全靠主控人肉跑。HANDOFF 每轮写"主控独立完整回归通过"，机器一次也没守过这些模块。

### 4. 数据没有出口：没有导出、没有备份、没有恢复

server 侧找不到 export/backup/restore 任何入口。上传文件落盘与 SQLite 不同事务（HANDOFF 自记三次跨介质崩溃窗口），孤儿上传没有清理任务。K08 和 J01 都还是空的，但这是"东西会不会丢"级别的问题，不是功能。

## P1 运维与安全

### 5. 运行形态是裸进程

`server/main.ts` 就是一个 node 进程，SIGTERM 优雅退出有，其余没有：没有 Windows 服务 / systemd 单元、没有 Docker（`docker/` 目录是空的）、没有日志轮转（全仓库只有 `console.log`）、没有 metrics、没有崩溃自动重启。唯一的安装脚本是 `.github/scripts/package-windows-portable.ps1`。

### 6. 数据只增不减

`audit` 和 `events` 都没有保留策略。全仓唯一的清理是 `server/auth-store.ts:50` 删 15 分钟前的登录尝试。共享服务跑一年，SQLite 会自己长胖，审计查询也会越来越慢。

### 7. 限流只有两处

只有登录失败计数和 `server/vault-connector.ts:73` 的配对限流。普通 API 没有配额：一个 Agent Token 可以按毫秒级刷 `POST /projects/:id/search`，每次都触发上面第 1 条的全量扫描。

### 8. 模型密钥是明文

桌面侧用 `tauri-plugin-store`（`src-tauri/Cargo.toml:38`），落到磁盘是普通 JSON，不走系统钥匙串。共享侧根本没有模型配置模块（`src/modules/settings` 只在桌面链路里用），所以共享服务的模型 Key 只能是进程环境变量——多用户场景下谁配的 Key 就是全项目的 Key。

### 9. 依赖安全没人看

CI 没有 `npm audit`、没有 dependabot、没有 SBOM。仓库两棵 node_modules（主树 + mcp-server），701 个 TS 文件、`src-tauri` 一大票 crate。现在没有任何机制会告诉你某个依赖出了 CVE。

### 10. 没有 lint / 格式化

`devDependencies` 里没有 eslint、prettier、biome，仓库也没有任何配置文件。5.8 MB TypeScript 只靠 `tsc` 和边界审计兜底。风格漂移、无用导入、可疑写法全靠 review。

## P2 验证与产品

### 11. 真实模型链路永远不验收

`test:llm` 的 real-llm 用例在所有 CI 和默认脚本里都被 `--exclude` 掉。HANDOFF 每轮都写"真实商业模型未冒充通过"——这句成了永久免责声明，说明这条链路从来没被自动跑过。

### 12. 浏览器 E2E 是人手脚本

`analysis/implementation/smoke-shared-web.mjs`、`smoke-shared-clients.mjs` 都是靠人手动跑，CI 里没有 Playwright。12 组浏览器验收只存在于 WORKLOG 的文字里。

### 13. 没有性能基线

没有压测、没有索引耗时、没有大 vault fixture。K01 只覆盖检索质量，不覆盖延迟；第 1 条那种全量扫描，没人量过它在 10 万页时是什么表现。

### 14. 需求文档和事实对不上

`requirements-v0.1..v0.6`、`design-v1`、`TASKS` 的 A–K 同时存在，没有单一真相源。TASKS 里 K 系列写着"待用户确认，未确认前不启动"，实际已经在跑；D 系列全部勾完但共享侧向量仍是空的。文档状态不可信，新会话只能靠 HANDOFF 的口头描述重建。

### 15. 冲突只有 CAS

并发编辑靠 revision 冲突保留草稿，没有 diff、没有合并视图，也没有测过两个真人同时编辑同一页的实际行为。

## 建议顺序

1. 共享检索换 FTS5 + 定延迟指标（依赖 K02，比 K01 更急，因为 K01 量不出"能不能用"）
2. CI 加上完整测试（哪怕拆成三个 job 并行）+ lint + audit
3. 备份/导出/恢复最小闭环
4. 服务安装形态（Windows 服务单元 + 日志轮转 + 健康检查重试）
5. 保留策略（audit/events 归档与裁剪）与 API 配额
6. 真实模型链路定期跑一次快照；E2E 进 CI

K01/K03/K06 不解决上面任何一条中的"能用"问题，它们只在现有形状上收边。
