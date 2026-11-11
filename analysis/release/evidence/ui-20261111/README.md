# 证据：Web 界面浏览器验收（2026-11-11 17:20，真 Edge）

**这是什么**：不是渲染快照、不是单测。用 Edge（`--headless=new` + CDP，连的是真实服务 `dist-service/server.mjs` 构建产物）真的**登录、点标签、点一条记忆、看星图**，逐步截屏。脚本：`C:\Users\D1761\Documents\Codex\tools\ui-acceptance.mjs`（仓库外）。

**环境**：预览服务 `http://127.0.0.1:4321/web.html`，数据目录 `.kw-ui-accept`，项目「UI 验收」（2 个 wiki 页、8 条记忆、1 对 `contradicts` 冲突、8 个图节点）。账号 `admin`。

**截图**（同目录）：

| 文件 | 说明 |
| --- | --- |
| `01-login.png` | 登录页 |
| `03-workspace.png` | 登录成功后：项目「UI 验收」、有效身份与权限、Wiki/文档/记忆库/星图/知识领域 五个标签、导出项目按钮、导入项目选择文件控件、事件连接"已连接" |
| `04-memories.png` | 记忆库：8 条记忆列表（标题 + 状态 `v1` + 分类）、搜索框、领域筛选、清理过期记忆按钮 |
| `05-conflict-detail.png` / `05-conflict-detail.txt` | 选中「构建时间 30 秒」后，右侧详情含 **冲突** 段，列出 `conflict-b / 构建时间 5 分钟` —— **摘要模式下的冲突块是真的渲染出来了**（走 `GET /memories/conflicts`） |
| `06-graph.png` | 星图：8 个节点按语义渲染成不同形态（核心结论是月牙形、卫星/行星是圆点）、连线、左下工具条（高亮焦点/标签/动态效果/复位）、底部操作提示 |
| `07-wiki.png` | Wiki 标签页：`导出项目` 按钮与 `导入项目` 文件选择控件都在 |

**它证明了什么**：

- Web 端能真登录、真加载项目数据；
- 记忆库在**摘要模式**下列表与详情都正常，**冲突块显示对方标题**；
- 星图页在真实浏览器里能渲染（不是只有单测）；工具栏与提示文案在；
- 导出/导入控件在页面上。

**它没证明什么（别当成通过这些）**：

- **没有点"导出项目"**（会触发下载，headless 下未验证落盘内容）；
- **没有走导入**（要文件选择器）；
- 没有桌面端（Tauri）界面的验收；
- 没有多账号/权限视角的界面验收；
- 结论只覆盖这一个项目、这一批数据。

**复现**：

```powershell
node scripts/build-service.mjs
$env:KW_SERVICE_PORT="4321"; $env:KW_SERVICE_WEB_ROOT="dist-web"; $env:KW_SERVICE_DATA="<临时目录>"; $env:KW_BOOTSTRAP_KEY="<至少24字符>"
node dist-service/server.mjs
# 播种（另开一个终端，同 KW_BOOTSTRAP_KEY）
node C:\Users\D1761\Documents\Codex\tools\seed-ui-acceptance.mjs
node C:\Users\D1761\Documents\Codex\tools\ui-acceptance.mjs <输出目录>
```
