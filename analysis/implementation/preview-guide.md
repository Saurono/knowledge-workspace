# 交互预览

浏览器预览入口：`/preview.html`。它复用产品 React 界面，使用独立的合成资料与模拟桌面接口，默认打开星海。

- `npm run dev:preview`：开发预览。
- `npm run build:preview`：生成 `dist-preview/preview.html`，界面脚本、样式和字体内联。
- 浏览器打开 HTML 可查看和编辑示例数据，修改仅保存于该标签页的 sessionStorage。“重置示例”会清除预览修改。
- 顶部导航：记忆星海、记忆库、Wiki、对话与搜索、任务管理器。
- 不读取本机磁盘、不调用模型或网页检索。Vault 连接和真实任务需要桌面环境或后续 Web 后端。
- 预览入口独立于正式 `index.html`，模拟原生接口不会进入正常产品入口。单文件构建插件仅在 demo 模式启用。

验证：开发地址和单文件静态地址均通过 Chromium 交互检查，包括星海旋转、记忆创建/保存、Wiki 模式切换、搜索与任务标签。单文件完成加载后将浏览器置为离线，操作仍通过，页面错误为 0。当前受管浏览器禁止直接访问 file URL，因此未在此环境直接验证 file 协议导航。

下载交付：`/workspace/artifacts/knowledge-workspace-preview.html`，约 9 MB。保留参考星海代码 MIT 许可。
