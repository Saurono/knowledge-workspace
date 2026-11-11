import { useEffect, useMemo, useState } from "react"
import type { createWebPlatform } from "@/app/platform/web"
import type { MemoryGraphNode } from "@/modules/service-api/domain"
import { MemorySeaCanvas } from "@/modules/star-map"
import { buildGraphScene } from "@/modules/star-map/application"

type Platform = ReturnType<typeof createWebPlatform>

export function MemoryGraphView({ platform, projectId, domains, onBack }: {
  platform: Platform
  projectId: string
  domains: Array<{ id: string; name: string }>
  /** 返回上一个标签页；不传就不渲染返回按钮（嵌入式用法）。 */
  onBack?: () => void
}) {
  const [nodes, setNodes] = useState<MemoryGraphNode[]>([])
  const [domain, setDomain] = useState("")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    setNodes([])
    setSelected(null)
    platform.api.memoryGraph(projectId, { limit: 2000 }).then(response => {
      if (active) setNodes(response.data.items)
    }).catch((error: unknown) => {
      if (active) setError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [platform, projectId, attempt])

  const scene = useMemo(() => buildGraphScene({
    nodes, domain, query, now: new Date().toISOString(), labels: { uncategorized: "未分类" },
  }), [nodes, domain, query])
  const detail = scene.points.some(point => point.id === selected) ? nodes.find(node => node.id === selected) : undefined

  return <section className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      {onBack && <button type="button" onClick={onBack} aria-label="返回">← 返回</button>}
      <label>领域<select value={domain} onChange={event => setDomain(event.target.value)}>
        <option value="">全部</option>
        {domains.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <input aria-label="搜索标题" placeholder="搜索标题" value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    {loading ? <p role="status">正在加载星图…</p> : error ? <p role="alert">{error} <button onClick={() => setAttempt(value => value + 1)}>重试</button></p> : <>
      {scene.lod.tier !== "full" && <p>已采样显示 {scene.lod.rendered}/{scene.lod.total}</p>}
      {/* 画布是 position:absolute inset:0，必须给一个有高度的相对定位容器，否则它会盖住整页（含标签栏）。 */}
      <div className="relative h-[70vh] min-h-[420px] overflow-hidden rounded border border-border">
        <MemorySeaCanvas points={scene.points} edges={scene.edges} selected={detail?.id ?? null} onSelect={setSelected} />
      </div>
      {detail && <p>{detail.status} · {detail.category || "未分类"} · {detail.updatedAt}</p>}
    </>}
  </section>
}
