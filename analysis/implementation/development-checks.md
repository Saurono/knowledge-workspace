# 开发检查与委派约定

本机：Windows、PowerShell、Node.js 24。当前仓库从 HANDOFF 中的明确路径进入；先看 git status/remote/branch，不能在父目录的空仓库执行项目命令。

## 开始一个节点

1. 读取 HANDOFF 当前执行点、TASKS 对应节点及其固定契约；历史报告按需检索，不每轮全文重读。
2. 主控一次下发：输入/输出、允许文件、权限、并发、失败/恢复、旧数据与验收条件。跨模块接口先确定，再让 Luna 编码。
3. 不复制整段聊天给独立编码代理；提供基线 SHA、工作目录、必须读的少量文件和固定契约。只有独立文件边界才并行。
4. 代理完成节点后冻结 diff，报告真实命令/退出码/限制；主控集中审查，再给一批明确返修。独立验收测试本身先检查假设，不直接按红绿判断产品。

## 环境与命令

- 已有 node_modules 且 package-lock.json 没变化时不重复安装。需要安装时按锁文件 npm ci；依赖安装失败与代码检查失败分开记录。
- 本机无全局 npm，npm 已在项目外工具缓存可用：`pnpm --package=npm@11 dlx npm run <script>`。不要运行会整理 npm 安装树的 pnpm exec，不生成 pnpm-lock.yaml。
- 定向测试：`node node_modules/vitest/vitest.mjs run <指定路径> --exclude='**/mcp-server/**' --exclude='**/*.real-llm.test.ts'`。
- 正确类型检查：`node node_modules/typescript/bin/tsc --build --pretty false`。根 tsconfig 只有 references，不能用根目录 tsc --noEmit 代替项目检查。
- 边界：`node scripts/check-module-boundaries.mjs`。源清单/依赖/公开接口变化后主控生成 `node scripts/audit-modules.mjs`，再 `--check`，报告必须进入提交。
- MCP 自身是 Node test，使用其 npm test 脚本，不让根 Vitest 收集 mcp-server/test。

## 验证节奏

开发时跑能定位本节点行为的定向测试与必要类型检查。冻结后运行受影响集成；完整回归/构建在交付节点统一运行。发现新变更/失败或未解决风险再扩大/重跑，不省略必要验证，也不在代码没变化时反复全量跑。

工具日志存 TEMP，正常仅回传结果摘要，失败回传第一个有效错误及相关上下文；不把大量重复堆栈和整个构建日志反复送入对话。测试计算量与模型 Token 用量分开统计。

每个完成节点更新 WORKLOG/HANDOFF/TASKS，再提交到开发分支并推送。CI push 已覆盖开发分支；以对应 SHA 的真实 job 结果为证据，本地同口径通过不代替远端结果。

## 用量证据

目前协作工具没有返回完整 input/output/reasoning/cache usage。不能用代码字数、日志行数或文本 tokenizer 计数声称实际节省率。若后续平台提供用量，按“编码+返修+主控审查+验收”整项汇总；保留必要的人类/主控审查边界。
