export interface SharedCliTransport { request(path: string, body: Record<string, unknown>, contextId?: string): Promise<unknown> }
/** CLI 与共享 MCP 共用的操作白名单；单一来源，测试从这里取清单。 */
export const SHARED_CLI_TOOLS = ["wiki.list", "wiki.read", "wiki.write", "documents.list", "memory.list", "memory.summaries", "memory.graph", "memory.conflicts", "search", "proposal.submit", "proposal.list"] as const
/** Remote CLI/MCP share the same guarded resource API; caller arguments never become an identity. */
export function createRemoteCli(transport: SharedCliTransport) {
  return {
    execute(projectId: string, operation: string, input: Record<string, unknown>, contextId?: string) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(projectId)) throw new Error("A shared project identifier is required")
      const root = `/api/v1/projects/${encodeURIComponent(projectId)}`
      if (operation === "context.switch") return transport.request(`${root}/contexts`, input)
      if (!(SHARED_CLI_TOOLS as readonly string[]).includes(operation)) throw new Error("Unsupported shared resource operation")
      return transport.request(`${root}/cli`, { ...input, tool: operation }, contextId)
    },
  }
}
