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
type Platform = ReturnType<typeof createWebPlatform>
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
  const [wiki, setWiki] = useState<ResourceRecord<WikiContent>[]>([]), [documents, setDocuments] = useState<ResourceRecord<ReceivedDocument>[]>([])
  const [tab, setTab] = useState(access.permissions.includes("wiki.read") ? "wiki" : access.permissions.includes("memory.read") ? "memories" : "domains"), [connection, setConnection] = useState<ConnectionState>("connecting")
  const [path, setPath] = useState("wiki/queries/new-page.md"), [content, setContent] = useState(""), [revision, setRevision] = useState<number | null>(null)
  const [selectedMemory, setSelectedMemory] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [updated, setUpdated] = useState(false)
  const alive = useRef(true), pageGeneration = useRef(0), dirty = useRef(false)
  const markDirty = (value: boolean) => { dirty.current = value; onDirty(value) }
  useEffect(() => { onBusy(busy); return () => onBusy(false) }, [busy, onBusy])
  const resources = async () => {
    const all = async <T,>(load: (query: string) => Promise<{ data: T[]; meta: { page?: { nextCursor: string | null } } }>) => {
      const result: T[] = []; let query = ""
      do { const page = await load(query); result.push(...page.data); query = page.meta.page?.nextCursor ? `?cursor=${encodeURIComponent(page.meta.page.nextCursor)}` : "" } while (query)
      return result
    }
    const [pages, files] = await Promise.all([can("wiki.read") ? all(query => platform.api.wiki(project.id, query)) : [], can("documents.read") ? all(query => platform.api.documents(project.id, query)) : []])
    if (alive.current) { setWiki(pages); setDocuments(files as ResourceRecord<ReceivedDocument>[]) }
  }
  const reload = async () => {
    setBusy(true)
    try { const value = can("project.read") ? await workspace.load() : null; await resources(); if (alive.current) { setSnapshot(value); setRevision(null); setContent(""); setPath("wiki/queries/new-page.md"); setError(""); setUpdated(false); markDirty(false); ++pageGeneration.current } }
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
  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError("")
    try { await operation(); if (alive.current) { setSnapshot(workspace.snapshot()); return true } return false }
    catch (error) { if (alive.current) setError(message(error)); return false }
    finally { if (alive.current) setBusy(false) }
  }
  return <section className="panel space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><nav role="tablist" aria-label="项目功能" className="flex flex-wrap gap-2">{[["wiki", "Wiki", "wiki.read"], ["documents", "文档", "documents.read"], ["memories", "记忆库", "memory.read"], ["domains", "知识领域", "project.read"]].filter(([, , permission]) => can(permission as ProjectPermission)).map(([id, label]) => <button role="tab" key={id} aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav><p role="status" className="muted">事件连接：{connection === "connected" ? "已连接" : connection === "reconnecting" ? "重连中" : connection === "error" ? "连接失败" : "连接中"}</p></header>
    {(error || updated) && <div role="alert" className={error ? "error" : "muted"}><p>{error || "服务已有新变更，可刷新读取。"}</p><button className="mt-2" disabled={busy} onClick={() => void reload()}>刷新资源（放弃未保存内容）</button></div>}
    {tab === "wiki" && can("wiki.read") && <div className="grid gap-5 lg:grid-cols-[230px_1fr]"><aside className="space-y-2"><button disabled={busy || !can("wiki.write")} onClick={() => { ++pageGeneration.current; setPath("wiki/queries/new-page.md"); setContent(""); setRevision(null); markDirty(false) }}>新建 Wiki</button>{wiki.map(page => <button className="block w-full truncate text-left text-xs" key={page.key} disabled={busy} onClick={async () => {
      const version = ++pageGeneration.current; setBusy(true)
      try { const record = (await platform.api.readWiki(project.id, page.key)).data; if (alive.current && version === pageGeneration.current) { setPath(record.data.path); setContent(record.data.content); setRevision(record.revision); markDirty(false) } }
      catch (error) { if (alive.current) setError(message(error)) }
      finally { if (alive.current) setBusy(false) }
    }}>{page.key}</button>)}</aside><div className="space-y-3"><label>Wiki 路径<input aria-label="Wiki 路径" disabled={revision !== null || busy || !can("wiki.write")} value={path} onChange={event => setPath(event.target.value)} /></label><label>Wiki 正文<textarea className="min-h-64 font-mono text-sm" aria-label="Wiki 正文" readOnly={!can("wiki.write")} disabled={busy} value={content} onChange={event => { setContent(event.target.value); markDirty(true) }} /></label><div className="flex gap-2"><button className="primary" disabled={busy || !can("wiki.write")} onClick={async () => {
      setBusy(true); setError("")
      try { const record = (await platform.api.saveWiki(project.id, path, content, revision)).data; if (alive.current) { setRevision(record.revision); setPath(record.data.path); markDirty(false); await resources() } }
      catch (error) { if (alive.current) setError(message(error)) }
      finally { if (alive.current) setBusy(false) }
    }}>保存 Wiki</button><button onClick={() => void navigator.clipboard.writeText(content)}>复制草稿</button><span className="muted self-center">{revision === null ? "未创建" : `版本 ${revision}`}</span></div><article className="prose dark:prose-invert max-w-none border-t pt-4"><ReactMarkdown>{content}</ReactMarkdown></article></div></div>}
    {tab === "documents" && can("documents.read") && <div className="space-y-4"><label>上传原始文档<input aria-label="上传原始文档" type="file" disabled={busy || !can("documents.write")} onChange={async event => {
      const file = event.target.files?.[0]; if (!file) return; setBusy(true); setError("")
      try { await platform.upload(project.id, file); if (alive.current) await resources() } catch (error) { if (alive.current) setError(message(error)) } finally { if (alive.current) setBusy(false) }
    }} /></label><p className="muted">上传仅表示服务已接收原始文件；解析、入库和索引不会被标为已完成。最大 16 MiB。</p>{documents.map(record => <div key={record.key} className="rounded-lg border p-3"><b>{record.data.name}</b><p className="muted">已接收 · {record.data.size} 字节 · {record.data.receivedAt}</p></div>)}</div>}
    {tab === "memories" && can("memory.read") && snapshot && <div className="min-h-[600px]"><MemoryLibrary readOnly={!can("memory.write")} key={snapshot.revision} memories={snapshot.data.memories} domains={snapshot.data.domains} loading={false} saving={busy} error={error || null} selected={selectedMemory} onSelect={setSelectedMemory} onRetry={() => void reload()} onSave={record => mutate(() => workspace.saveMemory(record))} onRemove={id => mutate(() => workspace.removeMemory(id))} /></div>}
    {tab === "domains" && can("project.read") && snapshot && <DomainTagEditor readOnly={!can("domains.manage")} domains={snapshot.data.domains} loading={false} saving={busy} error={error || null} onRetry={() => void reload()} onAdd={tag => mutate(() => workspace.addDomain(tag))} onRemove={id => mutate(() => workspace.removeDomain(id))} onToggle={(path, id) => mutate(() => workspace.toggleDomain(path, id))} />}
    <footer className="muted border-t pt-3">Web 使用服务端资源；本机 Shell、文件监听和 Obsidian Vault 需本机连接器。</footer>
  </section>
}
