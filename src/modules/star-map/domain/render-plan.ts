import type { CelestialBody } from "./bodies"

export interface RenderBodyInput {
  body: CelestialBody | undefined
  size: number | undefined
  brightness: number | undefined
  weight: number
}
export interface RenderPlan {
  shape: "sparkle" | "disc" | "crescent" | "comet" | "cloud" | "faint"
  coreRadius: number
  glowRadius: number
  glowAlpha: number
  rimRadius: number
  rings: number
  layers: number
  alpha: number
}

// star: small sparkle, large glow, 3 layers; planet: medium disc, 1 arc ring;
// moon: small crescent, prominent rim; comet: small core, elongated glow;
// nebula: smallest core, faintest glow, 4 cloud layers;
// remnant: faint dashed outline, 2 rings, alpha limited to 0.15..0.35.
const styles = {
  star: { shape: "sparkle", core: 0.7, glow: 6, rim: 1.5, rings: 0, layers: 3, glowAlpha: 0.36 },
  planet: { shape: "disc", core: 1, glow: 3, rim: 1.8, rings: 1, layers: 1, glowAlpha: 0.24 },
  moon: { shape: "crescent", core: 0.65, glow: 2.5, rim: 1.3, rings: 0, layers: 1, glowAlpha: 0.2 },
  comet: { shape: "comet", core: 0.6, glow: 5, rim: 1, rings: 0, layers: 1, glowAlpha: 0.28 },
  nebula: { shape: "cloud", core: 0.15, glow: 5, rim: 1, rings: 0, layers: 4, glowAlpha: 0.1 },
  remnant: { shape: "faint", core: 0.5, glow: 2, rim: 1.4, rings: 2, layers: 1, glowAlpha: 0.16 },
} as const

export function planBodyRender(
  input: RenderBodyInput,
  options: { reducedMotion?: boolean; time?: number } = {},
): RenderPlan {
  const body = Object.prototype.hasOwnProperty.call(styles, input.body ?? "planet")
    ? input.body ?? "planet" : "planet"
  const style = styles[body]
  const size = Number.isFinite(input.size) ? Math.max(0, input.size!) : 1
  const brightness = Number.isFinite(input.brightness)
    ? Math.max(0, Math.min(1, input.brightness!)) : 0.6
  const weight = Number.isFinite(input.weight) ? Math.max(0, input.weight) : 1
  const radius = (2 + Math.min(weight, 6) * 0.35) * size
  const baseAlpha = body === "remnant" ? 0.15 + brightness * 0.2 : 0.25 + brightness * 0.75
  // Pulse vanishes at brightness endpoints, preserving visibility and remnant limits.
  const pulse = options.reducedMotion || body === "remnant" ? 0
    : Math.sin((options.time ?? 0) / 1200) * 0.12 * brightness * (1 - brightness)
  return {
    shape: style.shape,
    coreRadius: radius * style.core,
    glowRadius: radius * style.glow,
    glowAlpha: style.glowAlpha * (0.25 + brightness * 0.75),
    rimRadius: radius * style.rim,
    rings: style.rings,
    layers: style.layers,
    alpha: baseAlpha + pulse,
  }
}
