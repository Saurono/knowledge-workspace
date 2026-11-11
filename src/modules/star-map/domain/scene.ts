/**
 * 3D scene layout/projection adapted from asdfd3/3d-memory-sea (MIT).
 * See src/modules/star-map/LICENSE.
 * Adapters keep application graph semantics independent of the reference data model.
 */
import type { CelestialBody } from "./bodies"

export interface SeaPoint {
  id: string
  title: string
  text: string
  group: string
  color: string
  weight: number
  path?: string
  createdAt?: string
  body?: CelestialBody
  size?: number
  brightness?: number
}
export interface SeaEdge {
  source: string
  target: string
  weight: number
}
export interface SeaPosition extends SeaPoint {
  x: number
  y: number
  z: number
  radius: number
}
export interface SeaCamera {
  yaw: number
  pitch: number
  distance: number
  panX: number
  panY: number
}
export const DEFAULT_SEA_CAMERA: SeaCamera = {
  yaw: 0.45,
  pitch: -0.3,
  distance: 1200,
  panX: 0,
  panY: 0,
}
export const SEA_FOCAL = 1100
export function seaHash(text: string): number {
  let value = 2166136261
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 16777619) >>> 0
  }
  return value
}
const random = (text: string) => (seaHash(text) % 100000) / 100000
const COLORS = [
  "#96beff",
  "#82e6c8",
  "#bea5ff",
  "#ffa0d2",
  "#ffd28c",
  "#8ed8ef",
  "#d9b7ff",
  "#e6cb87",
]
export const seaColor = (group: string) => COLORS[seaHash(group) % COLORS.length]
export function layoutSea(points: readonly SeaPoint[]): SeaPosition[] {
  const groups = [...new Set(points.map((p) => p.group))].sort()
  const centers = new Map<string, { x: number; y: number; z: number }>()
  groups.forEach((group, i) => {
    const y = groups.length === 1 ? 0 : 1 - (i / (groups.length - 1)) * 2
    const ring = Math.sqrt(Math.max(0, 1 - y * y))
    const phi = i * Math.PI * (3 - Math.sqrt(5)) + random(group) * 0.6
    const radius = groups.length === 1 ? 0 : 230 + random(`${group}r`) * 190
    centers.set(group, {
      x: Math.cos(phi) * ring * radius,
      y: y * radius * 0.82,
      z: Math.sin(phi) * ring * radius,
    })
  })
  return points.map((point) => {
    const center = centers.get(point.group)!
    const a = random(`${point.id}a`) * Math.PI * 2
    const b = Math.acos(2 * random(`${point.id}b`) - 1)
    const radius = 16 + random(`${point.id}r`) ** 0.65 * (groups.length === 1 ? 240 : 120)
    return {
      ...point,
      x: center.x + Math.sin(b) * Math.cos(a) * radius,
      y: center.y + Math.cos(b) * radius * 0.72,
      z: center.z + Math.sin(b) * Math.sin(a) * radius,
      radius: 1.1 + Math.min(2.4, Math.max(0, point.weight) * 0.55),
    }
  })
}
export function projectSea(
  point: Pick<SeaPosition, "x" | "y" | "z">,
  camera: SeaCamera,
  width: number,
  height: number,
) {
  const x = point.x * Math.cos(camera.yaw) - point.z * Math.sin(camera.yaw)
  const z = point.x * Math.sin(camera.yaw) + point.z * Math.cos(camera.yaw)
  const y = point.y * Math.cos(camera.pitch) - z * Math.sin(camera.pitch)
  const depth = camera.distance + point.y * Math.sin(camera.pitch) + z * Math.cos(camera.pitch)
  const scale = SEA_FOCAL / Math.max(140, depth)
  return {
    x: width / 2 + (x + camera.panX) * scale,
    y: height / 2 + (y + camera.panY) * scale,
    scale,
    depth,
  }
}
export function visibleSeaEdges(points: readonly SeaPoint[], edges: readonly SeaEdge[]): SeaEdge[] {
  const ids = new Set(points.map((p) => p.id))
  const seen = new Set<string>()
  return edges.filter((edge) => {
    if (edge.source === edge.target || !ids.has(edge.source) || !ids.has(edge.target)) return false
    const key = JSON.stringify([edge.source, edge.target].sort())
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
