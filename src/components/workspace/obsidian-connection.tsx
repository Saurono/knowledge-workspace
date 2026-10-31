import { useEffect, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import { useWikiStore } from "@/stores/wiki-store"
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
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    setRecords(null)
    if (project)
      void loadIngestRecords(project.path)
        .then((data) => {
          if (active) setRecords(data)
        })
        .catch((e) => {
          if (active) setError(String(e))
        })
    return () => {
      active = false
    }
  }, [project, dataVersion])
  if (!project) return null
  const pending = Object.values(records?.receipts ?? {}).filter((r) => r.delivery === "pending")
  const action = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await fn()
      const next = await loadIngestRecords(project.path)
      if (useWikiStore.getState().project?.path === project.path) setRecords(next)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
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
      </div>
      {pending.map((r) => (
        <p key={r.id} className="text-muted-foreground">
          {t("workspace.deliveryPending")}: {r.sourcePath} {r.error}
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
