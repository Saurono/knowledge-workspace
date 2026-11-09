import { useEffect, useRef, useState } from "react"
import type { ReceivedDocument } from "@/modules/service-api/application"

type Props = { projectId: string; projectName: string; documents: ReceivedDocument[]; enabled: boolean }
type Session = { token: string; endpoint: string }
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
const revokeSession = (session: Session | null) => {
  if (session) void fetch(`${session.endpoint}/revoke`, { method: "POST", headers: { Authorization: `Bearer ${session.token}` } }).catch(() => {})
}
export function VaultConnectorPanel({ projectId, projectName, documents, enabled }: Props) {
  const session = useRef<Session | null>(null), generation = useRef(0), alive = useRef(false)
  const [port, setPort] = useState("4319")
  const [code, setCode] = useState(""), [state, setState] = useState("未连接"), [expires, setExpires] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("")
  const [results, setResults] = useState<Record<string, string>>({})
  const endpoint = `http://127.0.0.1:${port}`
  useEffect(() => {
    alive.current = true
    ++generation.current
    const old = session.current; session.current = null; revokeSession(old)
    setState("未连接"); setExpires(""); setResults({}); setBusy(false)
    return () => { alive.current = false; ++generation.current; const current = session.current; session.current = null; revokeSession(current) }
  }, [projectId, projectName, enabled])
  useEffect(() => {
    const check = async () => {
      const captured = session.current, current = generation.current
      if (!captured) return
      try {
        const response = await fetch(`${captured.endpoint}/status`, { headers: { Authorization: `Bearer ${captured.token}` } })
        if (!response.ok) throw new Error("连接已过期或已撤销")
        const body = await response.json()
        if (!alive.current || current !== generation.current || session.current !== captured) return
        if (body.projectId !== projectId) { session.current = null; ++generation.current; revokeSession(captured); setState("未连接"); setExpires(""); return }
        setState("已连接"); setExpires(body.expiresAt)
      } catch (e) {
        if (alive.current && current === generation.current && session.current === captured) { session.current = null; setState("连接断开"); setError(errorText(e)) }
      }
    }
    const timer = setInterval(() => void check(), 5000)
    return () => clearInterval(timer)
  }, [projectId, endpoint])
  const changePort = (value: string) => {
    setPort(value); ++generation.current
    const old = session.current; session.current = null; revokeSession(old)
    setState("未连接"); setExpires(""); setResults({}); setBusy(false); setError("")
  }
  const revoke = async () => {
    const old = session.current; ++generation.current; session.current = null
    setState("未连接"); setExpires(""); setBusy(false); setResults({})
    if (old) await fetch(`${old.endpoint}/revoke`, { method: "POST", headers: { Authorization: `Bearer ${old.token}` } }).catch(() => {})
  }
  const pair = async (event: React.FormEvent) => {
    event.preventDefault(); const current = generation.current, capturedEndpoint = endpoint
    setBusy(true); setError("")
    try {
      const response = await fetch(`${capturedEndpoint}/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || "配对失败")
      const paired: Session = { token: value.token, endpoint: capturedEndpoint }
      if (current !== generation.current || !alive.current || value.projectId !== projectId) { revokeSession(paired); return }
      const prior = session.current; session.current = paired; revokeSession(prior)
      setExpires(value.expiresAt); setState("已连接"); setCode("")
    } catch (e) { if (alive.current && current === generation.current) setError(window.location.protocol === "https:" && e instanceof TypeError ? "此 HTTPS 页面无法连接本机连接器。请在本机终端使用 KW_DOCUMENT_ID=<文档 ID> node dist-service/vault-connector.mjs --pull 完成本机回执拉取。" : errorText(e)) }
    finally { if (alive.current && current === generation.current) setBusy(false) }
  }
  const sync = async (id: string) => {
    const captured = session.current, current = generation.current
    if (!captured) return
    setResults(r => ({ ...r, [id]: "同步中" }))
    try {
      const response = await fetch(`${captured.endpoint}/sync`, { method: "POST", headers: { Authorization: `Bearer ${captured.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ documentId: id }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "同步失败")
      if (alive.current && current === generation.current && session.current === captured) setResults(r => ({ ...r, [id]: "已同步" }))
    } catch (e) { if (alive.current && current === generation.current && session.current === captured) setResults(r => ({ ...r, [id]: `待重试：${errorText(e)}` })) }
  }
  if (!enabled) return null
  return <section className="rounded-lg border p-4 space-y-3" aria-label="本机 Obsidian Vault 连接器"><h3>本机 Obsidian Vault</h3><p className="muted">将此已授权项目的处理回执同步到本机选定的 Vault；原笔记保持不变。</p><details><summary>连接器未启动？本机启动方法</summary><p className="muted">在已安装知识工作区的本机终端中按《analysis/implementation/d08-local-vault-connector-contract.md》配置当前项目、选定 Vault、本机服务地址及本机凭据，然后运行 <code>node dist-service/vault-connector.mjs</code>。不要把凭据填入网页。进程启动后将终端显示的一次性配对码填入下方。</p><p className="muted">如果 HTTPS 页面受浏览器策略限制而无法连接，请在同一终端设置 <code>$env:KW_DOCUMENT_ID="文档 ID"</code>，再运行 <code>node dist-service/vault-connector.mjs --pull</code>，直接将该文档回执拉取到已配置 Vault。连接器端口默认 4319，主机固定为 127.0.0.1。</p></details><label>本机连接器端口<input aria-label="连接器端口" inputMode="numeric" value={port} onChange={e => changePort(e.target.value)} /></label><p role="status">项目：{projectName} · {state}{expires && ` · 到期 ${expires}`}</p><form onSubmit={pair} className="flex gap-2"><input aria-label="连接器配对码" type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} placeholder="输入本机显示的一次性配对码"/><button disabled={busy || !code || !/^[0-9]+$/.test(port) || Number(port)<1 || Number(port)>65535}>配对</button></form>{error && <p role="alert" className="error">{error}</p>}<button disabled={state !== "已连接"} onClick={() => void revoke()}>撤销连接</button><ul>{documents.map(data => <li key={data.id} className="flex justify-between gap-2"><span>{data.name} · {results[data.id] ?? "未同步"}</span><button disabled={state !== "已连接"} onClick={() => void sync(data.id)}>同步回执</button></li>)}</ul></section>
}
