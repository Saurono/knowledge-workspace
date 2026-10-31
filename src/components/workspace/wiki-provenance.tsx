import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useWikiStore } from "@/stores/wiki-store"
import { loadIngestRecords, type IngestRecords } from "@/lib/ingest-receipts"
import { normalizePath } from "@/lib/path-utils"

export function WikiProvenance({ filePath }: { filePath: string }) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const [records, setRecords] = useState<IngestRecords | null>(null)
  useEffect(() => {
    let active = true
    setRecords(null)
    if (project)
      void loadIngestRecords(project.path)
        .then((value) => {
          if (active) setRecords(value)
        })
        .catch(() => {})
    return () => {
      active = false
    }
  }, [project, filePath, dataVersion])
  if (!project) return null
  const relative = normalizePath(filePath).replace(`${normalizePath(project.path)}/`, "")
  if (!relative.startsWith("wiki/")) return null
  const page = records?.pages[relative]
  const format = (date: string | null | undefined) =>
    date ? new Date(date).toLocaleString() : t("workspace.unknownTime")
  return (
    <div className="space-y-1 border-b px-3 py-2 text-xs text-muted-foreground">
      <p>
        {t("workspace.wikiCreatedAt")}: {format(page?.createdAt)}
      </p>
      {page?.sources.map((source) => (
        <p key={source} className="break-all">
          {t("workspace.sourceIngestedAt")} · {source}:{" "}
          {format(records?.sources[source]?.ingestedAt)}
        </p>
      ))}
      {!page?.sources.length && (
        <p>
          {t("workspace.sourceIngestedAt")}: {t("workspace.unknownTime")}
        </p>
      )}
    </div>
  )
}
