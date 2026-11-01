# 身份、认证与授权

领域层拥有 user/agent/admin、项目成员与工作角色、访问上下文及显式授权模型。应用层注入身份/密码/会话/Token/委托仓储与时钟、随机数、摘要端口。领域不依赖平台、UI 或其他模块。

C05–C09 已接入真实 Node HTTP/SQLite：随机盐口令散列、人员 Cookie、限流及失效，Agent 限项目/角色/权限/到期 Token，显式委托和不可变执行上下文。账号目录不保存凭据，密码/会话/Token 仅在独立表保存散列或摘要。初始化密钥只供首个管理员；项目资格与私有授权不因 admin 自动开放。

server/ 是持久化及加密适配，service-api 组合统一资源授权，所有共享客户端通过 HTTP/SDK，不直接读库。规则见 analysis/architecture/identity-permission-matrix.md 和 server-authorization.md。C10 将补齐共享 Web 管理/切换界面和持久审计查询；记忆业务分类/审核与实际共享执行器属于后续 F/H/I。
