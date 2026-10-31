# 模块化架构与开发约束 v1

日期：2026-10-31（Asia/Shanghai）
状态：作为后续代码的架构约束。已完成首个 star-map 独立模块与自动边界检查；原生其余代码尚未全部迁移。

## 1. 基本架构

采用模块化单体：同一产品内有清晰的业务模块与公开接口，可按需独立替换实现；不要求先部署成一组微服务。

本地桌面和 Web 复用领域模型与业务用例。Tauri、HTTP、MCP、本机 CLI、数据库和 Obsidian 是不同适配器，业务功能不直接依赖某个平台入口。

“独立模块”的验收标准：有明确职责与数据归属、公开 API、受控依赖、模块配置与迁移、单独的测试和文档；修改模块内部实现不要求调用者导入其私有文件。

## 2. 功能模块与数据归属

| 模块 | 职责 / 归属 | 对外接口举例 |
|---|---|---|
| identity | 账号、Agent Token、身份委托、工作角色、访问上下文与授权 | authenticate / createContext / authorize |
| projects | 知识库与项目、成员/资源范围 | getProject / listAccessibleProjects |
| domains | 扁平多选领域及资源归类 | listDomains / assignDomains |
| documents | 原始资料身份、版本、元信息、来源定位 | registerSource / readSourceVersion |
| ingestion | 解析与知识编译用例、增量与阶段状态 | ingest / registerParser |
| wiki | Wiki 页面、类型、版本、来源标记、问题/手册/方法 | read / proposeWrite / revise |
| memory | 分层记忆、规则、提案、冲突、有效期和关系 | recall / propose / revise / curate |
| retrieval | 授权范围内关键词、向量与关系召回、证据装箱 | search / retrieveContext |
| agent | 运行时、工具路由、会话、工具事件与产出清单 | run / cancel / subscribe |
| research | 多来源研究、证据筛选、报告生成 | research / synthesize |
| tasks | 任务登记、调度、状态、日志、重试与取消协议 | registerExecutor / submit / watch |
| star-map | 规范场景的布局、星体映射、相机、绘制和交互 | renderScene / project / select |
| cli | 各 CLI 适配、能力探测、进程/事件转换 | detect / execute / normalizeEvent |
| integrations | 外部连接契约；Obsidian 连接与独立回执为子模块 | connect / deliverReceipt |
| quality | Wiki/记忆检查、纠错建议和审阅流程 | check / proposeFix / review |
| settings | 类型化设置、配置与能力状态 | getConfig / updateConfig |

统一 UI tokens、基础控件和类型化公共契约是共享层；不能把业务规则持续堆进一个 shared/utils 或全局 store。未来较大的 integrations/cli 子模块可以升级为同级模块，保持接口契约。

## 3. 目录与分层

```text
src/
  app/                         # 应用壳、路由、依赖装配、跨模块工作流
  modules/
    <feature>/
      module.json              # 公开入口、允许依赖等架构声明
      index.ts                 # 公开接口，外部使用此入口
      domain/                  # 纯类型、规则、状态机；不依赖 UI / 原生平台
      application/             # 业务用例、端口接口、模块事件
      infrastructure/          # HTTP / Tauri / DB 等端口实现
      ui/                      # 页面、组件与视图状态
      tests/                   # 复杂用例测试，也可贴近源文件放置
      README.md
  shared/
    contracts/                 # 稳定的公共 ID / 上下文 / 错误 / 事件契约
    ui/                        # 基础组件与设计 tokens
    platform/                  # 平台适配契约
```

不要求纯绘制模块建立无内容的 application/infrastructure 空目录。模块大小由职责决定；出现独立变化原因时再拆分。

后端采用相同业务边界：domain → application ports → adapters。Rust command / HTTP route / MCP tool 是入口适配器，调用同一业务用例，不各自复制授权、记忆修订或知识回流规则。

## 4. 强制依赖规则

1. 外部只能导入模块公开入口；不能引用另一个模块的 ui、infrastructure 或私有文件路径。
2. domain 保持纯业务逻辑；不导入 React、Tauri、浏览器对象、具体文件系统、全局 Zustand store 或其他模块内部类型。
3. application 依赖 domain 和端口契约，不依赖 UI 或具体数据库/网络适配器。
4. infrastructure 实现端口；UI 调用 application/public API，不直接访问另一模块数据库或本机命令。
5. 跨模块依赖显式声明且无循环；通用契约通过共享类型/端口提供，不互相导入具体服务实例。
6. app 的组合根负责选本地/Web 实现、注册执行器和装配工作流。模块不在 import 时启动服务、读全局设置或注册不受控后台任务。
7. 界面状态归模块或应用壳；身份、任务和业务实体不能通过同一个巨大全局 store 相互改写。
8. 模块的可配置/可替换是实现能力；停用某个可选适配器不会删除数据或让授权等基础约束失效。

当前自动检查覆盖新 modules 树的公开入口、声明依赖、基础层次与循环依赖。旧目录处于兼容迁移阶段；共享契约目录和后端边界检查要随对应代码落地扩展，不能声称现有旧源码已全部受控。

## 5. 跨模块协作，避免互相嵌套调用

- 文档导入：documents 登记版本 → 应用工作流提交 ingestion → 使用注入的 WikiWritePort 提交页面 → 更新 retrieval。
- Agent 经验回流：agent 产出规范事件 → 应用工作流组织 Wiki 草稿/问题/手册 → 按 memory 规则提取记忆引用。
- tasks 是任务基础设施，不逐个导入 ingestion/research/quality/cli 的实现；组合根通过 Executor 接口注册它们。
- star-map 只接收已授权场景与交互回调。Wiki/记忆如何转换为场景属于查询/应用适配，不嵌入绘制器。
- Obsidian 接收规范回执，不参与 Wiki/记忆内部写入事务；故障独立重试。

同步用例调用使用类型化端口，提交后通知使用版本化事件。需要原子提交的跨模块工作由应用事务/UnitOfWork 协调；不可用“各模块都写一次文件”模拟数据库事务。

事件至少带 eventId、schemaVersion、projectId、contextId、taskId/causationId、对象 ID/版本；outbox 与规范数据一并提交，消费者幂等。消费事件不等于自动获授权，内容范围仍需验证。

## 6. 模块接口与替换能力

端口举例：MemoryRepository、WikiWritePort、SourceParser、TaskExecutor、CliClientAdapter、GraphSceneProvider、ReceiptDelivery。接口描述输入输出、版本、错误、取消/超时语义，不把 React 状态或数据库连接泄漏给调用者。

例如：

```ts
interface TaskExecutor<TInput, TResult> {
  execute(input: TInput, context: ExecutionContext): Promise<TResult>
}
interface GraphSceneProvider {
  query(input: GraphQuery, context: AccessContext): Promise<AuthorizedScene>
}
```

这些是设计草案，需与实际服务端 AccessContext/任务协议对齐；不能通过 TypeScript 类型代替运行时鉴权。

## 7. 数据、配置与扩展

- 每个模块负责自己实体、表/存储版本和迁移；模块间只使用稳定 ID、公开查询和引用，不直接改别人的 JSON 或表。
- 统一存储可使用一个事务数据库，不因模块化拆成互相失去一致性的独立数据库。
- 客户端数据缓存按项目、真实操作者、有效身份和角色上下文隔离；切上下文时由应用壳协调失效。
- 解析器、模型供应商、CLI、外部来源、星体规则等使用显式注册接口与能力描述；新增适配器不修改其他模块私有实现。
- 公共 API / 事件 / 持久化 schema 分别版本化；内部重构不无故改变公共契约。破坏性变化提供迁移与兼容期。
- 视觉 tokens 从 shared/ui 统一注入，各页面不独立定义另一套应用色彩、间距、状态和字体规则。

## 8. 首个实际拆分：star-map

已迁移：

- `src/modules/star-map/domain/scene.ts`：布局、投影、场景类型、连线整理与颜色。
- `src/modules/star-map/ui/`：Canvas 绘制、相机交互与星海样式。
- `src/modules/star-map/index.ts`：公开渲染 API。
- `src/modules/star-map/domain/index.ts`：可独立使用的纯场景 API。
- `module.json`：声明当前仅允许 React/react-i18next，无业务模块或旧 store 依赖。
- `domain/scene.test.ts`：纯规则/投影测试。

现有 `components/workspace/memory-star-map.tsx` 暂作为应用组合/数据适配层，负责从 Wiki/记忆取数并输入 renderer；后续迁移到 app/workflows 或查询模块。旧 lib/memory-sea-scene.ts 只保留公开重导出作为兼容入口。

这次拆分保持当前界面与交互，修改星图绘制不需要访问记忆持久化，改变记忆读取也不需要更改绘制器。

## 9. 自动约束与验证

- `npm run check:modules`：检查公开入口、模块声明依赖、分层和循环依赖。
- 脚本已接入 CI，新增违规依赖会使检查失败。
- 模块边界检查器自身用 fixture 测试覆盖合法公开调用、私有调用、纯领域违规、循环依赖和未声明旧 store/平台依赖。
- 每个模块有纯规则测试、必要的适配器契约测试和关键用例测试；跨模块仅保留重要工作流的集成验收，不为每个简单 UI 包装重复写镜像测试。
- 本地/Web 与模拟预览使用相同业务端口，分别提供适配器测试，避免预览通过却默认认为原生能力已经验收。

## 10. 逐步迁移顺序

1. 建立本架构规则、公开入口与检查器；抽离无副作用的 star-map 核心（本轮完成）。
2. 拆分 memory/domain、仓储端口与本地适配器；把 workspace.json 的兼容处理放在迁移适配层，避免新服务继续依赖合并的全局文件。
3. 建立 identity/AccessContext 公共契约，落实共享记忆权限与并发存储。
4. 拆 tasks 与执行器注册，依次迁移 ingestion/research/quality，去掉视图生命周期对执行的影响。
5. 拆 wiki 与文档/来源，统一版本和知识回流工作流。
6. CLI、Obsidian 和 MCP 逐个通过适配器接入；迁移后删除已无使用者的兼容入口。
7. 替换应用全局 store 中的业务实体为模块公开 API；统一共享 UI tokens 与页面壳。

每一步独立构建和回归，保留原数据与已有能力；不把“创建了一组目录”当作完成全量模块化。
