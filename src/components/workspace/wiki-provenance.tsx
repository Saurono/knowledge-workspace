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
  const pageAbsolute = normalizePath(filePath)
  const projectRoot = normalizePath(project.path).replace(/\/+$/, "")
  const relative = pageAbsolute.toLowerCase().startsWith(`${projectRoot.toLowerCase()}/`)
    ? pageAbsolute.slice(projectRoot.length + 1)
    : ""
  if (!relative.startsWith("wiki/")) return null
  const page = records?.pages[relative]
  const sourceReceipt = (sourcePath: string) => {
    const source = records?.sources[sourcePath]
    if (!source?.contentRevision) return undefined
    return records?.receipts[`${source.id}-${source.contentRevision}`]
  }
  const format = (date: string | null | undefined) =>
    date ? new Date(date).toLocaleString() : t("workspace.unknownTime")
  return (
    <div className="space-y-1 border-b px-3 py-2 text-xs text-muted-foreground">
      <p>
        {t("workspace.wikiCreatedAt")}: {format(page?.createdAt)}
      </p>
      {page?.sources.map((source) => (
        <div key={source} className="break-all">
          <p>{t("workspace.sourceReceivedAt", "Source received")}: {format(records?.sources[source]?.receivedAt)}</p>
          <p>{t("workspace.sourceIngestedAt")}: {format(records?.sources[source]?.ingestedAt)}</p>
          <p>{t("workspace.sourceRevisionIngestedAt", "Revision ingested")}: {format(sourceReceipt(source)?.revisionIngestedAt)}</p>
          <p>{t("workspace.sourceOrigin", "Source")}: {records?.sources[source]?.originalPath ?? t("workspace.unknownTime")}</p>
        </div>
      ))}
      {!page?.sources.length && (
        <p>
          {t("workspace.sourceIngestedAt")}: {t("workspace.unknownTime")}
        </p>
      )}
    </div>
  )
}
