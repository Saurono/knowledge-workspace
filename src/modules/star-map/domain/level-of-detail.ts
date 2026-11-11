export interface LodPlan {
  tier: "full" | "sampled" | "overview"
  stride: number
  maxPoints: number
  clusterEdges: boolean
}

/** Rendering budgets only: <=2000 full, <=8000 sampled, otherwise overview. */
export function planLevelOfDetail(input: { total: number; maxPoints?: number }): LodPlan {
  const tier = input.total <= 2000 ? "full" : input.total <= 8000 ? "sampled" : "overview"
  return { tier, stride: tier === "full" ? 1 : tier === "sampled" ? 2 : 4,
    maxPoints: input.maxPoints ?? 4000, clusterEdges: tier === "overview" }
}

/** Preserve the first (priority) input point, then sample sorted IDs by index modulo stride.
 * No randomness or locale-dependent ordering; the rendering cap always applies.
 */
export function samplePoints<T extends { id: string }>(points: readonly T[], plan: LodPlan): T[] {
  const limit = Math.max(0, Math.floor(plan.maxPoints))
  if (!points.length || !limit) return []
  const sorted = [...points].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const result = [points[0]]
  for (let index = 0; index < sorted.length && result.length < limit; index++) {
    if (index % Math.max(1, plan.stride) === 0 && sorted[index] !== points[0]) result.push(sorted[index])
  }
  return result
}

/** Probe only the supplied target, including environments without a DOM. */
export function canvasAvailable(target: { createElement?: (tag: string) => { getContext?: (id: string) => unknown } | null } | undefined): boolean {
  try {
    return target?.createElement?.("canvas")?.getContext?.("2d") != null
  } catch {
    return false
  }
}
