# 文档摄取检查点

D01 为每个文档定义 receive、parse、compile、index、feedback 五个阶段。检查点只保存资源标识、策略、尝试状态、证据引用和可行动错误，不存正文、口令或 Token。领域层没有时钟、随机数或 I/O；时间与 attemptId 由调用者提供。

接收阶段只在二进制文件写入后，连同文档元数据一次保存为 succeeded。该记录证明文件已接收，不证明解析或知识处理已经发生。parse、compile 从 pending 开始；index、feedback 按 required/disabled 策略分别为 pending/skipped。阶段只能在前序阶段成功或显式跳过后启动；成功必须带非空证据，非成功必须带结构化错误。重试只清理对应阶段的当前结果并保留 attempt 计数，不重跑已完成上游阶段。

索引和回传只有策略明确为 disabled 才能跳过。默认索引 required；回传在没有配置时默认 disabled。contentReady 由 compile 的成功证据决定，knowledgeReady 还要求 index 成功或显式跳过，feedbackDelivered 只代表反馈实际成功。complete 还要求所有 required 能力完成，因此下游失败不会擦除已经成立的知识结论，也不会误报 ready。

显式调用恢复用例时，遗留 running 阶段转为 blocked，错误码为 interrupted。它不会被推断为成功，旧 attempt 的晚到结果也会因状态/attemptId 不匹配而拒绝。新执行必须先 retry，再以新 attemptId 开始。持久适配器把快照与原 document JSON 共用资源及条件 revision 写入，保留上传元数据和未知字段；沿用资源事件的事务和冲突语义，不新增 SQLite 表。受保护 repository 仍负责 documents.read/write 授权。

无检查点的历史文档只有在具有可靠 received 元数据时，读取时才会保守构造初始快照；不会根据旧 done 标志或时间戳推断处理阶段完成。该兼容读取不写入资源，后续显式条件保存时才会持久化。已有但损坏或归属不符的快照会报错，不会重置。

D01 不包含解析器、模型、索引器、Vault 执行器、调度器、去重、来源修订或来源时间迁移，也不改变旧桌面队列 done 含义。后续执行器只能在实际完成操作并持有证据后调用状态协议；任务展示和统一任务历史留给后续范围。
