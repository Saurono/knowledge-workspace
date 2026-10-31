import { seaColor, visibleSeaEdges } from "../domain"
import type { SeaPoint, SeaEdge, GraphNode, GraphEdge } from "../domain"
import type { MemoryRecord } from "@/modules/memory/domain"
import type { DomainTag } from "@/modules/domains/domain"
export const MAX_SCENE_POINTS = 4000
export const MAX_SCENE_EDGES = 12000
const normalizePath = (path: string) => path.replace(/\\/g, "/")
export function buildWorkspaceScene(input: {
  mode: "wiki" | "memory"; domain: string; query: string; projectPath: string
  data: { domains: readonly DomainTag[]; resourceDomains: Record<string, string[]>; memories: readonly MemoryRecord[] }
  wikiNodes: readonly GraphNode[]; wikiEdges: readonly GraphEdge[]
  labels: { uncategorized: string; type(type: string): string }
}) {
  const { mode, domain, query, projectPath, data, wikiNodes, wikiEdges, labels } = input
  const MAX_POINTS = MAX_SCENE_POINTS, MAX_EDGES = MAX_SCENE_EDGES
  const domainNames = new Map(data.domains.map((d) => [d.id, d.name]))
  const matches = (text: string) =>
    text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  let points: SeaPoint[]
  let edges: SeaEdge[]
  if (mode === "memory") {
    points = [...data.memories]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter(
        (m) =>
          (!domain || m.domainIds.includes(domain)) &&
          matches(`${m.title} ${m.content} ${m.category}`),
      )
      .map((m) => {
        const group =
          m.category ||
          m.domainIds
            .map((id) => domainNames.get(id))
            .filter(Boolean)
            .sort()[0] ||
          labels.uncategorized
        return {
          id: m.id,
          title: m.title,
          text: m.content,
          group,
          color: seaColor(group),
          weight: 1 + Math.min(4, m.relatedIds.length * 0.3),
          createdAt: m.createdAt,
        }
      })
    edges = data.memories.flatMap((m) =>
      m.relatedIds.map((id) => ({ source: m.id, target: id, weight: 1 })),
    )
  } else {
    points = [...wikiNodes]
      .sort((a, b) => b.linkCount - a.linkCount || a.id.localeCompare(b.id))
      .filter((node) => {
        const relative = normalizePath(node.path).replace(
          `${normalizePath(projectPath)}/`,
          "",
        )
        return (
          (!domain || data.resourceDomains[relative]?.includes(domain)) &&
          matches(`${node.label} ${node.type}`)
        )
      })
      .map((node) => {
        const group = labels.type(node.type)
        return {
          id: node.id,
          title: node.label,
          text: node.path,
          group,
          color: seaColor(node.type),
          weight: 1 + Math.min(4, Math.sqrt(node.linkCount) * 0.3),
          path: node.path,
        }
      })
    edges = wikiEdges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
    }))
  }
  const total = points.length
  const displayed = points.slice(0, MAX_POINTS)
  const allEdges = visibleSeaEdges(displayed, edges)
  return {
    points: displayed,
    edges: allEdges.slice(0, MAX_EDGES),
    total,
    totalEdges: allEdges.length,
  }
}
