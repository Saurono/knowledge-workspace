import { describe, expect, it } from "vitest"
import {
  DEFAULT_SEA_CAMERA,
  layoutSea,
  projectSea,
  visibleSeaEdges,
  type SeaPoint,
} from "./memory-sea-scene"
const points: SeaPoint[] = [
  { id: "a", title: "A", text: "A", group: "One", color: "#96beff", weight: 1 },
  { id: "b", title: "B", text: "B", group: "Two", color: "#82e6c8", weight: 2 },
  { id: "c", title: "C", text: "C", group: "One", color: "#96beff", weight: 1 },
]
describe("memory sea scene", () => {
  it("lays out stable 3D coordinates without mutating or duplicating graph records", () => {
    const before = JSON.stringify(points)
    const normal = layoutSea(points)
    const reversed = layoutSea([...points].reverse())
    expect(normal).toHaveLength(points.length)
    expect(JSON.stringify(points)).toBe(before)
    for (const point of normal) {
      expect(reversed.find((p) => p.id === point.id)).toEqual(point)
      expect([point.x, point.y, point.z].every(Number.isFinite)).toBe(true)
    }
    expect(new Set(normal.map((p) => p.z)).size).toBeGreaterThan(1)
  })
  it("projects against the component viewport and supports independent orbit and zoom", () => {
    const point = { x: 100, y: 50, z: 150 }
    const start = projectSea(point, DEFAULT_SEA_CAMERA, 1000, 600)
    const resized = projectSea(point, DEFAULT_SEA_CAMERA, 1200, 800)
    expect(resized.x - start.x).toBeCloseTo(100)
    expect(resized.y - start.y).toBeCloseTo(100)
    expect(projectSea(point, { ...DEFAULT_SEA_CAMERA, yaw: 1 }, 1000, 600).x).not.toBe(start.x)
    expect(
      projectSea(point, { ...DEFAULT_SEA_CAMERA, distance: 600 }, 1000, 600).scale,
    ).toBeGreaterThan(start.scale)
  })
  it("removes dangling, duplicate and self edges when switching or filtering datasets", () => {
    expect(
      visibleSeaEdges(points, [
        { source: "a", target: "b", weight: 1 },
        { source: "b", target: "a", weight: 2 },
        { source: "a", target: "missing", weight: 1 },
        { source: "a", target: "a", weight: 1 },
      ]),
    ).toEqual([{ source: "a", target: "b", weight: 1 }])
    expect(
      visibleSeaEdges(
        points.filter((p) => p.id !== "b"),
        [{ source: "a", target: "b", weight: 1 }],
      ),
    ).toEqual([])
  })
})
