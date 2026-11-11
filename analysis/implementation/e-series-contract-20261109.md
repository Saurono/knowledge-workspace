# E 系列实施与验收契约 · 2026-11-09

用户已授权接续 E 系列（E01–E08）。基线为已推送 2abae89，沿用现有 checkout / codex/knowledge-workspace-v0.1；不新建 worktree、不合并 main。所有程序/测试/YAML由 gpt-6-luna 编写，主控定契约、审查真实 diff、独立验收、更新完成记录与提交推送。K 及 F–J 不因此启动；不触碰业务安装程序、真实 Vault 或其配置。

## 交付要求

- E01 已有导航合并，E02 必须实际验证原结构/语义检查、规则、单项/批量修复、忽略、送审与审阅路径。Wiki保留诊断和知识结果；运行进度/日志/取消详情统一到任务管理器。复用现有维护执行器，不冒充H持久任务服务。
- E03 同一项目的 ChatWorkspace 使用同一领域条件，本地/LLM模式各自保留输入结果；项目切换与删除领域清理失效条件、隔离迟到结果。可信组合root生成本轮native AgentRetrievalScope（projectRoot/runId/canonical allowedWikiPaths/allowedRawSourcePaths），命令入口验证并冻结到工具context，模型参数不能扩大；空白名单严格0结果，undefined/null未筛选兼容。候选、页面读取、graph上下文和引用均受范围约束；受限本机检索禁用shell/Web/AnyTXT等无界旁路，并明确提示。领域条件不等于共享ACL；共享检索仍先经服务端授权，再筛选、分页，不能依赖UI过滤。
- E04 固定可信creator/createdAt，正文contentHash绑定版本作者与贡献，originKinds=user/agent/system，多类为mixed。metadata更新、相同正文及用户审核不增加正文用户贡献。实际操作者与effective principal/workRole/entrypoint/taskId/reason分开；Agent借用人员身份仍是Agent。legacy未知作者/时间不由mtime/frontmatter回填。共享metadata只由verified AccessContext构造，同资源CAS/事件存储，拒客户端伪造；本机仅记录local-user/local-agent-run等真实本机入口身份，不伪造共享账号。新增字段兼容v1且严格校验，坏文件保留拒写。native Agent/API写入须实际接线，不以TS hook替代。
- E05 问题页含症状、尝试及结果、方案、环境/适用范围、证据和限制，open/workaround/verified/superseded分开；失败尝试不算成功。模型叙述与任意工具exit0不直接证明问题已解决。只有明确绑定对象/版本/环境的执行器验证事件，或明确标注用户手动验证来源的记录，才可升verified。
- E06 手册绑定产出稳定ID+实际内容hash/version+位置，方法关联问题/手册及适用条件；产出变化不覆盖旧版本手册，旧版可追溯并提示需要更新。不虚构安装命令、操作步骤或成功输出；确定性草稿可由用户补全后审核。
- E07 默认draft不进入活动Wiki/检索；UI可编辑/审核发布。幂等键绑定run/scope/artifact versions/observations，重复投递不重复页；持久journal坏记录拒绝保留；expectedBaseRevision并发冲突保留草稿。发布走同一Wiki CAS与可信作者入口，回流失败独立retry不重跑Agent/丢原run结果。回流属于wiki_maintenance任务投影，不新增第四标签。私有经验不能自动扩到project/shared；共享发布拒绝无权证据和private/role范围，需另建显式脱敏提案，不能静默降级权限。每次publish/retry重新授权。
- E08 逐现有入口矩阵核验Wiki创建时间、来源首次/当前修订入库时间，编辑/恢复/移动/重试不重置；legacy未知保持未知。覆盖本机Agent写入及共享来源投影。

## E05–E07 实施边界（Luna任务书）

允许新 modules/wiki/domain/writeback.ts、application/writeback.ts及对应测试，新增 app/wiki/writeback* journal/workflow、app/agent/writeback.ts adapter、独立WritebackPanel与必要知识类型/模板/schema路由。公共domain/application index由E04 agent唯一写入，发送exports请求，不并发覆盖。

本机Agent的真实终态由chat-panel接入adapter（chat-panel由E03唯一writer）：成功/失败/取消均可记录真实tool观察和实际FS hash的产出引用，默认生成确定性草稿，不另调用LLM；adapter提供公开签名给E03。正文/私有日志不自动复制进共享提案。

共享目前没有执行器（H/I），API可接受外部Agent草稿但提交者声称的事件只标unverified，不能冒充服务端运行证据。作者来自服务端上下文；证据引用逐条存在性/权限检查，撤权后publish/retry拒绝。草稿不能存作普通可检索Wiki页；若需要新SQLite表/schema迁移，先给主控明确方案。不要借workspace整对象覆盖绕过C09隐藏数据保护。

允许server新writeback仓储/路由及http/resource-tools/SDK必要接线；src/web/workspace.tsx由E05独占集成E04提供的AuthorshipView与自己的WritebackPanel。不改E04 provenance/app commit/pages/authorized-repository/type文件；不改E03 chat-panel/native tools/runtime。模块间仅公开API，跨模块合成放app/server。

## 验收与纪律

至少覆盖伪造作者拒绝、delegated Agent、legacy未知、同body/metadata/review不误mixed、全部写入入口时间；同run幂等、失败未verified、版本绑定、并发冲突留稿、写回独立重试且Agent调用计数不增加、private/跨项目/撤权不发布；本地与LLM检索scope实质一致且模型工具不能越出；真实UI模式保持/切项目/引用；E02既有能力逐项可达。

主控独立typecheck、边界/审计、针对性与完整回归、桌面/Web/服务构建、真实HTTP/浏览器/CLI/MCP及必要原生产物。fixture模型与实际native/文件/UI证据分开记录；不得凭agent自述、纯类型或SSR勾选。每批审阅冻结后提交开发分支，收集真实CI；最终完成TASKS/WORKLOG/HANDOFF。
