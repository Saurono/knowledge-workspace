import { expect, it } from "vitest"
import { CELESTIAL_BODIES, bodyAesthetics, bodyForMemory } from "./bodies"
import type { MemoryBodyInput } from "./bodies"

const base: MemoryBodyInput = {
  status: "active", importance: null, credibility: null, relationCount: 0,
  now: "2026-11-10T00:00:00.000Z",
}

it.each([
  [{ importance: 0.7 }, "star"],
  [{}, "planet"],
  [{ relationCount: 1 }, "moon"],
  [{ validityUntil: "2026-11-09T00:00:00.000Z" }, "comet"],
  [{ relationCount: 3 }, "nebula"],
  [{ status: "archived" }, "remnant"],
] as const)("maps %j to %s", (input, expected) => {
  expect(bodyForMemory({ ...base, ...input })).toBe(expected)
})

it.each(["archived", "superseded", "expired"])("prioritizes historical status %s", status => {
  expect(bodyForMemory({ ...base, status, importance: 0.9, relationCount: 5,
    validityUntil: "2026-11-09T00:00:00.000Z" })).toBe("remnant")
})

it("prioritizes lifespan, importance and relation thresholds in order", () => {
  expect(bodyForMemory({ ...base, validityUntil: "2026-12-10T00:00:00.000Z", importance: 0.9, relationCount: 3 })).toBe("comet")
  expect(bodyForMemory({ ...base, validityUntil: "2026-12-10T00:00:00.001Z", importance: 0.9, relationCount: 3 })).toBe("star")
  expect(bodyForMemory({ ...base, importance: 0.69, relationCount: 2 })).toBe("moon")
})

it("keeps importance and credibility axes independent", () => {
  const lowTrust = bodyAesthetics({ ...base, importance: 0.9, credibility: 0.1 })
  const highTrust = bodyAesthetics({ ...base, importance: 0.9, credibility: 0.9 })
  expect(lowTrust.size).toBe(highTrust.size)
  expect(lowTrust.brightness).not.toBe(highTrust.brightness)
  const lowImportance = bodyAesthetics({ ...base, importance: 0.1, credibility: 0.5 })
  const highImportance = bodyAesthetics({ ...base, importance: 0.9, credibility: 0.5 })
  expect(lowImportance.brightness).toBe(highImportance.brightness)
  expect(lowImportance.size).not.toBe(highImportance.size)
  expect(lowTrust.size).toBeCloseTo(0.8 + 0.9 * 1.6)
  expect(lowTrust.brightness).toBeCloseTo(0.35 + 0.1 * 0.65)
})

it("uses neutral defaults for null scores", () => {
  expect(bodyAesthetics(base)).toEqual({ body: "planet", size: 1, brightness: 0.6 })
})

it("exports six distinct bodies", () => {
  expect(CELESTIAL_BODIES).toHaveLength(6)
  expect(new Set(CELESTIAL_BODIES).size).toBe(6)
})
