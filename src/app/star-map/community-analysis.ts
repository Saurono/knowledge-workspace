import { detectCommunities } from "@/lib/wiki-graph-analysis"
import type { GraphEdge, CommunityInfo } from "@/modules/star-map/domain"
const COMMUNITY_WORKER_THRESHOLD = 500
export async function analyzeCommunities(
  nodes: { id: string; label: string; linkCount: number }[],
  edges: GraphEdge[],
): Promise<{ assignments: Map<string, number>; communities: CommunityInfo[] }> {
  if (nodes.length < COMMUNITY_WORKER_THRESHOLD || typeof Worker === "undefined") {
    return detectCommunities(nodes, edges)
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../../lib/wiki-graph-analysis.worker.ts", import.meta.url),
      { type: "module" },
    )
    worker.onmessage = (event: MessageEvent<{
      assignments: [string, number][]
      communities: CommunityInfo[]
    }>) => {
      worker.terminate()
      resolve({
        assignments: new Map(event.data.assignments),
        communities: event.data.communities,
      })
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || "Knowledge graph analysis worker failed"))
    }
    worker.postMessage({ nodes, edges })
  })
}
