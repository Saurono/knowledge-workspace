# Obsidian

`domain` 拥有 v1 回执模型、生成策略、Vault 归属判断和对外 payload。来源身份属于 documents，Wiki 页面创建时间属于 wiki；应用层把两者投影为回执输入，不把来源目录搬进本模块。

`application/service` 注入聚合记录仓储与 Vault 投递端口，处理连接校验、断连、稳定文件名投递、失败保留 pending 和重复投递跳过。仓储 update 必须串行读/改/保存并保留其他模块字段；`app/obsidian` 复用现有 ingest-records 锁、原子 JSON 写入和 `.obsidian` 检查。

Vault 端口只有写独立回执的能力。适配器仅在 `kb-ingest-records/` 写 JSON，不修改源笔记。重连后必须验证来源属于当前 Vault；payload 不包含内部 delivery/error 字段。文件名仍为编码后的稳定回执 ID，旧路径和 JSON 兼容。

`app/document-records/receipts` 保留入库后跨模块组合及旧导出。未实现跨设备同步、跨文件事务或外部软件主动确认接收；delivered 只表示回执文件写成功。当前验证为内存/模拟 FS，不是用户真实 Vault 验收。
