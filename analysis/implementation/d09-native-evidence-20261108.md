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

## 7bf81d2 生产链与 Vault 补验

- 原生基础提交 `7bf81d22574d910aad03f16549404c84c45c2e45`，CI `42442104610` 三平台全部成功，含 Rust build 与 lib tests；Windows artifact `13602431827`。
- ZIP SHA256：`f973f021ed77a17c2e8af6a8e16925862174ee8b843fb779357f22a86c3fc443`。程序独立解压，应用标识仍为 `com.llmwiki.acceptance`。
- 2026-11-08 主控运行 `d09-native-pipeline.test.ts`，2 项实际通过：真实临时文件、当前工作区 autoIngest、确定性 LLM fixture、本地四维 embedding provider、原生 hash/verified embed/verify/vector search/write_vault_receipt。5 个编译产物中 2 个知识页具备强索引证明；feedback succeeded、summary.complete=true、交付 digest 非空，外部 JSON 可读，原 source SHA 不变；重复执行不增加 LLM 调用、首次时间不变。日志 `kw-d09-native-pipeline-second.log`，临时项目 `kw-d09-pipeline-cm7Iwz`。
- 同日原生 Vault 脚本 6 项通过：原子覆盖读回、原笔记 hash 不变、旧 Vault 移走不重建、显式新路径重连、Windows junction 拒绝且外部无文件、真实 rescan 排除回执 md/json。日志 `kw-d09-native-vault.log`。
- 2026-11-09 最终候选预检新增真实 watcher：捕获正常来源创建与修改各 1 个 changed 事件，回执 md/json 未成为导入任务；共 8 项通过。日志 `kw-d-watch-precommit-fixed.log`。
- 修复 supersededBy 跨 run 校验后，主控重新运行生产链 2 项通过；实际自动同步服务单轮将旧 owned unknown JSON 覆盖为归档指针，新 run 更新同一稳定修订回执后仍可加载。日志 `kw-d-pipeline-precommit.log`，临时项目 `kw-d09-pipeline-IEJEIy`。

以上预检使用 7bf81d2 的原生命令与当时当前工作区 TypeScript，内嵌前端不是最终候选，不能替代最终提交的产物验收。实现提交为 `72ef62354d202e46f89ce09da753b96f56068631`；其 CI `42627547041` 的 Windows 真实 HTTP 集成测试因默认 5 秒超时失败，修正记录见 L044。

## 最终构建与下载校验 · 2026-11-09

- 最终产品/测试候选 `94130f59292e6a10c3c59a7b334c135b4123d9c5`，CI [42628307283](https://github.com/Saurono/knowledge-workspace/actions/runs/42628307283) 三平台全部成功。共享 HTTP/持久化各 25 文件/143 项通过；Rust lib tests Windows 425 项通过、Linux/macOS 各 443 项通过，每平台另 2 项既有 ignored，未算作通过。
- Windows artifact `13679888405`，`llm-wiki-windows-acceptance`，ZIP 大小 62,305,317 字节；GitHub SHA256 与主控下载后独立计算一致：`8dfc28842b7ba1ca69b35b2aaf05a5c9ab65e31e8097b086f22d86a312f9a2e0`。
- 解压程序 223,357,440 字节，EXE SHA256：`eddbcd7e595a72e1ffc9c1ced121794403d9c505e68eae1e635113895df857bb`；位置为本机 TEMP 下 `kw-native-acceptance-94130f5/llm-wiki.exe`。独立应用标识 `com.llmwiki.acceptance`，无安装或旧业务程序替换。
- 对应产物的独立运行结果如下；下载、摘要匹配与三平台构建成功本身不等同于界面/业务运行通过。

### 对应产物的原生运行

- `d09-native-pipeline.test.ts`，明确设置 `KW_NATIVE_REQUIRED=1` 与真实 CDP：2 项通过、无 skipped。生产 autoIngest 编译 5 产物、2 eligible 知识页原生索引强证明、向量命中、feedback 完成及 Vault digest 读回；同修订新 run 不再调用编译 LLM/embedding、首次时间保持、稳定回执仍可加载，真实自动同步服务单轮交付 unknown 归档指针，原始 source SHA 不变。日志 `kw-d-final-native-pipeline.log`；临时项目 `kw-d09-pipeline-KUEFvI/project`。
- `smoke-native-vault.mjs`：8 项通过。实际 native 原子覆盖读回、源笔记 SHA 保持、移动旧 Vault 不重建、显式重连、Windows junction 外部逃逸拒绝；显式 rescan 和真实 watcher 都排除回执 md/json。真实正常来源创建/修改产生 2 个 changed 事件。日志 `kw-d-final-native-vault.log`。
- `smoke-native-index.mjs` 首轮通过：原生提交、读回、向量命中；修改页后旧 proof 拒绝；HTTP 503 提供者失败不报告成功，恢复后重新提交；raw SHA 保持。确实停止并重启此独立 EXE 的已核对 PID 后，再以保存的清单复验和检索，`status=passed-after-restart`、`vectorHits=1`。日志 `kw-d-final-native-index.log`、`kw-d-final-native-restart.log`；临时项目 `kw-d09-native-index-B5yF6Y`。
- `smoke-native-domains.mjs`：主控独立 8 组通过，日志 `kw-d-final-native-domains-independent.log`。实际 UI 创建两个临时项目，真实 FS 写入四来源/四 Wiki；通过预览新增领域并归类，在来源列表、Wiki 导航和对话页的本地检索中分别操作 ANY/ALL/未分类；来源时间字段可读，切换项目后领域、匹配模式、查询和结果均清空。检索调用实际 native search_project，无 LLM。没有 store 注入、点击 force 或伪造入库时间。脚本初版的命令观测、重复角色选择器、受控勾选异步等待和菜单关闭问题已修正，未以这些失败轮次计为产品通过。
- UI 临时目录由脚本清理，主控核对最后验收 PID 41380 的精确 EXE 路径后停止；已安装业务程序 PID 27888 保持运行，其真实项目/Vault/配置未读写。索引与生产链的合成临时证据目录按日志保留，不当作业务资料。

## 适用边界

所有资料为合成临时文件和独立临时 Vault，未停止或修改已安装业务程序及其资料。真实商业模型、正式安装器和公网 HTTPS→loopback 浏览器兼容不在上述证明范围；本机 pull 是浏览器受限时的明确回退。原生 watcher 的实际创建/修改事件与显式 rescan 分别验证；Windows/macOS 固定 60 秒周期重扫未由这组短时脚本证明，不能写成已实测定时触发。自动同步定时调度有单轮防重入/项目切换测试，真实原生生产链在验收中显式调用同一同步服务一轮。
