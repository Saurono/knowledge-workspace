import { useEffect, useMemo, useState, useRef } from "react"
import { useTranslation } from "react-i18next"
import { GraphView } from "@/components/graph/graph-view"
import { useWorkspaceUiStore } from "@/stores/workspace-ui-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useWikiStore } from "@/stores/wiki-store"
import { buildWikiGraph, type GraphNode, type GraphEdge } from "@/lib/wiki-graph"
import { normalizePath } from "@/lib/path-utils"
import { buildWorkspaceScene, MAX_SCENE_POINTS as MAX_POINTS, MAX_SCENE_EDGES as MAX_EDGES } from "@/modules/star-map/application"
import { MemorySeaCanvas } from "@/modules/star-map"

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
  const projectGeneration = useRef(0)
  useEffect(() => useWikiStore.subscribe((next, previous) => {
    if (next.project?.id !== previous.project?.id || next.project?.path !== previous.project?.path) {
      ++projectGeneration.current
      setWikiNodes([]); setWikiEdges([])
      setSelectedByMode({ wiki: null, memory: null })
      setRefresh(value => value + 1)
    }
  }), [])
  useEffect(() => {
    let active = true
    const version = projectGeneration.current
    if (!project || mode !== "wiki") return
    setLoading(true)
    setError(null)
    void buildWikiGraph(normalizePath(project.path), dataVersion)
      .then((graph) => {
        if (active && version === projectGeneration.current) {
          setWikiNodes(graph.nodes)
          setWikiEdges(graph.edges)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (active && version === projectGeneration.current) {
          setError(String(e))
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [project, dataVersion, mode, refresh])
  const scene = useMemo(() => buildWorkspaceScene({
    mode, domain, query, projectPath: project?.path ?? "", data, wikiNodes, wikiEdges,
    labels: { uncategorized: t("workspace.uncategorized"), type: type => t(`graph.nodeTypeLabels.${type}`, { defaultValue: type }) },
  }), [mode, data, wikiNodes, wikiEdges, domain, query, project, t])
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
