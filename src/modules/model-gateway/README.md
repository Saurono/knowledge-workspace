# 模型网关（model-gateway）

模型调用的**统一入口与记账层**。调用方只跟这里打交道：预算不够就拒绝、失败按错误码分流、每次调用落一行用量记录。它不自己发 HTTP，也不认识具体厂商——真正发请求的是注入进来的 `EmbeddingPort` / 调用方自己的客户端。

## 公开入口

- 根 `index.ts`：`createModelGateway`、错误类型与全部公开类型。
- `application/index.ts`：网关实现与其依赖端口。
- `domain/index.ts`：`GatewayError`、用量记录形状。

依赖见 `module.json`；模块不读 Store、不碰文件系统、不 import React。

## 契约

- **预算**：`budget.remaining()` 为 0 时**直接抛 `quota_exceeded`，一个请求都不发**。
- **降级**：只有调用方显式传入 `fallback` 才降级；不会"悄悄换模型"。
- **网络失败**：映射成 `network_unavailable`，**仍然写一行 `failed` 用量记录**（失败也要留痕）。
- **未知 token**：usage 里没有 token 数就记 `null`，**不记 0**（0 会被误当成"确实花了 0"）。
- **批量**：一次批量调用只落**一条**用量记录，不按元素条数重复记。

## 与调用点的关系

- `src/app/retrieval/metered-embedding.ts` 把本模块包在 embedding 单例外面（K05-B）。
- `src/lib/chat-usage.ts` + `src/app/model-usage/chat-sink.ts` 负责 chat 侧的记账落盘（K05-C）。
- 用量记录写盘在 `src/app/model-usage/`，一条记录一个 JSON 文件（`<root>/.llm-wiki/model-usage/<id>.json`）。

## 验证

```powershell
node_modules/typescript/bin/tsc --build
node_modules/vitest/vitest.mjs run src/modules/model-gateway src/app/model-usage
npm run check:modules
```

`application/gateway.test.ts` 覆盖：预算超限不发请求、显式 fallback 才降级、网络失败仍写 failed、未知 token 记 null、批量只记一次。
