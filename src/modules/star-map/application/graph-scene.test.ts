import { describe, expect, it } from "vitest"
import type { MemoryGraphNode } from "@/modules/service-api/domain"
import { seaColor } from "../domain"
import { buildGraphScene, type GraphSceneInput } from "./graph-scene"

const node = (id: string, patch: Partial<MemoryGraphNode> = {}): MemoryGraphNode => ({
  id, title: `Title ${id}`, status: "active", category: "notes", domainIds: [],
  relations: [], updatedAt: "2026-11-10T00:00:00Z", owner: null, ...patch,
})
const relation = (targetId: string) => ({ type: "related", targetId })
const scene = (nodes: readonly MemoryGraphNode[], patch: Partial<GraphSceneInput> = {}) =>
  buildGraphScene({ nodes, domain: "", query: "", now: "2026-11-10T00:00:00Z",
    labels: { uncategorized: "Uncategorized" }, ...patch })

describe("buildGraphScene", () => {
  it("maps three nodes and two edges with category text and body aesthetics", () => {
    const result = scene([node("a", { relations: [relation("b")] }),
      node("b", { relations: [relation("c")] }), node("c")])
    expect(result.points).toHaveLength(3)
    expect(result.edges).toHaveLength(2)
    expect(result.total).toBe(3)
    expect(result.totalEdges).toBe(2)
    expect(result.points.every(point => point.text === "notes")).toBe(true)
    expect(result.points[0]).toMatchObject({ body: "moon", size: 1, brightness: 0.6, weight: 1.3 })
    expect(result.points[0]).not.toHaveProperty("createdAt")
  })

  it("filters by domain and removes links to excluded nodes", () => {
    const result = scene([node("a", { domainIds: ["work"], relations: [relation("b")] }),
      node("b", { domainIds: ["home"] })], { domain: "work" })
    expect(result.points.map(point => point.id)).toEqual(["a"])
    expect(result.edges).toEqual([])
  })

  it("searches only titles case insensitively, ignoring category and extra body content", () => {
    const withBody = { ...node("a", { category: "secret" }), content: "secret body keyword" }
    expect(scene([withBody], { query: "secret" }).points).toEqual([])
    expect(scene([withBody], { query: "tItLe A" }).points).toHaveLength(1)
  })

  it("clips missing endpoints and deduplicates reverse and repeated relations", () => {
    const result = scene([node("a", { relations: [relation("missing"), relation("b"), relation("b")] }),
      node("b", { relations: [relation("a")] })])
    expect(result.edges).toEqual([{ source: "a", target: "b", weight: 1 }])
  })

  it("removes self loops", () => {
    expect(scene([node("a", { relations: [relation("a")] })]).edges).toEqual([])
  })

  it.each(["", null])("uses the uncategorized label and color for category %s", category => {
    expect(scene([node("a", { category })]).points[0]).toMatchObject({
      group: "Uncategorized", color: seaColor("Uncategorized"), text: "",
    })
  })

  it("samples 12000 nodes in overview tier within the default budget", () => {
    const result = scene(Array.from({ length: 12000 }, (_, index) => node(String(index))))
    expect(result.lod.tier).toBe("overview")
    expect(result.points.length).toBeLessThanOrEqual(4000)
    expect(result.total).toBe(12000)
    expect(result.lod).toMatchObject({ rendered: result.points.length, total: 12000, stride: 4 })
  })

  it("prioritizes latest timestamp then ascending id without mutating input", () => {
    const nodes = [node("z"), node("b", { updatedAt: "2026-11-11T00:00:00Z" }),
      node("a", { updatedAt: "2026-11-11T00:00:00Z", relations: [relation("z")] })]
    const before = JSON.stringify(nodes)
    const result = scene(nodes, { maxPoints: 1 })
    expect(result.points.map(point => point.id)).toEqual(["a"])
    expect(result.edges).toEqual([])
    expect(result.totalEdges).toBe(0)
    expect(result.total).toBe(3)
    expect(JSON.stringify(nodes)).toBe(before)
  })
})
