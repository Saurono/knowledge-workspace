import { useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { SignInForm, ContextSwitcher, IdentityConsole } from "@/modules/identity/ui"
import type { Account, AccessContext, ProjectPermission } from "@/modules/identity/domain"
import type { ContextOption } from "@/modules/identity/application"
import { MemoryLibrary } from "@/modules/memory"
import { DomainTagEditor } from "@/modules/domains"
import { createWebPlatform, type ConnectionState } from "@/app/platform/web"
import { createRemoteWorkspace } from "@/app/platform/remote-workspace"
import type { ProjectRecord, ResourceRecord, WikiContent } from "@/modules/service-api/domain"
import type { ReceivedDocument, SharedWorkspace } from "@/modules/service-api/application"
import { ApiClientError } from "@/modules/service-api/application"
import { DomainFilter } from "@/components/workspace/domain-filter"
import { ResourceDomainAssignment } from "@/components/workspace/resource-domain-assignment"
import { formatSourceTimestamp } from "@/components/workspace/source-time"
import type { DomainFilter as DomainFilterValue } from "@/modules/domains/domain"
import { VaultConnectorPanel } from "./vault-connector-panel"
import { MemoryGraphView } from "./memory-graph-view"
type Platform = ReturnType<typeof createWebPlatform>
type MemorySummaryView = NonNullable<Parameters<typeof MemoryLibrary>[0]["summaries"]>[number]
const message = (error: unknown) => error instanceof ApiClientError && error.code === "conflict"
  ? "资源已由其他客户端修改。草稿已保留，请复制草稿后刷新再合并。" : error instanceof ApiClientError && error.code === "unauthenticated" ? "会话已失效，请复制草稿后重新登录。" : error instanceof Error ? error.message : String(error)
export function WebWorkspace() {
  const base = useMemo(() => createWebPlatform(location.origin), [])
  const [account, setAccount] = useState<Account | null>(null), [initialized, setInitialized] = useState(true), [booting, setBooting] = useState(true), [busy, setBusy] = useState(false)
  const [projects, setProjects] = useState<ProjectRecord[]>([]), [selected, setSelected] = useState(""), [name, setName] = useState(""), [error, setError] = useState("")
  const [access, setAccess] = useState<AccessContext | null>(null), [options, setOptions] = useState<ContextOption[]>([]), [choice, setChoice] = useState("self"), [contextId, setContextId] = useState<string | undefined>(), [showConsole, setShowConsole] = useState(false)
  const [dirty, setDirty] = useState(false), [panelBusy, setPanelBusy] = useState(false), [consoleBusy, setConsoleBusy] = useState(false)
  const generation = useRef(0), identityGeneration = useRef(0)
  const scoped = useMemo(() => createWebPlatform(location.origin, "", fetch, contextId), [contextId])
  const loadProjects = async () => {
    const found: ProjectRecord[] = []; let query = ""
    do { const page = await base.api.projects(query); found.push(...page.data); query = page.meta.page?.nextCursor ? `?cursor=${encodeURIComponent(page.meta.page.nextCursor)}` : "" } while (query)
    return found
  }
  const signedOut = () => { ++generation.current; ++identityGeneration.current; setAccount(null); setProjects([]); setSelected(""); setAccess(null); setOptions([]); setContextId(undefined); setChoice("self"); setShowConsole(false); setDirty(false); setError("") }
  const restore = async () => {
    const version = ++generation.current; setBooting(true); setError("")
    try {
      const status = await base.identity.status(); if (version !== generation.current) return; setInitialized(status.initialized)
      if (status.initialized) {
        try { const me = await base.identity.me(), found = await loadProjects(); if (version === generation.current) { setAccount(me.account); setProjects(found); setSelected(found[0]?.id ?? "") } }
        catch (error) { if (!(error instanceof ApiClientError && error.code === "unauthenticated")) throw error }
      }
    } catch (error) { if (version === generation.current) setError(message(error)) }
    finally { if (version === generation.current) setBooting(false) }
  }
  useEffect(() => { void restore(); return () => { ++generation.current } }, [base])
  useEffect(() => {
    const version = ++identityGeneration.current
    if (!account || !selected) { setAccess(null); setOptions([]); return }
    setBusy(true); setError("")
    void Promise.all([base.identity.access(selected), base.identity.options(selected)]).then(([context, choices]) => { if (version === identityGeneration.current) { setAccess(context); setOptions(choices); setChoice("self"); setContextId(undefined) } }).catch(error => { if (version === identityGeneration.current) setError(message(error)) }).finally(() => { if (version === identityGeneration.current) setBusy(false) })
    return () => { ++identityGeneration.current }
  }, [account?.id, selected, base])
  const canLeave = () => !dirty || window.confirm("当前 Wiki 草稿尚未保存。确认放弃草稿并切换？")
  const refreshAccess = async () => {
    if (!selected) return; const version = identityGeneration.current; setBusy(true)
    try { const [context, choices] = await Promise.all([scoped.identity.access(selected), base.identity.options(selected)]); if (version === identityGeneration.current) { setAccess(context); setOptions(choices); setError("") } }
    catch (error) { if (version === identityGeneration.current) setError(message(error)) }
    finally { if (version === identityGeneration.current) setBusy(false) }
  }
  return <main className="web-workspace p-5 md:p-8"><header className="mx-auto mb-6 flex max-w-7xl flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Knowledge Workspace</h1><p className="muted mt-1">共享知识工作区 · Web</p></div>{account && <div className="flex flex-wrap items-center gap-3"><span className="muted">{account.displayName} · {account.kind}</span><button disabled={consoleBusy} onClick={() => setShowConsole(value => !value)}>身份与授权</button><button disabled={busy || panelBusy || consoleBusy} onClick={async () => { if (!canLeave()) return; setBusy(true); try { await base.identity.logout(); signedOut() } catch (error) { setError(message(error)) } finally { setBusy(false) } }}>退出登录</button></div>}</header>
    {booting ? <p role="status" className="muted mx-auto max-w-md">正在检查登录状态…</p> : !account ? <><SignInForm initialized={initialized} busy={busy} error={error} onSubmit={async input => {
      setBusy(true); setError(""); const version = generation.current
      try { if (!initialized) { await base.identity.bootstrap({ handle: input.handle, displayName: input.displayName, password: input.password }, input.key); setInitialized(true) } const me = await base.identity.login(input.handle, input.password), found = await loadProjects(); if (version === generation.current) { setAccount(me.account); setProjects(found); setSelected(found[0]?.id ?? "") } }
      catch (error) { if (version === generation.current) setError(message(error)) }
      finally { if (version === generation.current) setBusy(false) }
    }} /><div className="mx-auto mt-3 max-w-md"><button onClick={() => void restore()}>重新检查服务</button></div></> : <div className="mx-auto max-w-7xl space-y-4">
      <section className="panel flex flex-wrap items-end gap-4"><label>当前项目<select aria-label="当前项目" value={selected} disabled={busy || panelBusy || consoleBusy} onChange={event => { if (!canLeave()) return; setSelected(event.target.value); setContextId(undefined); setChoice("self"); setDirty(false) }}><option value="">选择项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><form className="flex gap-2" onSubmit={async event => { event.preventDefault(); if (!canLeave()) return; const version = generation.current; setBusy(true); try { const result = await base.api.createProject(name), found = await loadProjects(); if (version === generation.current) { setProjects(found); setSelected(result.data.id); setContextId(undefined); setName(""); setDirty(false); setError("") } } catch (error) { if (version === generation.current) setError(message(error)) } finally { if (version === generation.current) setBusy(false) } }}><input aria-label="新项目名称" placeholder="新项目名称" required maxLength={120} value={name} onChange={event => setName(event.target.value)} /><button disabled={busy || panelBusy || consoleBusy}>创建项目</button></form></section>
      {error && <p role="alert" className="error">{error}</p>}
      {selected && access?.projectId === selected && <ContextSwitcher account={account} context={access} options={options} selected={choice} busy={busy || panelBusy || consoleBusy} onRefresh={() => void refreshAccess()} onChange={id => { if (!canLeave()) return; const selectedOption = options.find(option => option.id === id); if (!selectedOption) return; const version = identityGeneration.current; setBusy(true); void base.identity.switchContext(selected, selectedOption.selection).then(context => { if (version === identityGeneration.current) { setAccess(context); setContextId(context.id); setChoice(id); setDirty(false); setError("") } }).catch(error => { if (version === identityGeneration.current) setError(message(error)) }).finally(() => { if (version === identityGeneration.current) setBusy(false) }) }} />}
      {showConsole && <IdentityConsole key={`identity:${selected}:${contextId ?? "self"}`} client={scoped.identity} account={account} projectId={selected || undefined} context={access?.projectId === selected ? access : null} onBusy={setConsoleBusy} onSignedOut={signedOut} />}
      {selected && access?.projectId === selected && projects.some(project => project.id === selected) && <ProjectPanel key={`project:${selected}:${contextId ?? "self"}`} platform={scoped} project={projects.find(project => project.id === selected)!} access={access} onDirty={setDirty} onBusy={setPanelBusy} />}
    </div>}
  </main>
}
function ProjectPanel({ platform, project, access, onDirty, onBusy }: { platform: Platform; project: ProjectRecord; access: AccessContext; onDirty(value: boolean): void; onBusy(value: boolean): void }) {
  const can = (permission: ProjectPermission) => access.permissions.includes(permission)
  const workspace = useMemo(() => createRemoteWorkspace(platform.api, project.id), [platform, project.id])
  const [snapshot, setSnapshot] = useState<ResourceRecord<SharedWorkspace> | null>(null)
  const [summaries, setSummaries] = useState<MemorySummaryView[]>([]), [summariesBusy, setSummariesBusy] = useState(false), [summariesError, setSummariesError] = useState("")
  const [conflicts, setConflicts] = useState<Array<{ a: string; b: string }>>([])
  const [wiki, setWiki] = useState<ResourceRecord<WikiContent>[]>([]), [documents, setDocuments] = useState<ResourceRecord<ReceivedDocument>[]>([])
  const [tab, setTab] = useState(access.permissions.includes("wiki.read") ? "wiki" : access.permissions.includes("memory.read") ? "memories" : "domains"), [connection, setConnection] = useState<ConnectionState>("connecting")
  const [path, setPath] = useState("wiki/queries/new-page.md"), [content, setContent] = useState(""), [revision, setRevision] = useState<number | null>(null)
  const [selectedMemory, setSelectedMemory] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [updated, setUpdated] = useState(false)
  const [domainFilter, setDomainFilter] = useState<DomainFilterValue>({ domainIds: [], match: "any", unclassified: false })
  const [domainDrafts, setDomainDrafts] = useState<Record<string, string[]>>({})
  const [filterBusy, setFilterBusy] = useState(false)
  const [domainNotice, setDomainNotice] = useState("")
  const [importPreview, setImportPreview] = useState<{ bundle: unknown; plan: { wiki: { create: string[]; update: string[] }; documents: { create: string[]; skip: string[] }; memories: number; domains: number } } | null>(null)
  const exportProject = async () => {
    setBusy(true); setError("")
    try {
      const response = await platform.api.exportProject(project.id)
      const url = URL.createObjectURL(new Blob([JSON.stringify(response.data, null, 2)], { type: "application/json" }))
      const anchor = document.createElement("a")
      try { anchor.href = url; anchor.download = `${project.name.replace(/[^A-Za-z0-9_-]/g, "_")}-export.json`; document.body.appendChild(anchor); anchor.click() }
      finally { anchor.remove(); URL.revokeObjectURL(url) }
    } catch (error) { setError(message(error)) } finally { setBusy(false) }
  }
  const previewImport = async (file: File) => {
    setBusy(true); setError(""); setImportPreview(null)
    try {
      const text = await file.text()
      let bundle: unknown
      try { bundle = JSON.parse(text) } catch { setError("导入文件不是合法 JSON"); return }
      const response = await platform.api.importProject(project.id, bundle, { dryRun: true })
      const { plan } = response.data as { plan: NonNullable<typeof importPreview>["plan"] }
      setImportPreview({ bundle, plan })
    } catch (error) { setError(message(error)) } finally { setBusy(false) }
  }
  const confirmImport = async () => {
    if (!importPreview) return
    setBusy(true); setError("")
    try { await platform.api.importProject(project.id, importPreview.bundle, { dryRun: false }); await reload(); setImportPreview(null) }
    catch (error) { setError(message(error)) } finally { setBusy(false) }
  }
  const [expireNotice, setExpireNotice] = useState("")
  const resourceGeneration = useRef(0)
  const filterGeneration = useRef(0)
  const alive = useRef(true), pageGeneration = useRef(0), dirty = useRef(false)
  const markDirty = (value: boolean) => { dirty.current = value; onDirty(value) }
  useEffect(() => { onBusy(busy); return () => onBusy(false) }, [busy, onBusy])
  const resources = async (filter: DomainFilterValue = domainFilter) => {
    const generation = ++resourceGeneration.current
    const all = async <T,>(load: (query: string) => Promise<{ data: T[]; meta: { page?: { nextCursor: string | null } } }>) => {
      const result: T[] = []; let query = ""
      do { const page = await load(query); result.push(...page.data); query = page.meta.page?.nextCursor ? `?cursor=${encodeURIComponent(page.meta.page.nextCursor)}` : "" } while (query)
      return result
    }
    const activeFilter = filter.domainIds.length || filter.unclassified ? filter : undefined
    try {
      const [pages, files] = await Promise.all([
        can("wiki.read") ? all(query => platform.api.wiki(project.id, query, activeFilter)) : [],
        can("documents.read") ? all(query => platform.api.documents(project.id, query, activeFilter)) : [],
      ])
      if (alive.current && generation === resourceGeneration.current) { setWiki(pages); setDocuments(files as ResourceRecord<ReceivedDocument>[]) }
    } catch (error) {
      if (generation === resourceGeneration.current) throw error
    }
  }
  const loadSummaries = async () => {
    setSummariesBusy(true); setSummariesError("")
    try {
      const result: MemorySummaryView[] = []; let cursor: string | null | undefined
      for (let page = 0; page < 20; page++) {
        const value = await workspace.listMemorySummaries({ limit: 200, cursor })
        result.push(...value.items.map(item => ({ ...item, status: item.status as MemorySummaryView["status"], category: item.category ?? "" })))
        cursor = value.nextCursor
        if (!cursor) break
      }
      if (alive.current) setSummaries(result)
      void workspace.listMemoryConflicts().then(setConflicts).catch(error => setError(message(error)))
    } catch (error) { if (alive.current) setSummariesError(message(error)) }
    finally { if (alive.current) setSummariesBusy(false) }
  }
  const reload = async () => {
    setBusy(true)
    setDomainDrafts({})
    try {
      const value = can("project.read") ? await workspace.load({ memories: "none" }) : null
      if (tab === "memories") await loadSummaries()
      let currentFilter = domainFilter
      if (value) {
        const known = new Set(value.data.domains.map(domain => domain.id))
        const domainIds = domainFilter.domainIds.filter(id => known.has(id))
        if (domainIds.length !== domainFilter.domainIds.length) {
          currentFilter = { ...domainFilter, domainIds }
          setDomainFilter(currentFilter); setDomainNotice("已删除领域已从筛选中移除。")
        }
      }
      await resources(currentFilter)
      if (alive.current) { setSnapshot(value); setRevision(null); setContent(""); setPath("wiki/queries/new-page.md"); setError(""); setUpdated(false); markDirty(false); ++pageGeneration.current }
    }
    catch (error) { if (alive.current) setError(message(error)) }
    finally { if (alive.current) setBusy(false) }
  }
  useEffect(() => {
    alive.current = true; void reload()
    const controller = new AbortController()
    const stop = can("project.read") ? platform.watch(project.id, () => { if (alive.current) setUpdated(true) }, state => { if (alive.current) setConnection(state) }, controller.signal) : () => {}
    const guard = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = "" } }
    window.addEventListener("beforeunload", guard)
    return () => { onDirty(false); alive.current = false; ++pageGeneration.current; controller.abort(); stop(); window.removeEventListener("beforeunload", guard) }
  }, [workspace])
  useEffect(() => {
    if (!snapshot) return
    const known = new Set(snapshot.data.domains.map(domain => domain.id))
    if (domainFilter.domainIds.some(id => !known.has(id))) {
      const safe = { ...domainFilter, domainIds: domainFilter.domainIds.filter(id => known.has(id)) }
      setDomainFilter(safe)
      setDomainNotice("已删除领域已从筛选中移除。")
      setFilterBusy(true)
      void resources(safe).catch(error => { if (alive.current) setError(message(error)) }).finally(() => { if (alive.current) setFilterBusy(false) })
    }
  }, [snapshot, domainFilter.domainIds])
  const activeDomainFilter = useMemo(() => {
    const known = new Set((snapshot?.data.domains ?? []).map(domain => domain.id))
    return { ...domainFilter, domainIds: domainFilter.domainIds.filter(id => known.has(id)) }
  }, [domainFilter, snapshot])
  const updateDomainFilter = (next: DomainFilterValue) => {
    if (filterBusy) return
    const request = ++filterGeneration.current
    setDomainFilter(next); setFilterBusy(true); setError("")
    void resources(next).catch(async error => {
      if (request !== filterGeneration.current) return
      if (error instanceof ApiClientError && error.code === "invalid_argument" && /Unknown domain filter ID/i.test(error.message) && can("project.read")) {
        try {
          const fresh = await workspace.load()
          if (!alive.current) return
          setSnapshot(fresh)
          const known = new Set(fresh.data.domains.map(domain => domain.id))
          const safe = { ...next, domainIds: next.domainIds.filter(id => known.has(id)) }
          setDomainFilter(safe); setDomainNotice("领域列表已更新，已移除失效筛选条件。")
          try { await resources(safe) }
          catch (retryError) { if (alive.current) setError(message(retryError)) }
        } catch (refreshError) { if (alive.current) setError(message(refreshError)) }
      } else if (alive.current) setError(message(error))
    }).finally(() => { if (alive.current && request === filterGeneration.current) setFilterBusy(false) })
  }
  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError("")
    try { await operation(); if (alive.current) { setSnapshot(workspace.snapshot()); return true } return false }
    catch (error) { if (alive.current) setError(message(error)); return false }
    finally { if (alive.current) setBusy(false) }
  }
  const saveResourceDomains = async (key: string, desired: string[]) => {
    setDomainDrafts(current => ({ ...current, [key]: desired }))
    const success = await mutate(() => workspace.setResourceDomains(key, desired))
    if (success) {
      setDomainDrafts(current => { const next = { ...current }; delete next[key]; return next })
      try { await resources(activeDomainFilter); setDomainNotice("") }
      catch (error) { if (alive.current) setError(message(error)) }
    }
  }
  return <section className="panel space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><nav role="tablist" aria-label="项目功能" className="flex flex-wrap gap-2">{[["wiki", "Wiki", "wiki.read"], ["documents", "文档", "documents.read"], ["memories", "记忆库", "memory.read"], ["graph", "星图", "memory.read"], ["domains", "知识领域", "project.read"]].filter(([, , permission]) => can(permission as ProjectPermission)).map(([id, label]) => <button role="tab" key={id} aria-selected={tab === id} onClick={() => { setTab(id); if (id === "memories" && tab !== "memories" && !summaries.length && !summariesBusy) void loadSummaries() }}>{label}</button>)}</nav><div className="flex flex-wrap items-center gap-2"><button disabled={busy} onClick={() => void exportProject()}>导出项目</button><label>导入项目<input type="file" accept="application/json" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void previewImport(file) }} /></label></div><p role="status" className="muted">事件连接：{connection === "connected" ? "已连接" : connection === "reconnecting" ? "重连中" : connection === "error" ? "连接失败" : "连接中"}</p></header>
    {importPreview && <div role="status">wiki 新建 {importPreview.plan.wiki.create.length} / 更新 {importPreview.plan.wiki.update.length}，文档跳过 {importPreview.plan.documents.skip.length}，记忆 {importPreview.plan.memories} 条，领域 {importPreview.plan.domains} 个 <button disabled={busy} onClick={() => void confirmImport()}>确认导入</button></div>}
    {(error || updated) && <div role="alert" className={error ? "error" : "muted"}><p>{error || "服务已有新变更，可刷新读取。"}</p><button className="mt-2" disabled={busy} onClick={() => void reload()}>刷新资源（放弃未保存内容）</button></div>}
    {(tab === "wiki" || tab === "documents") && snapshot && <div className="space-y-2">
      <DomainFilter domains={snapshot.data.domains} value={activeDomainFilter} onChange={updateDomainFilter} disabled={busy || filterBusy} />
      {domainNotice && <p role="status" className="muted text-xs">{domainNotice}</p>}
      {filterBusy && <p role="status" className="muted text-xs">正在按领域筛选…</p>}
    </div>}
    {tab === "wiki" && can("wiki.read") && <div className="grid min-w-0 gap-5 lg:grid-cols-[230px_minmax(0,1fr)]"><aside className="min-w-0 space-y-2 [&>div>details>fieldset]:left-0 [&>div>details>fieldset]:right-auto [&>div>details>fieldset]:max-w-[calc(100vw-2rem)]"><button disabled={busy || !can("wiki.write")} onClick={() => { ++pageGeneration.current; setPath("wiki/queries/new-page.md"); setContent(""); setRevision(null); markDirty(false) }}>新建 Wiki</button>{wiki.map(page => <div className="flex min-w-0 flex-col items-start gap-1" key={page.key}><button className="block min-w-0 flex-1 truncate text-left text-xs" disabled={busy} onClick={async () => {
      const version = ++pageGeneration.current; setBusy(true)
      try { const record = (await platform.api.readWiki(project.id, page.key)).data; if (alive.current && version === pageGeneration.current) { setPath(record.data.path); setContent(record.data.content); setRevision(record.revision); markDirty(false) } }
      catch (error) { if (alive.current) setError(message(error)) }
      finally { if (alive.current) setBusy(false) }
    }}>{page.key}</button><span className="muted text-xs max-w-full break-words">服务资源创建：{formatSourceTimestamp(page.createdAt, "未知")}</span>{can("domains.manage") && snapshot && <ResourceDomainAssignment label={page.key} domains={snapshot.data.domains} selectedIds={domainDrafts[page.key] ?? snapshot.data.resourceDomains[page.key] ?? []} disabled={busy} onChange={ids => void saveResourceDomains(page.key, ids)} />}</div>)}</aside><div className="min-w-0 space-y-3"><label>Wiki 路径<input aria-label="Wiki 路径" disabled={revision !== null || busy || !can("wiki.write")} value={path} onChange={event => setPath(event.target.value)} /></label><label>Wiki 正文<textarea className="min-h-64 font-mono text-sm" aria-label="Wiki 正文" readOnly={!can("wiki.write")} disabled={busy} value={content} onChange={event => { setContent(event.target.value); markDirty(true) }} /></label><div className="flex gap-2"><button className="primary" disabled={busy || !can("wiki.write")} onClick={async () => {
      setBusy(true); setError("")
      try { const record = (await platform.api.saveWiki(project.id, path, content, revision)).data; if (alive.current) { setRevision(record.revision); setPath(record.data.path); markDirty(false); await resources() } }
      catch (error) { if (alive.current) setError(message(error)) }
      finally { if (alive.current) setBusy(false) }
    }}>保存 Wiki</button><button onClick={() => void navigator.clipboard.writeText(content)}>复制草稿</button><span className="muted self-center">{revision === null ? "未创建" : `版本 ${revision}`}</span></div><article className="prose dark:prose-invert min-w-0 max-w-none border-t pt-4"><ReactMarkdown components={{ table: ({ children }) => <div className="max-w-full overflow-x-auto"><table>{children}</table></div> }}>{content}</ReactMarkdown></article></div></div>}
    {tab === "documents" && can("documents.read") && <div className="space-y-4"><label>上传原始文档<input aria-label="上传原始文档" type="file" disabled={busy || !can("documents.write")} onChange={async event => {
      const file = event.target.files?.[0]; if (!file) return; setBusy(true); setError("")
      try { await platform.upload(project.id, file); if (alive.current) await resources() } catch (error) { if (alive.current) setError(message(error)) } finally { if (alive.current) setBusy(false) }
    }} /></label><p className="muted">上传仅表示服务已接收原始文件；解析、入库和索引不会被标为已完成。最大 16 MiB。</p>{documents.map(record => { const key = `raw/documents/${record.data.sourceId}`; return <div key={record.key} className="flex items-start justify-between gap-3 rounded-lg border p-3"><div><b>{record.data.name}</b><p className="muted">已接收 · {record.data.size} 字节 · {formatSourceTimestamp(record.data.receivedAt, "未知")}</p><p className="muted">来源入库：{formatSourceTimestamp(record.data.sourceIngestedAt, "未知")}</p><p className="muted">当前修订入库：{formatSourceTimestamp((record.data as ReceivedDocument & { revisionIngestedAt?: string | null }).revisionIngestedAt, "未知")}</p></div>{can("domains.manage") && snapshot && <ResourceDomainAssignment label={record.data.name} domains={snapshot.data.domains} selectedIds={domainDrafts[key] ?? snapshot.data.resourceDomains[key] ?? []} disabled={busy} onChange={ids => void saveResourceDomains(key, ids)} />}</div>})}</div>}
    {tab === "documents" && can("documents.read") && <VaultConnectorPanel projectId={project.id} projectName={project.name} documents={documents.map(record => record.data)} enabled />}
    {tab === "memories" && can("memory.read") && snapshot && <div className="min-h-[600px]"><button disabled={busy || !can("memory.write")} onClick={async () => { setBusy(true); setError(""); setExpireNotice(""); try { const result = await platform.api.expireMemories(project.id); await loadSummaries(); setExpireNotice(result.data.expired > 0 ? `已清理 ${result.data.expired} 条过期记忆` : "没有需要清理的过期记忆") } catch (error) { setError(message(error)) } finally { setBusy(false) } }}>清理过期记忆</button>{expireNotice && <p className="muted">{expireNotice}</p>}<MemoryLibrary readOnly={!can("memory.write")} key={snapshot.revision} summaries={summaries} conflicts={conflicts} onLoadMemory={async id => { try { return await workspace.loadMemory(id) } catch (error) { setError(message(error)); return null } }} domains={snapshot.data.domains} loading={summariesBusy} saving={busy} error={error || summariesError} selected={selectedMemory} onSelect={setSelectedMemory} onRetry={() => void reload()} onSave={record => mutate(async () => { const ok = await workspace.saveMemory(record); await loadSummaries(); return ok })} onRemove={id => mutate(async () => { const ok = await workspace.removeMemory(id); await loadSummaries(); return ok })} onPromote={id => mutate(async () => { const ok = await workspace.promoteMemory(id); await loadSummaries(); return ok })} onArchive={id => mutate(async () => { const ok = await workspace.archiveMemory(id); await loadSummaries(); return ok })} onSupersede={(oldId, newId) => mutate(async () => { const ok = await workspace.supersedeMemory(oldId, newId); await loadSummaries(); return ok })} /></div>}
    {tab === "graph" && can("memory.read") && <MemoryGraphView platform={platform} projectId={project.id} domains={snapshot?.data.domains ?? []} onBack={() => setTab("wiki")} />}
    {tab === "domains" && can("project.read") && snapshot && <DomainTagEditor readOnly={!can("domains.manage")} domains={snapshot.data.domains} loading={false} saving={busy} error={error || null} onRetry={() => void reload()} onAdd={tag => mutate(() => workspace.addDomain(tag))} onRemove={id => mutate(() => workspace.removeDomain(id))} onToggle={(path, id) => mutate(() => workspace.toggleDomain(path, id))} />}
    <footer className="muted border-t pt-3">Web 使用服务端资源；本机 Shell、文件监听和 Obsidian Vault 需本机连接器。</footer>
  </section>
}
