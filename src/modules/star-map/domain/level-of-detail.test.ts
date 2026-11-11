import { expect, it } from "vitest"
import { canvasAvailable, planLevelOfDetail, samplePoints } from "./level-of-detail"

it.each([
  [2000, "full", 1, false], [2001, "sampled", 2, false],
  [8000, "sampled", 2, false], [8001, "overview", 4, true],
] as const)("plans the boundary %i", (total, tier, stride, clusterEdges) => {
  expect(planLevelOfDetail({ total })).toEqual({ tier, stride, maxPoints: 4000, clusterEdges })
})
it("samples deterministically without mutating input and retains its priority first point", () => {
  const points = Array.from({ length: 20000 }, (_, i) => ({ id: String(20000 - i) }))
  const before = JSON.stringify(points)
  const plan = planLevelOfDetail({ total: points.length })
  const result = samplePoints(points, plan)
  expect(JSON.stringify(result)).toBe(JSON.stringify(samplePoints(points, plan)))
  expect(JSON.stringify(points)).toBe(before)
  expect(result.length).toBeLessThanOrEqual(plan.maxPoints)
  expect(result).toContain(points[0])
})
it("honors custom caps including zero and handles empty input", () => {
  const points = [{ id: "z" }, { id: "a" }, { id: "b" }]
  expect(samplePoints(points, planLevelOfDetail({ total: 3, maxPoints: 1 }))).toEqual([points[0]])
  expect(samplePoints(points, planLevelOfDetail({ total: 3, maxPoints: 0 }))).toEqual([])
  expect(samplePoints([], planLevelOfDetail({ total: 0 }))).toEqual([])
})
it("samples sorted IDs at the planned stride after retaining the first point", () => {
  const points = ["z", "d", "b", "c", "a"].map(id => ({ id }))
  expect(samplePoints(points, planLevelOfDetail({ total: 2001 })).map(p => p.id)).toEqual(["z", "a", "c"])
})
it("returns false without a target", () => expect(canvasAvailable(undefined)).toBe(false))
it("returns false when element creation throws", () => {
  expect(canvasAvailable({ createElement: () => { throw new Error("unavailable") } })).toBe(false)
})
it("returns false for a null 2D context", () => {
  expect(canvasAvailable({ createElement: () => ({ getContext: () => null }) })).toBe(false)
})
it("accepts a nonempty 2D context and uses the supplied target", () => {
  expect(canvasAvailable({ createElement: tag => {
    expect(tag).toBe("canvas")
    return { getContext: id => { expect(id).toBe("2d"); return {} } }
  } })).toBe(true)
})
