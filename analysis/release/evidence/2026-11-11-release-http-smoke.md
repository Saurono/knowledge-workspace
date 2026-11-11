# 证据：发布面 HTTP 冒烟（导出 / 导入 / 孤儿清理，2026-11-11）

**这是什么**：不是单测。用**构建产物** `dist-service/server.mjs` 起真实 HTTP 服务（临时 SQLite 目录、127.0.0.1:4320、跑完即删），走完整鉴权链后，用 admin 会话把三条运维入口真跑一遍。

**脚本**：`C:\Users\D1761\Documents\Codex\tools\smoke-release-http.mjs`（仓库外，避免把本地临时口令带进仓库）。

**真实输出（尾部，`SMOKE_EXIT=0`）**：

```
ok bootstrap -> 201
ok login -> 200
ok create project -> 201
ok write wiki page -> 200
ok write memory -> 200
ok export bundle -> 200
ok export contains 1 wiki / 1 memory / 0 documents
ok import dryRun -> 200
ok import applied -> 200
ok import applied {"memories":1,"domains":0,"wikiCreated":0,"wikiUpdated":1}
ok import idempotent -> 200
ok memory count stable after re-import
ok scan orphans -> 200
ok orphan detected
ok delete orphans without confirm -> 400
ok delete orphans with confirm -> 200
ok orphan removed
SMOKE_OK project=7ea48ecd-d3a3-481b-9ab0-1b0eeb83fdfc
SMOKE_EXIT=0
```

**它证明了什么**：

- `GET /projects/:id/export` 返回的包里有 wiki 页面和记忆，结构与导出格式一致；
- `POST /projects/:id/import?dryRun=1` 与真导入都 200，真导入报 `{memories:1, domains:0, wikiCreated:0, wikiUpdated:1}`（同一个包再导一次覆盖而不新建）；
- **再导一次不会把记忆变成两条**（`memory.summaries` 里 `m1` 仍只 1 条）；
- 孤儿上传：磁盘上造一个没有文档记录的 `uploads/<projectId>/<sourceId>/blob.bin`，扫描能发现；**不带 `confirm=1` 删除返回 400**；带 `confirm=1` 删除返回 200 且文件真的没了。

**它没证明什么**：

- 没有走 Web 面板（浏览器里的导出下载、导入预览按钮没点过）；
- 文档（document）字节没有进导出包，导入侧如实返回 `documents.imported: 0`，**这条没验也无法验**；
- 没有验跨项目导入、坏引用回滚这些边界（单测里有，本次冒烟没覆盖）。

**复现**：

```powershell
node scripts/build-service.mjs
$env:KW_SERVICE_PORT="4320"; $env:KW_BOOTSTRAP_KEY="<至少24字符>"; $env:KW_SERVICE_DATA="<临时目录>"
node dist-service/server.mjs
# 另一个终端（同一个 KW_BOOTSTRAP_KEY / KW_SERVICE_DATA）
node C:\Users\D1761\Documents\Codex\tools\smoke-release-http.mjs
```
