import { afterAll, beforeAll, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { SHARED_CLI_TOOLS } from "@/modules/cli/application/remote"
import { SHARED_TOOL_OPERATIONS } from "../mcp-server/src/shared-tools"
import { accountFixture } from "./testing"

interface Entry { id: string; kind: string; name?: string; operation?: string; method?: string; path?: string }
const registry = JSON.parse(readFileSync(new URL("../analysis/architecture/shared-api-surface.json", import.meta.url), "utf8")) as Entry[]
let f: Awaited<ReturnType<typeof accountFixture>>, cookie: string, projectId: string
beforeAll(async () => {
  f = await accountFixture()
  await f.bootstrap()
  cookie = (await f.login()).cookie
  projectId = (await f.json("/projects", "POST", { name: "共享接口漂移验证" }, cookie)).data.id
})
afterAll(async () => { await f?.close() })

it("CLI 清单与独立分流不漂移", () => {
  expect(registry.filter(row => row.kind === "cli-tool").map(row => row.name).sort()).toEqual([...SHARED_CLI_TOOLS].sort())
  expect(registry.filter(row => row.kind === "cli-special").map(row => row.name)).toEqual(["context.switch"])
})
it("MCP 名称与操作映射不漂移", () => {
  const rows = registry.filter(row => row.kind === "mcp-tool")
  expect(rows).toHaveLength(Object.keys(SHARED_TOOL_OPERATIONS).length)
  expect(Object.fromEntries(rows.map(row => [row.name, row.operation]))).toEqual(SHARED_TOOL_OPERATIONS)
})
it("注册路由真实存在", async () => {
  const proposal = (await f.json(`/projects/${projectId}/proposals`, "POST", { idempotencyKey: "surface", evidence: [{ source: "test", ref: "surface" }], target: { kind: "wiki", path: "wiki/surface.md", content: "surface", expectedRevision: null } }, cookie)).data.proposal
  for (const row of registry.filter(row => row.kind === "route")) {
    for (const method of row.method!.split("|")) {
      const path = row.path!.replace("/api/v1", "").replace(":id", projectId).replace(":proposalId", proposal.id)
      const response = await f.request(path, method, method === "GET" ? undefined : {}, cookie)
      expect(response.status, row.id + " " + method).not.toBe(404)
    }
  }
})
it("服务端接受九个资源操作、搜索与身份切换", async () => {
  for (const tool of SHARED_CLI_TOOLS.filter(tool => tool !== "search")) {
    const response = await f.request(`/projects/${projectId}/cli`, "POST", { tool }, cookie)
    expect(response.status, tool).not.toBe(501)
  }
  expect((await f.request(`/projects/${projectId}/cli`, "POST", { tool: "search", query: "x" }, cookie)).status).toBe(200)
  expect((await f.request(`/projects/${projectId}/contexts`, "POST", {}, cookie)).status).not.toBe(404)
})
