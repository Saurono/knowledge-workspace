# D04 来源与时间全入口契约

日期：2026-11-03（Asia/Shanghai）。沿用 D02 的来源身份和成功修订证据，覆盖当前已经实现的入口；不存在的共享编译/索引执行器不在本任务中虚构。

## 时间含义

- receivedAt：确认复制/下载/上传已成功接收的时间；预留没有接收时间。Watcher 记录的是首次观察/登记，不能称为文件原始创建时间。
- ingestedAt / sourceIngestedAt：来源首次可信成功编译并持久记录证据的时间；排队、解析开始、缓存命中、上传接收均不能代替。旧 cache 只证明发生过处理但无原始时间时保持 null。
- revisionIngestedAt：该内容修订首次可信成功入库时间；重试、同修订复用不重置。
- WikiProvenance.createdAt：真正新页成功创建的事实；已知时间保持不变，已有 null 和旧文件无记录继续未知，不用 mtime 或当前时钟倒填。
- YAML created/updated：文件内容中的日期，与精确 provenance 时间分开。生成更新保留已有 created，旧缺失时不冒充今天创建。手动编辑和明确历史恢复的正文按用户操作保留，不能悄悄覆写。
- Shared ResourceRecord.createdAt：服务端资源首次创建时间，不能直接标成原始来源首次入库时间。

## 分节点与写入边界

1. D04a：Wiki 纯事实记录及应用共同写入边界。editor/generator/research/review/repair 经 pages/commit，history 恢复在实际成功后记录。只处理 Wiki Markdown，锁顺序保持项目写入→records。元数据失败明确拒绝成功，已写正文保留，重试不猜测未知原时间。
2. D04b：手动/监听/定时/URL/编译现有入口及 shared 可靠投影。URL 保存真实 URL origin，在落盘成功后确认接收；重复 URL 沿来源身份复用，不单按标题生成新身份。共享上传保持 receive-only；任何编译时间都必须来自可信执行记录。
3. D04c：本地与共享界面清楚显示 Wiki 创建、来源首次观察/接收、首次成功入库及未知状态，并补全入口覆盖矩阵与证据。

来源移动、项目位置变更、更新、失败重试、取消和恢复不重置已有首次时间；回执历史位置与证据保留。新加时间字段保持可选兼容，不重置旧 JSON 或数据库，也不自动修改 Obsidian 原笔记。

## 验收要求

用确定时钟与合成资料证明：未复制/下载成功不确认 received；编译失败/取消不确认 ingested；重复、更新、移动、修订及重启不改变已有首次时间；旧未知不回填。对 Wiki editor/commit/history 公共入口验证首次创建与更新/恢复，不能只对 helper 评分。共享用真实 HTTP/SQLite 验证接收和资源时间，分开标注注入 checkpoint 与真实执行。

最终报告逐项列出入口、真实记录点、自动化证据及原生限制。真实 Vault、真实模型、Rust watcher/Shell 和安装包另行验收，不从前端测试推导其成功。
