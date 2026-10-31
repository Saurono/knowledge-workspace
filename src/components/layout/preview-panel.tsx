import { FileHistoryButton } from "@/components/editor/file-history-panel"
import { usePreviewDocument } from "@/app/wiki/use-preview-document"
import { WikiEditorStatus } from "@/modules/wiki/ui"
import { ArrowLeft, ArrowRight, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useWikiStore } from "@/stores/wiki-store"
import { getFileCategory } from "@/lib/file-types"
import { SelectedTaskIndicator } from "@/components/workspace/selected-task-indicator"
import { WikiProvenance } from "@/components/workspace/wiki-provenance"
import { WikiReader } from "@/components/editor/wiki-reader"
import { DomainTags } from "@/components/workspace/domain-tags"
import { useWorkspaceUiStore } from "@/stores/workspace-ui-store"
import { normalizePath } from "@/lib/path-utils"
import { WikiEditor } from "@/components/editor/wiki-editor"
import { FilePreview } from "@/components/editor/file-preview"
import { getFileName } from "@/lib/path-utils"

export function PreviewPanel() {
  const { t } = useTranslation()
  const wikiMode = useWorkspaceUiStore((s) => s.wikiMode)
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const fileContent = useWikiStore((s) => s.fileContent)
  const externalPreview = useWikiStore((s) => s.externalPreview)
  const closePreview = useWikiStore((s) => s.closePreview)
  const previewBackStack = useWikiStore((s) => s.previewBackStack)
  const previewForwardStack = useWikiStore((s) => s.previewForwardStack)
  const navigatePreviewBack = useWikiStore((s) => s.navigatePreviewBack)
  const navigatePreviewForward = useWikiStore((s) => s.navigatePreviewForward)
  const document = usePreviewDocument()

  if (!selectedFile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a file to preview
      </div>
    )
  }

  const category = getFileCategory(selectedFile)
  const fileName =
    externalPreview?.path === selectedFile ? externalPreview.title : getFileName(selectedFile)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={navigatePreviewBack}
            disabled={previewBackStack.length === 0}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
            title={t("preview.back")}
            aria-label={t("preview.back")}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={navigatePreviewForward}
            disabled={previewForwardStack.length === 0}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
            title={t("preview.forward")}
            aria-label={t("preview.forward")}
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <span className="truncate text-xs text-muted-foreground" title={selectedFile}>
            {fileName}
          </span>
          <SelectedTaskIndicator path={selectedFile} />
        </div>
        <button
          onClick={closePreview}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {!externalPreview && <WikiEditorStatus {...document.state} onReload={document.reload} onRetry={document.retry} onCopy={(draft) => { void navigator.clipboard.writeText(draft) }} />}
      {!externalPreview && <WikiProvenance filePath={selectedFile} />}
      {project && !externalPreview && (
        <DomainTags
          resourcePath={normalizePath(selectedFile).replace(`${normalizePath(project.path)}/`, "")}
        />
      )}
      <div className="relative flex-1 min-w-0 overflow-auto">
        {category==="markdown"&&!externalPreview&&<FileHistoryButton key={selectedFile} filePath={selectedFile} currentContent={fileContent} onRestored={document.reload} buttonClassName="right-3 top-12"/>}
        {externalPreview?.path === selectedFile ? (
          <ExternalReferencePreview
            source={externalPreview.source}
            title={externalPreview.title}
            path={externalPreview.url}
            snippet={externalPreview.snippet || fileContent}
          />
        ) : category === "markdown" && wikiMode === "preview" ? (
          <div className="mx-auto max-w-4xl p-6">
            <WikiReader body={fileContent} filePath={selectedFile} />
          </div>
        ) : category === "markdown" ? (
          <WikiEditor
            key={`${selectedFile}:${document.reloadVersion}`}
            content={fileContent}
            onSave={document.save}
            onExternalWrite={document.reload}
            filePath={selectedFile}
          />
        ) : (
          <FilePreview key={selectedFile} filePath={selectedFile} textContent={fileContent} />
        )}
      </div>
    </div>
  )
}

function ExternalReferencePreview({
  source,
  title,
  path,
  snippet,
}: {
  source: string
  title: string
  path: string
  snippet: string
}) {
  return (
    <div className="flex h-full flex-col overflow-auto p-6">
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            {source}
          </span>
          <h3 className="truncate text-sm font-medium" title={title}>
            {title}
          </h3>
        </div>
        <div className="break-all rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {path}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/60 bg-background p-4">
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">
          {snippet || "(No preview fragment returned.)"}
        </pre>
      </div>
    </div>
  )
}
