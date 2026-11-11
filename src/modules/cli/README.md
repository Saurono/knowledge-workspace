# CLI

- `domain`：Claude 流式协议、结构化错误和诊断缓冲，Codex 行协议与提示词转义；协议消息/能力模型无平台依赖。
- `application`：独立 Claude/Codex 会话 transport，经进程/事件/CWD/ID 端口注册监听、启动进程、等待完成及取消；能力服务经 detect 端口查询安装状态。工作目录在任何异步注册前绑定，避免切换项目后启动到错误目录；完成后忽略迟到 token。
- `app/cli`：Tauri 命令/事件与 Store 的唯一适配；保持旧 LlmConfig、StreamCallbacks 调用签名。设置页通过能力服务检测，旧 lib transport 保留兼容导出。

保留先监听后启动、结构化错误优先、无输出显式失败、隔离本地配置、Codex 超时和取消/启动竞态下再次 kill 的规则。监听注册/原生 spawn 本身不保证立即中断；共享进程/跨客户端授权和原生沙箱仍是后续工作。

契约测试通过可控进程和事件端口验证调用时 CWD 与迟到事件；旧 transport 测试验证所有原生命令参数、完成等待和错误路径。当前没有实际启动用户本机 CLI，也没有运行 Rust 原生测试。

契约索引：
[I01 本机 CLI / Agent 适配契约](../../../analysis/implementation/cli-agent-contract-20261111.md)。
调用链、能力探测、错误分类、扩展要求与验证缺口以该文档为准。
README 只留索引，不作为完整契约。
