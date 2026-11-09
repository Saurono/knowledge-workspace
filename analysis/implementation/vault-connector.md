# 共享 Web 的本机 Vault 回执同步

连接器只将共享项目的独立 JSON 回执写到本机 Vault 的 `kb-ingest-records`。它不会修改笔记，也不会把整个 Vault 上传到共享服务。运行前显式选择项目与已有 `.obsidian` 目录的 Vault。

## 本机启动与网页配对

先构建共享服务：`node scripts/build-service.mjs`。在本机 PowerShell 设置下面的运行环境。示例地址和路径需要替换成自己的实际值，Token 由有权管理该项目的人员为 Connector Agent 签发，范围至少含 `project.read`、`documents.read`。不要把 Token 发到聊天、网页表单或 Git。

```powershell
$env:KW_API_URL = 'http://127.0.0.1:4317'
$env:KW_VAULT_CONNECTOR_ORIGIN = 'http://127.0.0.1:4317'
$env:KW_PROJECT_ID = '<共享项目 ID>'
$env:KW_VAULT_PATH = 'C:\Path\To\YourVault'
$env:KW_AGENT_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host 'Connector Agent Token（仅本机）' -AsSecureString)).Password
$env:KW_VAULT_CONNECTOR_PORT = '4319'
node dist-service/vault-connector.mjs
```

Origin 必须与浏览器地址栏的协议、主机、端口完全一致，不包含路径。连接器只监听 `127.0.0.1`，短时一次性配对码显示在本机控制台。在共享页面的“文档”页填写连接器端口和配对码，确认显示正确项目后同步回执。网页只在内存中保留配对会话；切换项目、身份或端口、退出页面及主动撤销会清理会话。过期后重新启动连接器获取新码。

服务凭据的项目、权限、时效与吊销仍在每次同步时检查。网页配对不替代共享服务授权，也不能选择新的本机路径。停止连接器或撤销配对不会撤销共享服务 Agent Token；不再使用时应另外吊销该 Token。

## 浏览器不能连接本机时

浏览器的 HTTPS、混合内容或本地网络访问策略可能阻止连接。不要关闭浏览器安全策略或配置通配 CORS。可以在已设置上述运行环境的本机终端显式拉取一个已有文档的回执：

```powershell
$env:KW_DOCUMENT_ID = '<共享文档 ID>'
$env:KW_VAULT_CONNECTOR_PORT = '0'
node dist-service/vault-connector.mjs --pull
```

该命令使用本机环境中的共享服务凭据，完成受保护读取、独立 JSON 写入与读回核验后退出；成功仅输出回执 ID 和摘要，失败返回非零状态。文档 ID 可以从上传响应或受保护的文档列表中取得。此模式不需要网页访问本机。

## 结果与故障

上传只有接收证据时，回执的解析、编译、索引仍保持相应未完成状态；同步成功不等于知识已入库或索引可用。Vault 不可用、权限被吊销、文档不存在、回执超限或读回校验失败时，不返回已交付。恢复 Vault 或权限后可以明确重试。

HTTP 共享页面的配对、同步、撤销、凭据不持久化和本机 pull 已有真实 Edge 浏览器与临时服务验收。公网 HTTPS 到 loopback 的兼容性不能由该 HTTP 验收推断，受限环境使用上面的本机 pull。
