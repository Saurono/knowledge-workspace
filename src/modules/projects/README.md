# 项目与知识库

`domain/` 定义 WikiProject、稳定 ProjectIdentity、ProjectRegistry 与最近/上次项目偏好及纯规则；`application/` 提供 createProjectService 与身份、注册表、偏好仓储端口。

`app/projects` 使用本地 `.llm-wiki/project.json` 和 Tauri app-state.json 旧 key 装配仓储。身份读/建在同项目互斥锁内进行，新身份原子写入成功后才返回。写失败会显式抛出，不再返回原先未持久化的临时 ID。注册表与偏好更新在进程内串行，失败不会阻断后续更新。

旧 lib/project-identity、lib/project-store 的项目方法和 types/wiki 的 WikiProject 保留兼容导出；配置部分仍留在 project-store，待 settings 模块迁移。移动文件夹保留其项目 identity 文件即可由注册表更新到新路径。最近项目按规范化路径去重，仍最多十个；删除时同时清除匹配的上次项目指针。

此模块不提供账号、成员授权、跨进程事务或自动发现移动文件夹。偏好两个 key 的写入不是数据库事务。旧损坏身份按原行为重新初始化；完整备份/损坏恢复属于 J01。
