# 自有知识库目标设计

需求版本：v0.4。第一批代码实现见 [实现进度](../implementation/progress-v0.1.md)。

- [目标需求 v0.4](requirements-v0.4.md)：包含 Agent 问题/方案、产出手册与来源标识，共 27 项。
- [入库与记忆专项设计](ingestion-memory-design-v0.2.md)：流程、回传可靠性、双端连接边界、记忆数据模型和星图语义。
- [目标功能框图](navigation-v0.2.mmd)。
- [推荐架构](architecture-v0.2.mmd)。
- [入库与回传流程图](ingestion-feedback-v0.2.mmd)。
- [原生功能基线](../baseline/README.md)。

已确定：双前端；user/agent/admin；agent 使用 API Token；领域为扁平多选标签；三类统一任务；Obsidian 回传、记忆库和双模式星图。Obsidian 使用 Vault 独立记录，支持外部软件读取且不修改原笔记；Wiki 标注建立时间与各来源入库时间。记忆分类方案等待用户补充。v0.1 文件保留用于版本对照。

新设计增量：[跨 Agent 记忆系统与统一视觉](../memory-system/design-v1.md)。默认按角色与项目共享，私有显式授权；支持工作角色与获授权权限身份组合切换。

[Agent 知识回流设计](../wiki-lifecycle/agent-writeback-v1.md)：执行经验、产出手册与来源身份。
