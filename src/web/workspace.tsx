import { useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { MemoryLibrary } from "@/modules/memory"
import { DomainTagEditor } from "@/modules/domains"
import { createWebPlatform, type ConnectionState } from "@/app/platform/web"
import { createRemoteWorkspace } from "@/app/platform/remote-workspace"
import type { ProjectRecord, ResourceRecord, WikiContent } from "@/modules/service-api/domain"
import type { ReceivedDocument, SharedWorkspace } from "@/modules/service-api/application"
import { ApiClientError } from "@/modules/service-api/application"
type Platform = ReturnType<typeof createWebPlatform>
const message = (error: unknown) => error instanceof ApiClientError && error.code === "conflict"
  ? "资源已由其他客户端修改。草稿已保留，请复制草稿后刷新再合并。" : error instanceof Error ? error.message : String(error)
export function WebWorkspace() {
  const [key, setKey] = useState(""), [platform, setPlatform] = useState<Platform | null>(null)
  const [projects, setProjects] = useState<ProjectRecord[]>([]), [selected, setSelected] = useState("")
  const [error, setError] = useState(""), [connecting, setConnecting] = useState(false), [name, setName] = useState("")
  const generation = useRef(0)
  const loadProjects = async (connection: Platform) => {
    const found: ProjectRecord[] = []; let query = ""
    do { const page = await connection.api.projects(query); found.push(...page.data); query = page.meta.page?.nextCursor ? `?cursor=${encodeURIComponent(page.meta.page.nextCursor)}` : "" } while (query)
    return found
  }
  return <main className="web-workspace p-5 md:p-8">
    <header className="mx-auto mb-6 flex max-w-7xl flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Knowledge Workspace</h1><p className="muted mt-1">共享知识工作区 · Web</p></div>{platform && <button onClick={() => { ++generation.current; setPlatform(null); setProjects([]); setSelected(""); setKey(""); setError("") }}>断开连接</button>}</header>
    {!platform ? <form className="panel mx-auto max-w-md space-y-5" onSubmit={async event => {
      event.preventDefault(); const version = ++generation.current; setConnecting(true); setError("")
      try { const connection = createWebPlatform(location.origin, key); const found = await loadProjects(connection); if (version !== generation.current) return; setPlatform(connection); setProjects(found); setSelected(found[0]?.id ?? ""); setKey("") }
      catch (error) { if (version === generation.current) setError(message(error)) }
      finally { if (version === generation.current) setConnecting(false) }
    }}><h2 className="text-lg">连接知识库服务</h2><p className="muted">使用管理员提供的服务访问密钥连接。密钥只保留在当前页面内存中。</p><label>服务访问密钥<input type="password" autoComplete="off" required value={key} onChange={event => setKey(event.target.value)} /></label>{error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={connecting}>{connecting ? "连接中…" : "连接服务"}</button></form>
    : <div className="mx-auto max-w-7xl space-y-4"><section className="panel flex flex-wrap items-end gap-4"><label>当前项目<select aria-label="当前项目" value={selected} onChange={event => setSelected(event.target.value)}><option value="">选择项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><form className="flex gap-2" onSubmit={async event => {
      event.preventDefault(); const version = generation.current
      try { const result = await platform.api.createProject(name); const found = await loadProjects(platform); if (version !== generation.current) return; setProjects(found); setSelected(result.data.id); setName(""); setError("") } catch (error) { if (version === generation.current) setError(message(error)) }
    }}><input aria-label="新项目名称" placeholder="新项目名称" required maxLength={120} value={name} onChange={event => setName(event.target.value)} /><button>创建项目</button></form></section>{error && <p role="alert" className="error">{error}</p>}{selected && <ProjectPanel key={selected} platform={platform} project={projects.find(project => project.id === selected)!} />}</div>}
  </main>
}
function ProjectPanel({ platform, project }: { platform: Platform; project: ProjectRecord }) {
  const workspace = useMemo(() => createRemoteWorkspace(platform.api, project.id), [platform, project.id])
  const [snapshot, setSnapshot] = useState<ResourceRecord<SharedWorkspace> | null>(null)
  const [wiki, setWiki] = useState<ResourceRecord<WikiContent>[]>([]), [documents, setDocuments] = useState<ResourceRecord<ReceivedDocument>[]>([])
  const [tab, setTab] = useState("wiki"), [connection, setConnection] = useState<ConnectionState>("connecting")
  const [path, setPath] = useState("wiki/queries/new-page.md"), [content, setContent] = useState(""), [revision, setRevision] = useState<number | null>(null)
  const [selectedMemory, setSelectedMemory] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [updated, setUpdated] = useState(false)
  const alive = useRef(true), pageGeneration = useRef(0), dirty = useRef(false)
  const resources = async () => {
    const all = async <T,>(load: (query: string) => Promise<{ data: T[]; meta: { page?: { nextCursor: string | null } } }>) => {
      const result: T[] = []; let query = ""
      do { const page = await load(query); result.push(...page.data); query = page.meta.page?.nextCursor ? `?cursor=${encodeURIComponent(page.meta.page.nextCursor)}` : "" } while (query)
      return result
    }
    const [pages, files] = await Promise.all([all(query => platform.api.wiki(project.id, query)), all(query => platform.api.documents(project.id, query))])
    if (alive.current) { setWiki(pages); setDocuments(files as ResourceRecord<ReceivedDocument>[]) }
  }
  const reload = async () => {
    setBusy(true)
    try { const value = await workspace.load(); await resources(); if (alive.current) { setSnapshot(value); setRevision(null); setContent(""); setPath("wiki/queries/new-page.md"); setError(""); setUpdated(false); dirty.current = false; ++pageGeneration.current } }
    catch (error) { if (alive.current) setError(message(error)) }
    finally { if (alive.current) setBusy(false) }
  }
  useEffect(() => {
    alive.current = true; void reload()
    const controller = new AbortController()
    const stop = platform.watch(project.id, () => { if (alive.current) setUpdated(true) }, state => { if (alive.current) setConnection(state) }, controller.signal)
    const guard = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = "" } }
    window.addEventListener("beforeunload", guard)
    return () => { alive.current = false; ++pageGeneration.current; controller.abort(); stop(); window.removeEventListener("beforeunload", guard) }
  }, [workspace])
  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError("")
    try { await operation(); if (alive.current) { setSnapshot(workspace.snapshot()); return true } return false }
    catch (error) { if (alive.current) setError(message(error)); return false }
    finally { if (alive.current) setBusy(false) }
  }
  return <section className="panel space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><nav role="tablist" aria-label="项目功能" className="flex flex-wrap gap-2">{[["wiki", "Wiki"], ["documents", "文档"], ["memories", "记忆库"], ["domains", "知识领域"]].map(([id, label]) => <button role="tab" key={id} aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav><p role="status" className="muted">事件连接：{connection === "connected" ? "已连接" : connection === "reconnecting" ? "重连中" : connection === "error" ? "连接失败" : "连接中"}</p></header>
    {(error || updated) && <div role="alert" className={error ? "error" : "muted"}><p>{error || "服务已有新变更，可刷新读取。"}</p><button className="mt-2" disabled={busy} onClick={() => void reload()}>刷新资源（放弃未保存内容）</button></div>}
    {tab === "wiki" && <div className="grid gap-5 lg:grid-cols-[230px_1fr]"><aside className="space-y-2"><button disabled={busy} onClick={() => { ++pageGeneration.current; setPath("wiki/queries/new-page.md"); setContent(""); setRevision(null); dirty.current = false }}>新建 Wiki</button>{wiki.map(page => <button className="block w-full truncate text-left text-xs" key={page.key} disabled={busy} onClick={async () => {
      const version = ++pageGeneration.current; setBusy(true)
      try { const record = (await platform.api.readWiki(project.id, page.key)).data; if (alive.current && version === pageGeneration.current) { setPath(record.data.path); setContent(record.data.content); setRevision(record.revision); dirty.current = false } }
      catch (error) { if (alive.current) setError(message(error)) }
      finally { if (alive.current) setBusy(false) }
    }}>{page.key}</button>)}</aside><div className="space-y-3"><label>Wiki 路径<input aria-label="Wiki 路径" disabled={revision !== null || busy} value={path} onChange={event => setPath(event.target.value)} /></label><label>Wiki 正文<textarea className="min-h-64 font-mono text-sm" aria-label="Wiki 正文" disabled={busy} value={content} onChange={event => { setContent(event.target.value); dirty.current = true }} /></label><div className="flex gap-2"><button className="primary" disabled={busy} onClick={async () => {
      setBusy(true); setError("")
      try { const record = (await platform.api.saveWiki(project.id, path, content, revision)).data; if (alive.current) { setRevision(record.revision); setPath(record.data.path); dirty.current = false; await resources() } }
      catch (error) { if (alive.current) setError(message(error)) }
      finally { if (alive.current) setBusy(false) }
    }}>保存 Wiki</button><button onClick={() => void navigator.clipboard.writeText(content)}>复制草稿</button><span className="muted self-center">{revision === null ? "未创建" : `版本 ${revision}`}</span></div><article className="prose dark:prose-invert max-w-none border-t pt-4"><ReactMarkdown>{content}</ReactMarkdown></article></div></div>}
    {tab === "documents" && <div className="space-y-4"><label>上传原始文档<input aria-label="上传原始文档" type="file" disabled={busy} onChange={async event => {
      const file = event.target.files?.[0]; if (!file) return; setBusy(true); setError("")
      try { await platform.upload(project.id, file); if (alive.current) await resources() } catch (error) { if (alive.current) setError(message(error)) } finally { if (alive.current) setBusy(false) }
    }} /></label><p className="muted">上传仅表示服务已接收原始文件；解析、入库和索引不会被标为已完成。最大 16 MiB。</p>{documents.map(record => <div key={record.key} className="rounded-lg border p-3"><b>{record.data.name}</b><p className="muted">已接收 · {record.data.size} 字节 · {record.data.receivedAt}</p></div>)}</div>}
    {tab === "memories" && snapshot && <div className="min-h-[600px]"><MemoryLibrary key={snapshot.revision} memories={snapshot.data.memories} domains={snapshot.data.domains} loading={false} saving={busy} error={error || null} selected={selectedMemory} onSelect={setSelectedMemory} onRetry={() => void reload()} onSave={record => mutate(() => workspace.saveMemory(record))} onRemove={id => mutate(() => workspace.removeMemory(id))} /></div>}
    {tab === "domains" && snapshot && <DomainTagEditor domains={snapshot.data.domains} loading={false} saving={busy} error={error || null} onRetry={() => void reload()} onAdd={tag => mutate(() => workspace.addDomain(tag))} onRemove={id => mutate(() => workspace.removeDomain(id))} onToggle={(path, id) => mutate(() => workspace.toggleDomain(path, id))} />}
    <footer className="muted border-t pt-3">Web 使用服务端资源；本机 Shell、文件监听和 Obsidian Vault 需本机连接器。</footer>
  </section>
}
