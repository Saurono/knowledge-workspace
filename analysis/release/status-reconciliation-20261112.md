# 项目状态对齐 · 2026-11-12

## 核对范围与结论

基线 `f42980de6b39a526f051ce3e55c6777115f97d67`，分支 `codex/knowledge-workspace-v0.1`。核对前工作区干净；`git ls-remote origin refs/heads/codex/knowledge-workspace-v0.1` 与本地 HEAD 相同。没有合并 main、改产品代码、安装插件或触碰业务 Vault/配置。

当前是功能实现与发布验收并行推进的开发版本，**不能发布为已全面验收的版本**。D01–D09 保留既有完成结论及其原生证据边界；E/F/G/H/I/K 有不同程度实现，旧 TASKS/HANDOFF 中“全部未启动”“E 系列未提交且类型红”的描述已过期。不能用一次 checkpoint 提交或模块单测替代每个任务的全部验收。

任务总项仅在原定义范围全部满足时勾选；未勾选条目追加当前进展和剩余条件。K 的实现存在是仓库事实，本次不推断历史授权、不新增 K 功能。用户最终记忆分类方案仍待确认，现有 category.ts 明确为临时词表。

## 本次实际验证

环境 Node v24.22.1，Windows。以下命令由本次主控运行，退出码均为 0：

- `node node_modules/typescript/bin/tsc --build --pretty false`。
- `node scripts/check-module-boundaries.mjs`：19 modules。
- `node scripts/audit-modules.mjs --check`：19 modules / 544 production source files。
- `node node_modules/vitest/vitest.mjs run src server --exclude '**/*.real-llm.test.ts' --reporter=dot`：283 files passed、2 skipped；2999 tests passed、6 skipped。日志位于本机 TEMP/kw-status-20261112-tests.log。此命令不包含 analysis/evaluation、独立 MCP Node test、原生 opt-in、真实模型和浏览器；不与历史不同范围的计数直接比较。

本次不重新执行构建、安装器、浏览器、Rust 或真实商业模型调用。既有证据按原日期、原候选版本引用。

## 实时远端 CI：当前红，历史绿不能沿用

通过 `gh run list`、`gh run view --json jobs` 和 `--log-failed` 核对。当前 HEAD 的 [43042394303](https://github.com/Saurono/knowledge-workspace/actions/runs/43042394303) 已完成且三平台失败：

| 平台 | 失败点 | 已查明的直接原因 | 后续验收条件 |
| --- | --- | --- | --- |
| Windows | Check shared HTTP and persistence | server/memory-routes.test.ts:59 的内容去重/大小/数量限制用例超过其单项 10000ms 限制；334 passed、1 failed、6 skipped | 检查 fixture/性能及有限超时设置，保留断言，重跑远端；本机通过不消除此阻塞 |
| macOS | Check shared CLI and MCP authorization | smoke-shared-clients.mjs:38 仍断言 11 个工具，新增 memory.conflicts 后实际 12，`12 !== 11` | 冒烟清单与当前公开工具表一致并验证新增操作，重跑真实 CLI/MCP |
| Ubuntu | Install dependencies (Ubuntu) | azure.archive.ubuntu.com DNS 解析失败，apt 退出 100 | 网络恢复后重跑依赖安装及其后的全部检查；不能据此判断产品断言通过 |

最近查询到的历史绿为 `b5ec9dc` 的 [42991687625](https://github.com/Saurono/knowledge-workspace/actions/runs/42991687625)；矩阵原引用 `976670d` 的 42987214141 也是历史绿。工作流还存在重复的 “Check shared HTTP and persistence” 步骤，待 CI 修复时审查，不能用删检查掩盖失败。本轮只记录，不修代码或工作流。

## 各系列当前范围

| 范围 | 已有实现/证据 | 剩余条件 |
| --- | --- | --- |
| B07c / I02 | 共享资源 API、CLI/MCP、注册表、漂移测试、记忆只读与提案工具；registry 当前含 cli-tool 11、cli-special 1、mcp-tool 12、route 8 | 不能把注册表等同完整文档注册/修订/来源链；共享任务执行器及完整外部调用验收仍缺 |
| E02–E04 / E08 | Rust Agent retrieval scope、Wiki provenance/贡献模型和写入接线、桌面 WikiAuthorshipView、共享作者上下文与时间测试 | 原检查能力逐入口可达性、受限检索旁路与引用、Web 作者展示、全入口矩阵和真实链路仍需完成验收 |
| E05–E07 | wiki/domain/writeback.ts 和 application/writeback.ts 的结构、幂等、版本与冲突规则已有测试 | createWritebackDraftService 仅在应用层定义和测试引用；缺产品 journal/发布编排、UI/服务接线、同 Wiki CAS 发布、授权重验与发布失败独立重试。记忆 write_proposals 不等同 Wiki 回流 |
| F03–F09 | 规范记忆/迁移/生命周期/修订、共享授权、CAS/幂等、召回与写入提案、摘要/冲突 UI | F02 正式分类未定；全入口 Agent 强制审批、完整管理/审计操作和真实多 Agent 端到端未验收，不勾总项 |
| G02–G05 | bodies/render-plan/level-of-detail、授权关系图端口与 Web 星图；真 Edge 的 8 节点与返回修复有证据 | 语义映射全覆盖、真实视觉品质、大图性能、无图形降级与桌面联动未全面验收 |
| G06–G07 | 现有样式与功能控件存在 | 网页信息层级、布局、设计系统、响应式、键盘/对比度/低动态仍待专项改进验收 |
| H02–H06 | task protocol、journal、queue/scheduler、task-pipeline、adopt、旧队列镜像与去重 | 镜像执行权仍在旧队列；不能声称真实入库执行器跨进程恢复或全部任务行为已验收 |
| I01 / I03 / I04 | CLI 适配契约、既有子进程/工具入口；令牌吊销/过期/权限等自动测试 | 本机真实 Claude/Codex 登录调用、产出关联、断线/取消及当前 CLI/MCP 冒烟仍待验收 |
| J01–J06 | 运维/使用手册、HTTP 导入导出与清理证据、CI 安装包产物 | 当前 CI 红；MSI/NSIS/portable 属 dc40efa 的旧产物，未安装/启动；全量备份恢复、部署、真实模型与发布整理未完成 |
| K01–K08 | 检索契约基线、FTS5、索引一致性、记忆提案、model-gateway/用量、安装包和生命周期接口已有不同程度实现 | 不回填历史授权；逐项列剩余真实质量、共享向量、全入口写门、预算接线、安装启动与完整备份恢复缺口 |

## 网页设计诊断与工具建议

视觉依据为仓库 2026-11-11 真 Edge 截图 `evidence/ui-20261111/03-workspace.png`，并核对 `src/web/workspace.tsx`、`src/web/styles.css`；本次没有启动实时网页。

- 项目管理、身份/权限说明占据首屏大量空间，核心 Wiki 阅读编辑被推到下方。
- 导航、导入导出、连接状态与筛选混排，主次动作缺少层级；长权限字符串增加视觉噪声。
- 大边框面板层层堆叠，列表和编辑区比例、文字尺度、间距缺乏统一规则；当前 G06/G07 不能标完成。
- 建议先设计固定应用框架：左侧主导航、顶部紧凑项目/身份切换、中心资源列表与阅读编辑区、按需展开的详情面板；导入导出归入项目菜单，权限细节按需展开。保留身份与连接状态的必要可见性。
- 建立颜色、字号、间距、控件高度、空态/加载/错误态规范，先做 Wiki、记忆库、星图三页原型，再实施和多尺寸浏览器验收。深空风格需求沿用，但正文区域优先可读性。

本次通过 skill-installer 的官方目录查询确认有 figma、figma-generate-design、figma-create-design-system-rules、figma-implement-design、playwright-interactive 等可安装技能；未安装。插件目录查询确认 Product Design、Figma、MagicPath 可用但未连接，已建议 Product Design 与 Figma。前者适合流程/布局审查与原型，后者适合设计系统、可编辑设计与代码实现；Playwright 类技能用于浏览器交互和多尺寸验证，不能自动保证美感。未使用第三方服务上传本项目或凭据。

## 下一工作顺序

1. 先修当前 CI 的两项代码/测试漂移并重跑 Ubuntu；以新候选提交三平台全绿作为基础门槛。
2. 网页设计专项归入 G06/G07：设计框架与三页原型、实现、浏览器验证；发布矩阵单独记录视觉与响应式验收，不能用“星图能显示”代替。
3. 收口 E05–E07 的 Wiki 回流产品接线、H 的执行器恢复、真实 CLI/模型及安装启动；逐项更新矩阵，不扩大已完成定义。
