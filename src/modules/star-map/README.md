# 星图

## 图数据场景

`buildGraphScene(input: GraphSceneInput)` 接收授权过滤后的 `MemoryGraphNode[]`，返回 `{ points, edges, total, totalEdges, lod }`。
节点无正文，所以 `text` 放分类（缺省为空串），搜索只搜标题，不区分大小写。
领域与标题过滤后按更新时间倒序、同刻 ID 升序排列；关系边仅保留两端可见的节点，移除自环并按无向边去重。
分级与采样规则同 `buildWorkspaceScene`，可用 `maxPoints` 指定上限，采样后再次裁边。
`total` 是过滤后采样前的节点数，`totalEdges` 是最终裁边后的边数。权限过滤在服务端，这里只做渲染采样。

## G05 渲染分级与降级

`planLevelOfDetail`：总数 ≤2000 为 full（stride=1），2001–8000 为 sampled（stride=2），
大于 8000 为 overview（stride=4、clusterEdges=true）；默认上限均为 4000。
`clusterEdges` 是概览档的领域粗线聚合标记，当前场景仍返回采样节点之间的原始边。
`samplePoints` 优先保留输入首节点，其余按 ID 的固定字符顺序排序、索引按 stride 取模，
不使用随机数、不修改输入，达到上限即停止。仅对采样结果布局，并用 `visibleSeaEdges` 保证边两端存在。
场景新增 `lod: { tier, stride, rendered, total }`；原有计数语义不变。
这是渲染采样，不是权限过滤：不可访问节点已由服务端过滤，任何人不得用 lod 隐藏本该可见的节点。
Canvas 挂载后检测一次 2D 能力；不可用或获取上下文抛错时显示状态提示，并按 group 列出
可点击的 `id + title`，点击继续调用 onSelect。四语提示使用嵌套的 `workspace.canvasFallback`。

## 星体外观

外观规则在 domain（可测），Canvas 只负责画。`planBodyRender` 将六种星体转换为绘制计划：

| 星体 / shape | 视觉差异 |
| --- | --- |
| star / sparkle | 小核心、十字星芒、大光晕，叠加 3 层 |
| planet / disc | 中等实心核心，1 条细弧环 |
| moon / crescent | 较小核心，以明显的带缺口弧描出月牙 |
| comet / comet | 小实心核，拉长的渐变尾迹 |
| nebula / cloud | 最小核心、最低光晕透明度，叠加 4 层低透明度圆 |
| remnant / faint | 2 条虚线圆，整体透明度仅 0.15–0.35 |

`size` 默认 1，按比例缩放核心、光晕和描边半径；`weight` 提供基础尺度，投影比例决定屏幕尺寸。
`brightness` 默认 0.6，单调提高光晕和整体透明度；普通星体整体透明度从 0.25 到 1，历史星体从 0.15 到 0.35。
所有光晕半径至少是核心的两倍；缺省或未知星体按 planet 绘制。颜色继续使用原有 `seaColor` 结果。
系统 `prefers-reduced-motion` 初次读取并监听变化，开启时不脉动、不漂移；关闭时允许轻微脉动。
拾取半径跟 `coreRadius` 走，使用投影后核心半径的 2.4 倍，并继续按遍历顺序选择距离最近的点；选中与悬停高亮圈保留。

G02 星体语义映射按下表优先级从上往下命中即停：

| 优先级 | 星体 | 记忆语义与条件 |
| --- | --- | --- |
| 1 | remnant 历史星体 | archived / superseded / expired，保留追溯但已不参与现在 |
| 2 | comet 彗星 | validity.until ≤ now + 30 天，含已过期但仍 active 的有寿命记忆 |
| 3 | star 恒星 | importance 非 null 且 ≥ 0.7，高重要性记忆 |
| 4 | nebula 星云 | relations.length ≥ 3，多关系记忆 |
| 5 | moon 卫星 | relations.length ≥ 1，有关系记忆 |
| 6 | planet 行星 | 其余记忆 |

重要度管体积、可信度管亮度，两根轴互不读取。
`size = importance === null ? 1 : 0.8 + importance * 1.6`；`brightness = credibility === null ? 0.6 : 0.35 + credibility * 0.65`。
`SeaPoint` 增加可选 `body`、`size`、`brightness`，由 `buildWorkspaceScene` 的 memory 分支注入，`now` 可由调用方传入。
视觉落地在 G03，本卡只定规则；现有布局半径和按 group 取色保持不变。

领域层保留独立三维布局/投影/颜色与图模型，UI 仅负责 Canvas、相机和交互，保留参考项目 MIT 声明。

应用层 `createWikiGraphQuery` 经文件、frontmatter、检索关联和社群分析端口加载 Wiki，查询缓存/进行中构建按实例隔离；传入的数据版本同时用于关联权重，避免读取可变全局 Store。`buildWorkspaceScene` 将 Wiki/记忆转换为统一点线场景，处理领域/搜索过滤、可见边和数量限制，标签由调用者提供。

`app/star-map` 注入本地文件与 worker/Louvain 适配；`app/retrieval/graph` 装配关联检索，旧 wiki-graph/graph-relevance 入口兼容。工作区组件仅组装数据和交互状态；项目切换使旧查询失效并清空旧场景，避免切走再回来的迟到覆盖。

公开入口：根入口是 Canvas；domain 是纯规则；application 是查询/场景用例。模块通过声明依赖使用 memory/domains/retrieval 的公开契约，不读取 Store 或原生 I/O。当前内存分类/星体映射与视觉规则保持原行为，最终真实星图及授权记忆查询仍在后续 G/C/F 系列。

契约验证覆盖查询实例隔离、版本传递、过滤后边的端点一致和 Windows 领域路径映射；旧图谱/关联/社群回归保留。
