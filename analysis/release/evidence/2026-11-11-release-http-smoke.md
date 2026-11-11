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
ok upload document -> 201
ok delete document without If-Match -> 428
ok delete document with If-Match -> 200
ok document byte + record removed
ok workspace?memories=none -> 200
ok light workspace: memories=0, domains=0, revision kept
ok workspace invalid projection -> 400
ok submit batch-k1 -> 200
ok submit batch-k2 -> 200
ok approve-batch dryRun -> 200
ok approve-batch applied -> 200
ok batch approved proposals visible as memories
ok re-approve by ids reports not_pending
SMOKE_OK project=19e9ca01-450e-47cc-8a64-a09583476df9
SMOKE_EXIT=0
```

**它证明了什么**：

- `GET /projects/:id/export` 返回的包里有 wiki 页面和记忆，结构与导出格式一致；
- `POST /projects/:id/import?dryRun=1` 与真导入都 200，真导入报 `{memories:1, domains:0, wikiCreated:0, wikiUpdated:1}`（同一个包再导一次覆盖而不新建）；
- **再导一次不会把记忆变成两条**（`memory.summaries` 里 `m1` 仍只 1 条）；
- 孤儿上传：磁盘上造一个没有文档记录的 `uploads/<projectId>/<sourceId>/blob.bin`，扫描能发现；**不带 `confirm=1` 删除返回 400**；带 `confirm=1` 删除返回 200 且文件真的没了。
- 文档生命周期：`POST /projects/:id/documents`（`X-File-Name` 头 + 原始字节）→ **201**，返回资源记录 `key` 就是 documentId；`DELETE /projects/:id/documents/<id>` **不带 `If-Match` 返回 428**（不是 400），带 `If-Match: "v<revision>"` 返回 200，之后文档列表里不再有它。
- 轻量 workspace：`GET /workspace?memories=none` 的 `memories` 为空、`revision` 与完整 GET 一致（**实测：轻量 0 条、完整 1 条、`revision` 都是 4**）；非法 `memories=all` → **400**。
  - **更正（2026-11-11 17:15）**：这份证据最初那两条断言取错了 JSON 层级（读的是 `data.memories`，实际是 `data.data.memories`），所以"轻量 0 条 / revision 保持"当时**其实没被真正验证**。脚本已改成读 `data.data.memories` 与 `data.revision`，并加了一条"完整 GET 的 memories 不能为空（防夹具坏掉）"，重跑后输出 `light workspace: memories=0, full memories=1, revision kept 4`。
- 提案批量批准：两条提案 dryRun 能列出 eligible，真批 approved 两条，批准后 `memory.summaries` 里能看到；**按 ids 再批一次逐条 `not_pending`**。注意：**不带 `ids` 时 `failed` 恒为空**——这是既有语义（只有显式传 ids 才会校验），不是 bug。

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
