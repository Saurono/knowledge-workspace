import type { SeaPoint, SeaEdge } from "../domain"
import { bodyAesthetics, seaColor, visibleSeaEdges, planLevelOfDetail, samplePoints } from "../domain"
import type { MemoryGraphNode } from "@/modules/service-api/domain"

export interface GraphSceneInput {
  nodes: readonly MemoryGraphNode[]
  domain: string
  query: string
  now: string
  labels: { uncategorized: string }
  maxPoints?: number
}

export function buildGraphScene(input: GraphSceneInput): {
  points: SeaPoint[]
  edges: SeaEdge[]
  total: number
  totalEdges: number
  lod: { tier: "full" | "sampled" | "overview"; stride: number; rendered: number; total: number }
} {
  const query = input.query.toLowerCase()
  const nodes = input.nodes
    .filter(node => (!input.domain || node.domainIds.includes(input.domain)) &&
      (!query || node.title.toLowerCase().includes(query)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  const points: SeaPoint[] = nodes.map(node => {
    const group = node.category || input.labels.uncategorized
    return {
      id: node.id,
      title: node.title,
      // Graph nodes contain no body content; category supplies the display text instead.
      text: node.category ?? "",
      group,
      color: seaColor(group),
      weight: 1 + Math.min(4, node.relations.length * 0.3),
      ...bodyAesthetics({ status: node.status, importance: null, credibility: null,
        validityUntil: undefined, relationCount: node.relations.length, now: input.now }),
    }
  })
  const edges = visibleSeaEdges(points, nodes.flatMap(node => node.relations.map(relation => ({
    source: node.id, target: relation.targetId, weight: 1,
  }))))
  const total = points.length
  const plan = planLevelOfDetail({ total, maxPoints: input.maxPoints })
  const displayed = samplePoints(points, plan)
  const displayedEdges = visibleSeaEdges(displayed, edges)
  return {
    points: displayed,
    edges: displayedEdges,
    total,
    totalEdges: displayedEdges.length,
    lod: { tier: plan.tier, stride: plan.stride, rendered: displayed.length, total },
  }
}
