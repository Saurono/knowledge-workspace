import { describe, expect, it } from "vitest"
import { CELESTIAL_BODIES, type CelestialBody } from "./bodies"
import { planBodyRender } from "./render-plan"

const plan = (body: CelestialBody | undefined, size = 1, brightness = 0.6,
  options = { reducedMotion: true, time: 0 }) =>
  planBodyRender({ body, size, brightness, weight: 3 }, options)

describe("body render plans", () => {
  const shapes = ["sparkle", "disc", "crescent", "comet", "cloud", "faint"]
  for (const [index, body] of CELESTIAL_BODIES.entries()) {
    it(`${body} has its shape and glow at least twice its core`, () => {
      const result = plan(body)
      expect(result.shape).toBe(shapes[index])
      expect(result.glowRadius).toBeGreaterThanOrEqual(result.coreRadius * 2)
    })
    it(`${body} core radius increases monotonically with size`, () => {
      for (const size of [0, 0.5, 1, 2])
        expect(plan(body, size + 0.5).coreRadius).toBeGreaterThanOrEqual(plan(body, size).coreRadius)
    })
    it(`${body} glow radius increases monotonically with size`, () => {
      for (const size of [0, 0.5, 1, 2])
        expect(plan(body, size + 0.5).glowRadius).toBeGreaterThanOrEqual(plan(body, size).glowRadius)
    })
    it(`${body} glow alpha increases monotonically with brightness`, () => {
      for (const brightness of [0, 0.25, 0.5, 0.75])
        expect(plan(body, 1, brightness + 0.25).glowAlpha)
          .toBeGreaterThanOrEqual(plan(body, 1, brightness).glowAlpha)
    })
    it(`${body} alpha stays visible and increases monotonically, including during pulses`, () => {
      for (const time of [0, 1800, 5600]) {
        const options = { reducedMotion: false, time }
        const low = plan(body, 1, 0, options).alpha
        const high = plan(body, 1, 1, options).alpha
        expect(low).toBeGreaterThanOrEqual(body === "remnant" ? 0.15 : 0.25)
        expect(high).toBeCloseTo(body === "remnant" ? 0.35 : 1)
        for (let step = 0; step <= 100; step++) {
          const alpha = plan(body, 1, step / 100, options).alpha
          expect(alpha).toBeGreaterThanOrEqual(low)
          expect(alpha).toBeLessThanOrEqual(high)
          if (step > 0) expect(alpha).toBeGreaterThanOrEqual(plan(body, 1, (step - 1) / 100, options).alpha)
        }
      }
    })
    it(`${body} reduced motion ignores time`, () => {
      expect(plan(body, 1, 0.6, { reducedMotion: true, time: 200 }))
        .toEqual(plan(body, 1, 0.6, { reducedMotion: true, time: 6000 }))
    })
    it(`${body} pulse remains within 0.12 of the static alpha`, () => {
      for (let time = 0; time < 10000; time += 200)
        expect(Math.abs(plan(body, 1, 0.6, { reducedMotion: false, time }).alpha - plan(body).alpha))
          .toBeLessThanOrEqual(0.12)
    })
  }
  it("preserves the distinguishing geometry and layer counts", () => {
    expect(plan("star").layers).toBe(3)
    expect(plan("planet").rings).toBe(1)
    expect(plan("moon").rings).toBe(0)
    expect(plan("moon").rimRadius).toBeGreaterThan(plan("moon").coreRadius)
    expect(plan("comet").glowRadius).toBeGreaterThan(plan("comet").coreRadius * 4)
    expect(plan("comet").rings).toBe(0)
    expect(plan("nebula").layers).toBe(4)
    expect(plan("nebula").rings).toBe(0)
    for (const body of CELESTIAL_BODIES.filter((body) => body !== "nebula")) {
      expect(plan("nebula").coreRadius).toBeLessThan(plan(body).coreRadius)
      expect(plan("nebula").glowAlpha).toBeLessThan(plan(body).glowAlpha)
    }
    expect(plan("remnant").rings).toBe(2)
    for (const brightness of [0, 0.5, 1])
      expect(plan("remnant", 1, brightness).alpha).toBeLessThan(plan("planet", 1, brightness).alpha)
  })
  it("defaults missing and unknown bodies to planet and missing aesthetics to 1 / 0.6", () => {
    expect(plan(undefined)).toEqual(plan("planet"))
    expect(plan("unknown" as CelestialBody)).toEqual(plan("planet"))
    expect(planBodyRender({ body: undefined, size: undefined, brightness: undefined, weight: 3 },
      { reducedMotion: true })).toEqual(plan("planet"))
  })
})
