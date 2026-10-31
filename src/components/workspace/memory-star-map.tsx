import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { GraphView } from "@/components/graph/graph-view"
import { useWorkspaceUiStore } from "@/stores/workspace-ui-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useWikiStore } from "@/stores/wiki-store"
import { buildWikiGraph, type GraphNode, type GraphEdge } from "@/lib/wiki-graph"
import { normalizePath } from "@/lib/path-utils"
import { seaColor, visibleSeaEdges, type SeaPoint, type SeaEdge } from "@/lib/memory-sea-scene"
import { MemorySeaCanvas } from "./memory-sea-canvas"
import "./memory-sea.css"

const MAX_POINTS = 4000
const MAX_EDGES = 12000
export function MemoryStarMap() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const { data, error: memoryError, loading: memoryLoading } = useWorkspaceStore()
  const [mode, setMode] = useState<"wiki" | "memory">("wiki")
  const [domain, setDomain] = useState("")
  const [query, setQuery] = useState("")
  const [selectedByMode, setSelectedByMode] = useState<{
    wiki: string | null
    memory: string | null
  }>({ wiki: null, memory: null })
  const [wikiNodes, setWikiNodes] = useState<GraphNode[]>([])
  const [wikiEdges, setWikiEdges] = useState<GraphEdge[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [analysis, setAnalysis] = useState(false)
  useEffect(() => {
    let active = true
    if (!project || mode !== "wiki") return
    setLoading(true)
    setError(null)
    void buildWikiGraph(normalizePath(project.path), dataVersion)
      .then((graph) => {
        if (active) {
          setWikiNodes(graph.nodes)
          setWikiEdges(graph.edges)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (active) {
          setError(String(e))
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [project, dataVersion, mode, refresh])
  const scene = useMemo(() => {
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
            t("workspace.uncategorized")
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
            `${normalizePath(project?.path ?? "")}/`,
            "",
          )
          return (
            (!domain || data.resourceDomains[relative]?.includes(domain)) &&
            matches(`${node.label} ${node.type}`)
          )
        })
        .map((node) => {
          const group = t(`graph.nodeTypeLabels.${node.type}`, { defaultValue: node.type })
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
  }, [mode, data, wikiNodes, wikiEdges, domain, query, project, t])
  const selected = selectedByMode[mode]
  const current = scene.points.find((point) => point.id === selected)
  const select = (id: string | null) => setSelectedByMode((state) => ({ ...state, [mode]: id }))
  const groups = useMemo(
    () => [...new Map(scene.points.map((point) => [point.group, point.color])).entries()],
    [scene.points],
  )
  const sceneError = mode === "wiki" ? error : memoryError
  const sceneLoading = mode === "wiki" ? loading : memoryLoading
  return (
    <section className="memory-sea-workspace">
      <header className="memory-sea-header">
        <div>
          <h1>{t("workspace.starMap")}</h1>
          <p>{t("workspace.seaSubtitle")}</p>
        </div>
        <div className="memory-sea-tabs" role="tablist" aria-label={t("workspace.graphMode")}>
          {(["wiki", "memory"] as const).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={mode === id}
              onClick={() => {
                setMode(id)
                setAnalysis(false)
              }}
            >
              {t(`workspace.graph_${id}`)}
            </button>
          ))}
        </div>
        {mode === "wiki" && (
          <button
            className="memory-sea-analysis"
            aria-pressed={analysis}
            onClick={() => setAnalysis((v) => !v)}
          >
            {t(analysis ? "workspace.backToSea" : "workspace.graphAnalysis")}
          </button>
        )}
      </header>
      {analysis && mode === "wiki" ? (
        <div className="min-h-0 flex-1 bg-background text-foreground">
          <GraphView />
        </div>
      ) : (
        <div className="memory-sea-stage">
          <MemorySeaCanvas
            key={mode}
            points={scene.points}
            edges={scene.edges}
            selected={current?.id ?? null}
            onSelect={select}
          />
          <div className="memory-sea-hud memory-sea-overview">
            <div className="memory-sea-hud-title">{t(`workspace.graph_${mode}`)}</div>
            <div className="memory-sea-stats">
              <span>
                {t("workspace.nodes")} <b>{scene.points.length}</b>
              </span>
              <span>
                {t("workspace.links")} <b>{scene.edges.length}</b>
              </span>
              <span>
                {t("workspace.clusters")} <b>{groups.length}</b>
              </span>
            </div>
            <input
              aria-label={t("workspace.searchGraph")}
              placeholder={t("workspace.searchGraph")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              aria-label={t("workspace.domains")}
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
            >
              <option value="">{t("workspace.allDomains")}</option>
              {data.domains.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              aria-label={t("workspace.selectNode")}
              value={current?.id ?? ""}
              onChange={(event) => select(event.target.value || null)}
            >
              <option value="">{t("workspace.selectNode")}</option>
              {scene.points.map((point) => (
                <option key={point.id} value={point.id}>
                  {point.title}
                </option>
              ))}
            </select>
            {mode === "wiki" && (
              <button onClick={() => setRefresh((v) => v + 1)}>{t("workspace.refresh")}</button>
            )}
            <p className="memory-sea-caption">
              {t(mode === "wiki" ? "workspace.wikiRelationsHint" : "workspace.explicitRelations")}
            </p>
            {(scene.total > MAX_POINTS || scene.totalEdges > MAX_EDGES) && (
              <p className="memory-sea-caption">
                {t("workspace.sceneLimited", { nodes: scene.total, edges: scene.totalEdges })}
              </p>
            )}
          </div>
          {groups.length > 0 && (
            <div className="memory-sea-hud memory-sea-legend" aria-label={t("workspace.legend")}>
              {groups.map(([label, color]) => (
                <span key={label}>
                  <i style={{ background: color }} />
                  {label}
                </span>
              ))}
            </div>
          )}
          {(sceneLoading || sceneError || !scene.points.length) && (
            <div className="memory-sea-empty" role={sceneError ? "alert" : "status"}>
              {sceneLoading
                ? t("workspace.loading")
                : sceneError ||
                  t(mode === "memory" ? "workspace.noMemories" : "workspace.noWikiNodes")}
            </div>
          )}
          {current && (
            <aside className="memory-sea-hud memory-sea-detail">
              <button
                className="memory-sea-close"
                aria-label={t("common.close")}
                onClick={() => select(null)}
              >
                ×
              </button>
              <div className="memory-sea-caption">{current.group}</div>
              <h2>{current.title}</h2>
              <p className="memory-sea-detail-text">{current.text}</p>
              {current.createdAt && (
                <p className="memory-sea-caption">
                  {t("workspace.createdAt")}: {new Date(current.createdAt).toLocaleString()}
                </p>
              )}
              <button
                onClick={() => {
                  if (mode === "memory") {
                    useWorkspaceUiStore.getState().setSelectedMemoryId(current.id)
                    useWikiStore.getState().setActiveView("memories")
                  } else if (current.path && project) {
                    const path = normalizePath(current.path)
                    useWikiStore
                      .getState()
                      .openPathInPreview(
                        path.startsWith(`${normalizePath(project.path)}/`)
                          ? path
                          : `${project.path}/${path}`,
                      )
                  }
                }}
              >
                {t(mode === "memory" ? "workspace.openMemory" : "workspace.openWiki")}
              </button>
            </aside>
          )}
        </div>
      )}
    </section>
  )
}
