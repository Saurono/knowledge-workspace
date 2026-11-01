# 本地与 Web 能力边界

domain 定义本地项目/事件/Shell 结果、相对路径规则和增量 SSE 帧解析。application 的本地能力服务捕获不可变项目，注入文件、监听、Shell 和 Vault 端口；监听按项目筛选并响应取消，Shell 需要显式确认。

`app/platform/local` 适配现有原生文件/监听和 Obsidian 服务，协调单个原生 watcher 的所有者，迟到停止不能关闭新所有者。新增 Rust platform_shell_exec 只桥接已有 Agent ToolRegistry 的 shell.exec，不复制进程执行引擎。确认标志是本地交互前提，不是 C07/C09 的账号授权机制。

`app/platform/web` 使用共享 API、二进制上传和带 Authorization 的 fetch SSE；断线按持久序号恢复，项目切换/卸载取消旧连接。Web 无本机桥接时明确拒绝本机文件/Shell/Vault，不把服务器文件目录或预览模拟当作用户机器。

`app/platform/remote-workspace` 将 memory/domains 服务接到带条件版本的 HTTP 仓储；基于已加载版本保存，不偷偷重读后覆盖冲突。独立 Web 入口复用受控记忆/领域 UI，页面只读写 API；不伪造 Tauri 内部对象。

Node/浏览器/端口测试覆盖真实上传、持久化事件重放、工作区冲突、项目监听隔离、未确认 Shell、SSE 分块和元数据失败清理。Rust 新桥接在当前无 cargo 环境尚未编译/真机验收；真实 watcher/Shell/Vault 验收仍需本机环境。
