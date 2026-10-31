import { expect, it } from "vitest"
import { buildWorkspaceScene } from "./workspace-scene"
import type { MemoryRecord } from "@/modules/memory/domain"
const memory = (id: string, domain: string, relatedIds: string[]): MemoryRecord => ({ id, title: id, content: id, category: "fact", domainIds: [domain], relatedIds, createdAt: "time", updatedAt: "time" })
const labels = { uncategorized: "other", type: (type: string) => type }
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
