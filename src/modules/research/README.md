# 深度研究

`domain/` 定义研究任务、证据来源、重试谱系，以及去除私有推理、正文有效性和引用范围校验。模型不依赖 Store、文件系统或模型供应商配置。

`application/` 提供注册到 tasks 的 `createResearchExecutor`，编排搜索、正文生成、引用校验与保存；通过端口接入搜索、流式模型、Wiki 索引、页面写入和状态投影。仅保存有实质正文且引用有效的内容；只将实际引用的证据写入 References。

`src/app/research/service.ts` 适配当前模型、搜索配置、文件命名/写入、页面刷新、审阅和非阻断索引。旧 `lib/deep-research.ts` 保留兼容导出。研究页不能控制执行器生命周期。

新研究任务绑定 projectPath；延迟调度不跨项目解释任务，执行中切换项目会取消其运行上下文，即使之后立刻切回同一路径。已有无 projectPath 的内存任务保持兼容。已经发出的部分搜索请求尚不支持取消，但其迟到结果不能继续生成/写入。原子写入启动后取消不能回滚已写文件。

当前调度和状态仍在当前进程中，不是持久后台任务服务。证据相关性筛选的模型 I/O、文件命名和文件操作由 app/research 注入，配置路由已归 settings；共享身份与授权见后续 C/F 系列任务。

`ui/` 的 ResearchPanelView 接收项目范围内的任务和操作回调，按钮与富文本合成正文通过组件/渲染插槽注入。列表/卡片不访问文件或 Store；`components/layout/research-panel.tsx` 是应用容器，research-synthesis.tsx 保留共享 Markdown/语言渲染适配。
