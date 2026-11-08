# D09 原生验收证据

日期：2026-11-08，Asia/Shanghai。主控独立执行，Luna 编写验收脚本。以下结果按程序提交与场景区分，不将索引命令测试当作完整生产入库链完成。

## 首轮原生索引与重启

- 程序：GitHub Actions 运行 `42439475998`，提交 `82b28d61bb649ea79af91358940aa1450859372e`，产物 `llm-wiki-windows-acceptance`，artifact ID `13602041027`。
- ZIP SHA256：`df2b46e15e19242c30812c250bfdc8e3cbe43a20cd94a9a4aca0829fe3e36552`，本地下载后独立计算一致。
- 独立应用标识 `com.llmwiki.acceptance`，回环 API 19829、WebView CDP 9223；未更改现有业务项目或旧安装程序配置。
- 脚本：`smoke-native-index.mjs`，通过实际 WebView 调用原生 `hash_file_sha256`、`embed_wiki_page_verified`、`verify_page_index_commit` 和 `search_project`。
- 使用临时合成 raw 文件与 Wiki，确定性本地 embedding 服务返回四维向量；模型提供者故障注入为 HTTP 503，不代表真实商业模型验证。
- 首轮提交、读回、向量命中通过；修改 Wiki 后旧证明拒绝；故障注入拒绝成功状态；修复提供者后重新提交与读回通过。
- 重启同一验收程序后，无需模型提供者即可验证持久清单并检索，`vectorHits=1`。
- 独立 raw 文件 SHA256 前后及重启后相同：`99a023d6b49734cf08f8a82887e4925cde29f664312fe916166df3a3a4d3e6c8`。
- 运行证据在本机临时目录 `kw-d09-native-index-t4Ntgp/native-index-evidence.json`；日志 `kw-d09-native-phase1.log` 与 `kw-d09-native-restart.log`。

## 后续验收边界

上述提交不包含后续新增的原生 Vault 写入命令与最终生产阶段接线。最终提交对应的程序、原生 Vault 移动/回读/防逃逸，以及真实文件生产入库链仍需独立验证后补充。
