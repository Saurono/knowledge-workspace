import { expect, it, vi } from "vitest"
import { createWikiGraphQuery, type WikiGraphPorts } from "./wiki-graph"
function ports(label: string): WikiGraphPorts {
  return { read: vi.fn(async () => `# ${label}`), list: vi.fn(async () => [{ name: "a.md", path: "/p/wiki/a.md", is_dir: false }]), normalizePath: path => path, parseFrontmatter: () => ({ frontmatter: null }), retrieval: vi.fn(async (_path, version) => ({ nodes: new Map(), dataVersion: version })), relevance: () => 1, analyze: async () => ({ assignments: new Map(), communities: [] }), fallback: () => ({ assignments: new Map(), communities: [] }) }
}
it("isolates caches between query instances and enriches against the requested version", async () => {
  const firstPorts = ports("First"), secondPorts = ports("Second")
  const first = createWikiGraphQuery(firstPorts), second = createWikiGraphQuery(secondPorts)
  const [a, b] = await Promise.all([first.buildWikiGraph("/p", 7), second.buildWikiGraph("/p", 8)])
  expect(a.nodes[0].label).toBe("First"); expect(b.nodes[0].label).toBe("Second")
  await first.buildWikiGraph("/p", 7)
  expect(firstPorts.list).toHaveBeenCalledOnce()
  expect(firstPorts.retrieval).toHaveBeenCalledWith("/p", 7)
  expect(secondPorts.retrieval).toHaveBeenCalledWith("/p", 8)
})
