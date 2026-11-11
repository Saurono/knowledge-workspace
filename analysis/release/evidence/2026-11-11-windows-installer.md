# 证据：Windows 安装包（2026-11-11，CI 产出）

**来源**：GitHub Actions `Build & Release`（`workflow_dispatch`，ref = `codex/knowledge-workspace-v0.1`），run [42971789528](https://github.com/Saurono/knowledge-workspace/actions/runs/42971789528)，job `build (windows-latest)` = **success**。

**为什么这么做**：本机没有 MSVC Build Tools，`tauri build` 在本机做不了（`link.exe returned an unexpected error`）。CI 的 Windows runner 自带工具链，所以用 `workflow_dispatch` 出产物——该模式下 workflow **不发布 Release**，只产出 bundle 文件。

## 产物（`bundle-windows-latest`，112.11 MB）

| 文件 | 大小 | SHA256 |
| --- | --- | --- |
| `LLM-Wiki-0.6.13-windows-x64-portable.zip` | 43.1 MB | `D393473B530125601117D5D6BF552996697C1DFF7D77B28C02C6E4FE3B73ADC1` |
| `LLM Wiki_0.6.13_x64_en-US.msi` | 42.27 MB | `080E8037E352EFC03B999E1F441EB97A3DC5A7E88AEC9AB923B07C5A07E61112` |
| `LLM Wiki_0.6.13_x64-setup.exe`（NSIS） | 28.23 MB | `BFD568694ADBEB3CFFFCCB1738B767E37E1C0B664F0939904C89FE470C515C41` |

版本号 **0.6.13**。Windows 便携包内 3791 个条目，含 `mcp-server/dist/...`（含新的 `shared-tools.js`）、前端资源与可执行文件。

**签名**：`LLM Wiki_0.6.13_x64-setup.exe` 的 Authenticode 状态 = **NotSigned**。安装时 Windows 会弹 SmartScreen 提示，这是预期行为，不是缺陷。

## 验证到哪一步

- ✅ 产物确实由 CI 从 `dc40efa` 这个提交构建出来（同一 run 的 ubuntu 两条也 success）。
- ✅ 文件可下载、压缩包可打开、条目结构正常。
- ❌ **没有安装**（会改系统、需要管理员）；❌ **没有启动**；❌ 没验证数据目录与端口行为；❌ 没有代码签名证书。

所以「安装包」这条在验收矩阵里只能算**产物已产出**，不能算「已验收」。

## 复现

```powershell
gh workflow run build.yml -R Saurono/knowledge-workspace --ref codex/knowledge-workspace-v0.1
gh api repos/Saurono/knowledge-workspace/actions/runs/<run-id>/artifacts
gh run download <run-id> -R Saurono/knowledge-workspace -n bundle-windows-latest -D <目录>
```
