import { useEffect, useRef, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import { useWikiStore } from "@/stores/wiki-store"
import { phaseReceipts } from "@/app/obsidian/phase-receipts"
import { retryIngestionIndex } from "@/app/ingestion/retry-index"
import { retryIngestionFeedback } from "@/app/ingestion/retry-feedback"
import {
  configureObsidianVault,
  deliverObsidianReceipt,
  loadIngestRecords,
  type IngestRecords,
} from "@/lib/ingest-receipts"

export function ObsidianConnection() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const [records, setRecords] = useState<IngestRecords | null>(null)
  const [phaseRecords, setPhaseRecords] = useState<Awaited<ReturnType<typeof phaseReceipts.read>> | null>(null)
  const [phaseOwner, setPhaseOwner] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  useEffect(() => {
    const owner = ++generation.current
    let active = true
    setRecords(null)
    setPhaseRecords(null)
    setPhaseOwner(null)
    setError("")
    setBusy(false)
    if (project) void Promise.all([loadIngestRecords(project.path), phaseReceipts.read(project.path)])
      .then(async ([data, initialPhases]) => {
        if (initialPhases.vaultPath) await phaseReceipts.sync(project.path)
        const phases = await phaseReceipts.read(project.path)
        if (active && generation.current === owner) { setRecords(data); setPhaseRecords(phases); setPhaseOwner(project.path) }
      })
      .catch((e) => { if (active && generation.current === owner) setError(String(e)) })
    return () => {
      active = false
    }
  }, [project, dataVersion])
  if (!project) return null
  const pending = Object.values(records?.receipts ?? {}).filter((r) => r.delivery === "pending")
  const currentPhaseRecords = phaseOwner === project.path ? phaseRecords : null
  const activePhaseReceipts = Object.values(currentPhaseRecords?.receipts ?? {}).filter((r) => !r.supersededBy)
  const phasePending = activePhaseReceipts.filter((r) => r.delivery === "pending")
  const failedIndexes = activePhaseReceipts.filter((r) => ["failed", "blocked", "cancelled"].includes(r.stages.index.status) && r.sourceRevision !== null)
  const failedFeedback = activePhaseReceipts.filter((r) => r.checkpoint.policy.feedback === "required" && ["failed", "blocked", "cancelled"].includes(r.stages.feedback.status))
  const action = async (fn: () => Promise<void>) => {
    const owner = project.path
    const actionGeneration = generation.current
    setBusy(true)
    setError("")
    try {
      await fn()
      const [next, phases] = await Promise.all([loadIngestRecords(owner), phaseReceipts.read(owner)])
      if (generation.current === actionGeneration && useWikiStore.getState().project?.path === owner) { setRecords(next); setPhaseRecords(phases); setPhaseOwner(owner) }
    } catch (e) {
      if (generation.current === actionGeneration && useWikiStore.getState().project?.path === owner) setError(String(e))
    } finally {
      if (generation.current === actionGeneration) setBusy(false)
    }
  }
  return (
    <div className="space-y-2 rounded-lg border p-3 text-xs">
      <strong>{t("workspace.obsidian")}</strong>
      <p className="text-muted-foreground">{t("workspace.connectedVault")}</p>
      <p className="break-all">{records?.vaultPath}</p>
      <div className="flex gap-2">
        <button
          disabled={busy}
          className="rounded border px-2 py-1"
          onClick={() =>
            void action(async () => {
              const path = await open({ directory: true, multiple: false })
              if (typeof path === "string") await configureObsidianVault(project.path, path)
            })
          }
        >
          {t("workspace.chooseVault")}
        </button>
        {records?.vaultPath && (
          <button
            disabled={busy}
            className="rounded border px-2 py-1"
            onClick={() => void action(() => configureObsidianVault(project.path, null))}
          >
            {t("workspace.disconnect")}
          </button>
        )}
        {pending.length > 0 && (
          <button
            disabled={busy}
            className="rounded border px-2 py-1"
            onClick={() =>
              void action(async () => {
                for (const receipt of pending)
                  await deliverObsidianReceipt(project.path, receipt.id)
              })
            }
          >
            {t("workspace.retryDelivery")} ({pending.length})
          </button>
        )}
        {currentPhaseRecords?.vaultPath && phasePending.length > 0 && (
          <button disabled={busy} className="rounded border px-2 py-1" onClick={() => void action(async () => { await phaseReceipts.sync(project.path) })}>
            重试阶段回执 ({phasePending.length})
          </button>
        )}
      </div>
      {pending.map((r) => (
        <p key={r.id} className="text-muted-foreground">
          {t("workspace.deliveryPending")}: {r.sourcePath} {r.error}
        </p>
      ))}
      {activePhaseReceipts.map((r) => (
        <p key={r.id} className="text-muted-foreground">
          {r.sourceId} · {r.summary.status} · 索引 {r.stages.index.status} · Vault {r.delivery}{r.deliveryError ? ` · ${r.deliveryError}` : ""}{r.error ? ` · ${r.error.message}` : ""}
          {failedIndexes.includes(r) && <button disabled={busy} className="ml-2 rounded border px-2 py-1" onClick={() => void action(async () => { await retryIngestionIndex(project.path, r.id, useWikiStore.getState().embeddingConfig) })}>仅重试索引</button>}
          {failedFeedback.includes(r) && currentPhaseRecords?.vaultPath && <button disabled={busy} className="ml-2 rounded border px-2 py-1" onClick={() => void action(async () => { await retryIngestionFeedback(project.path, r.id) })}>仅重试反馈</button>}
        </p>
      ))}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
