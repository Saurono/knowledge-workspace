import { expect, it } from "vitest"
import { buildWorkspaceScene } from "./workspace-scene"
import { createMemoryRecord } from "@/modules/memory/domain"
const memory = (id: string, domain: string, relatedIds: string[]) => createMemoryRecord({ id, title: id, content: id, category: "fact", domainIds: [domain], relatedIds, createdAt: "time", updatedAt: "time" })
const labels = { uncategorized: "other", type: (type: string) => type }
it.each([[100, "full"], [9000, "overview"]] as const)("renders %i authorized memories with LOD %s", (count, tier) => {
  const memories = Array.from({ length: count }, (_, i) => memory(`node-${i}`, "one", [`node-${(i + 4) % count}`]))
  const result = buildWorkspaceScene({ mode: "memory", domain: "", query: "", projectPath: "/p", wikiNodes: [], wikiEdges: [], labels,
    data: { domains: [], resourceDomains: {}, memories } })
  expect(result.lod).toEqual({ tier, stride: count === 100 ? 1 : 4, rendered: result.points.length, total: count })
  expect(result.total).toBe(count)
  expect(result.points.length).toBeLessThanOrEqual(4000)
  if (count === 100) expect(result.points).toHaveLength(100)
  const ids = new Set(result.points.map(point => point.id))
  expect(result.edges.length).toBeGreaterThan(0)
  expect(result.edges.every(edge => ids.has(edge.source) && ids.has(edge.target))).toBe(true)
})
it("adds memory bodies with independent size and brightness", () => {
  const active = { ...memory("active", "one", []), importance: 0.9, credibility: 0.2, status: "active" as const, relations: [] }
  const archived = { ...active, id: "archived", status: "archived" as const }
  const result = buildWorkspaceScene({ mode: "memory", domain: "", query: "", projectPath: "/p", wikiNodes: [], wikiEdges: [], labels,
    now: "2026-11-10T00:00:00.000Z",
    data: { domains: [], resourceDomains: {}, memories: [active, archived] } })
  const point = result.points.find(point => point.id === "active")!
  expect(point.body).toBe("star")
  expect(point.size).toBeGreaterThan(1)
  expect(point.brightness).toBeLessThan(0.5)
  expect(result.points.find(point => point.id === "archived")?.body).toBe("remnant")
})
it("filters memory domains without showing edges to hidden memories", () => {
  const result = buildWorkspaceScene({ mode: "memory", domain: "one", query: "", projectPath: "/p", wikiNodes: [], wikiEdges: [], labels,
    data: { domains: [{ id: "one", name: "One" }], resourceDomains: {}, memories: [memory("a", "one", ["b"]), memory("b", "two", ["a"])] } })
  expect(result.points.map(point => point.id)).toEqual(["a"])
  expect(result.edges).toEqual([])
})
it("uses normalized project-relative domain keys for Wiki points", () => {
  const result = buildWorkspaceScene({ mode: "wiki", domain: "one", query: "topic", projectPath: "C:\\p", labels,
    data: { domains: [], memories: [], resourceDomains: { "wiki/a.md": ["one"] } },
    wikiNodes: [{ id: "a", label: "Topic", type: "concept", path: "C:\\p\\wiki\\a.md", linkCount: 2, community: 0 }, { id: "b", label: "Topic", type: "concept", path: "C:/p/wiki/b.md", linkCount: 2, community: 0 }],
    wikiEdges: [{ source: "a", target: "b", weight: 1 }],
  })
  expect(result.points.map(point => point.id)).toEqual(["a"])
  expect(result.edges).toEqual([])
})
