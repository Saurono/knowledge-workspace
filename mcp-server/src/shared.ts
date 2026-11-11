#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { VERSION } from "./version.js"
import { SHARED_TOOL_OPERATIONS } from "./shared-tools.js"
/** Shared account mode is a separate entry point; it never falls back to the desktop local API. */
export async function startSharedMcp() {
  const base = new URL(process.env.KW_API_URL ?? "http://127.0.0.1:4317"), token = process.env.KW_AGENT_TOKEN ?? ""
  if (base.pathname !== "/" || base.search || base.hash || base.username || base.password || (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))) throw new Error("Use an HTTPS service origin, or loopback HTTP")
  if (!/^kwt_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Set KW_AGENT_TOKEN in the process environment")
  let contextId = process.env.KW_ACCESS_CONTEXT
  const pinnedProject = process.env.KW_PROJECT_ID
  const server = new Server({ name: "knowledge-workspace-shared", version: VERSION }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: Object.entries(SHARED_TOOL_OPERATIONS).map(([name, operation]) => ({ name, description: `Authorized shared operation: ${operation}. wiki.write requires expectedRevision (null creates).`, inputSchema: { type: "object" as const, properties: { projectId: { type: "string" }, path: { type: "string" }, content: { type: "string" }, expectedRevision: { type: ["number", "null"] }, query: { type: "string" }, topK: { type: "number" }, workRoleId: { type: ["string", "null"] }, effectiveAccountId: { type: "string" }, delegationId: { type: ["string", "null"] }, cursor: { type: "string" }, limit: { type: "number" } }, additionalProperties: false } })) }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const operation = SHARED_TOOL_OPERATIONS[request.params.name], input = request.params.arguments ?? {}, project = input.projectId ?? pinnedProject
      if (!operation || typeof project !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(project) || (pinnedProject && project !== pinnedProject)) throw new Error("Unknown tool or project outside the pinned scope")
      const captured = contextId, switching = operation === "context.switch"
      const response = await fetch(`${base.origin}/api/v1/projects/${encodeURIComponent(project)}/${switching ? "contexts" : "mcp"}`, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(!switching && captured ? { "X-KW-Context": captured } : {}) }, body: JSON.stringify({ ...input, ...(!switching ? { tool: operation } : {}) }) })
      const body = await response.json() as { data?: { id?: string }; error?: { message?: string } }
      if (!response.ok) throw new Error(body.error?.message ?? `Service request failed (${response.status})`)
      if (switching) contextId = body.data?.id
      return { content: [{ type: "text", text: JSON.stringify(body.data) }] }
    } catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Shared MCP request failed" }] } }
  })
  await server.connect(new StdioServerTransport())
}
void startSharedMcp().catch(() => { console.error("Shared MCP startup failed; check service origin and Agent Token environment"); process.exitCode = 1 })
