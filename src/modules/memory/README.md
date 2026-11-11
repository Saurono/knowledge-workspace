# 记忆库

domain/ 定义记忆记录、校验、引用清理；application/ 提供 list/save/remove 与 MemoryRepository 端口；ui/ 提供受控 MemoryLibrary。

本地仓储由 src/app/workspace 注入。模块不读取全局 store、不识别 workspace.json，不包含尚未实现的共享权限服务。

`MemoryLibrary` 仅传 `memories` 时保持完整记录模式；传 `summaries: MemorySummaryView[]` 时列表只搜索标题和分类，禁用缺少数据的领域筛选，选中后优先复用已有完整记录，否则通过 `onLoadMemory(id)` 加载并缓存，失败可重试。摘要模式不渲染冲突块，相关记忆与替代目标只使用 active 摘要，生命周期操作保持当前记录的状态及只读判定。`onSave` 兼容 boolean，也可返回 `{ success, record }`；成功后按 id 合并返回记录与摘要，更新版本、状态、标题和时间且不重复。boolean 成功结果沿用提交记录。

公开入口和依赖见 `module.json`。调用者只使用声明的公开入口；领域层不依赖 React、Tauri、store 或文件系统。

验证：`npm run check:modules`、`npm run typecheck`、`npm run test:mocks`。现有算法的回归测试暂保留在旧入口路径，以同时验证兼容性。

C09 增加可选 access 元数据（项目/角色/私有可见性、所有者和角色 ID）；领域仅校验结构，身份授权由共享服务组合层执行。旧记录仍按项目共享处理。用户最终记忆分类不受此访问元数据影响。

## 数据模型

`MemoryRecord` 按用途包含以下字段：

- 标识与内容：`id/title/content/category/domainIds/relatedIds`。
- 版本：`version/revisions/revisionCompaction`。
- 来源与评分：`source/importance/credibility`；评分为 0–1 或 null，null 表示未知。
- 时效：`validity`，包含可选的 `from/until`。
- 关系：`relations`，类型为 `related/supersedes/contradicts/derived-from`。
- 生命周期：`status/transitions/resolutions`，以及可选替代记录 ID。
- 访问：可选 `access`；去重：可选 `contentHash`。
- 时间：`createdAt/updatedAt`。

`source.kind` 为 `user/agent/import/system/legacy`，可带 `actorId/ref`。
`revisions` 保存版本正文、时间和来源；末项必须与当前版本及正文一致。

## 状态机与冲突裁定

允许 `candidate → active`、`active → superseded`、`active/candidate → expired`。
任意未归档状态可转为 `archived`；已归档状态不能再次归档。
共享服务的状态只能由服务端迁移动作改变：`promote/archive/supersede/expireDue`。
客户端写入 payload 携带 `status` 会被拒绝，错误为 `invalid_argument`。
`supersede` 要求替代记录存在，服务端还要求替代记录为 active。
`expireDue` 只迁移 `validity.until <= now` 的 active 或 candidate，并记录 transitions。

`detectConflicts` 检测 active 记录之间的 `contradicts`，同一对只报告一次。
`resolutions` 记录 `ofConflictWith/decision/by/at`，可附 note。
decision 为 `a-canonical/both-intentional/merged`；已有裁定的冲突不再报告。

## 可见性与授权

共享服务先检查 `memory.read/memory.write` 权限，再判断记录访问范围。
`project` 为项目共享（缺失 access 同此处理）；`role` 要求当前角色匹配 `workRoleIds`。
`private` 允许所有者本人访问，或使用匹配的 `MemoryGrant`。
grant 必须匹配 project、memory、owner、account 和请求动作。
已撤销或 `expiresAt <= now` 的 grant 无效；跨 memory、跨 account 不能复用。
非 active 记录只有本人可读：actor 必须等于 effectiveAccount，且为来源 actor 或 owner。
grant 不会放宽这一非 active 限制。
读时还按 `validity.until` 过滤，到期即隐藏，不等待持久化过期迁移。

## 写入 API 与去重

`expectedVersion`：创建必须为 null，更新必须匹配当前 version，否则版本冲突。
`idempotencyKey`：同键同指纹重放原结果，同键不同指纹返回 409。
`contentHash` 用于内容去重；重复内容返回 409，并带 `duplicateOf`。
服务端按 UTF-8 的 `title + "\n" + content` 字节数限制单条大小。
超过 32KB（32 × 1024 字节）返回 413。
项目内 active + candidate 超过 2000 条返回 429；更新时不重复计入自身。

## 召回与全文检索

`recall` 只选 active、未到期且通过注入授权函数的记录。
排序依次为 importance 降序、credibility 降序、updatedAt 降序、id 升序。
评分 null 后置；limit 决定返回条数，排除原因随 scope 返回。
`buildInjection` 只收完整条目，预算不足则跳过该条，不截断正文；引用带 ID 和版本。
`memory_fts` 使用 FTS5 的 `trigram` tokenizer，查询少于 3 个字符返回空。
索引与可见性分离：索引命中不能作为访问授权，返回结果仍需按当前权限过滤。

## 版本压缩

`compactRevisions` 默认阈值 8，超过 8 个版本才压缩，保留最近 5 个版本。
旧正文进入 `memory_revision_archive`，本体以 `revisionCompaction` 保存压缩标记：
`upToVersion/keptFrom/digest`，同时保留最近版本的 revisions。
digest 是稳定校验和，不是密码学摘要。
自动压缩只在服务端写路径触发；客户端本地保留全量版本。

## 分类约束

`category` 表示“这条记忆是什么类型”，`domainIds` 表示“属于哪些知识领域”，两者互不推导。
分类采用临时词表：identity、preference、fact、decision、procedure、context、reflection；未知值归一为 context。
归一时先 trim、大小写敏感。词表来源为评审 M07，管理员给正式方案前允许变更，修改词表须配一次迁移。
不要在其他模块按分类值分支写死逻辑，也不要把访问范围当成最终分类方案。
