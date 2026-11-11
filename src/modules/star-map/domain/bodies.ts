export const CELESTIAL_BODIES = ["star", "planet", "moon", "comet", "nebula", "remnant"] as const
export type CelestialBody = typeof CELESTIAL_BODIES[number]

export interface MemoryBodyInput {
  status: "candidate" | "active" | "superseded" | "expired" | "archived" | string
  importance: number | null
  credibility: number | null
  validityUntil?: string
  relationCount: number
  now?: string
}

export function bodyForMemory(input: MemoryBodyInput): CelestialBody {
  // Priority: historical status > lifespan <= 30 days > importance >= 0.7
  // > at least 3 relations > at least 1 relation > default planet.
  if (["archived", "superseded", "expired"].includes(input.status)) return "remnant"
  if (input.validityUntil &&
      Date.parse(input.validityUntil) <= Date.parse(input.now ?? new Date().toISOString()) + 30 * 24 * 60 * 60 * 1000) return "comet"
  if (input.importance !== null && input.importance >= 0.7) return "star"
  if (input.relationCount >= 3) return "nebula"
  if (input.relationCount >= 1) return "moon"
  return "planet"
}

const sizeForImportance = (importance: number | null): number =>
  importance === null ? 1 : 0.8 + importance * 1.6
const brightnessForCredibility = (credibility: number | null): number =>
  credibility === null ? 0.6 : 0.35 + credibility * 0.65

export function bodyAesthetics(input: MemoryBodyInput): { body: CelestialBody; size: number; brightness: number } {
  return {
    body: bodyForMemory(input),
    size: sizeForImportance(input.importance),
    brightness: brightnessForCredibility(input.credibility),
  }
}
