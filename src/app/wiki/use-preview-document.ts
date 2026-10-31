import { useCallback, useEffect, useRef, useState } from "react"
import { readFile, writeFile } from "@/commands/fs"
import { useWikiStore } from "@/stores/wiki-store"
import { createWikiEditorSession } from "@/modules/wiki/application"
import { WikiRevisionConflict } from "@/modules/wiki/domain"
import { hashContentRevision } from "@/modules/documents/application"
import { getFileCategory, isBinary, isExtractedTextPreviewFile } from "@/lib/file-types"
import { normalizePath } from "@/lib/path-utils"
import { isWikiTextPath, readWikiEditorPage, wikiPages } from "./pages"
export interface PreviewSaveState {
  status: "loading" | "ready" | "saving" | "error" | "conflict"
  message?: string
  draft: string
}
export function usePreviewDocument() {
  const { project, selectedFile, previewContentPath, externalPreview } = useWikiStore()
  const [state, setState] = useState<PreviewSaveState>({ status: "loading", draft: "" })
  const [reloadVersion, setReloadVersion] = useState(0)
  const session = useRef<ReturnType<typeof createWikiEditorSession> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const epoch = useRef(0)
  const editable = useRef(false)
  const loaded = useRef("")
  const draft = useRef("")
  const generation = useRef(0)
  const forceDisk = useRef(false)
  useEffect(() => {
    const version = ++epoch.current
    let disposed = false
    session.current?.close()
    session.current = null
    if (timer.current) clearTimeout(timer.current)
    const store = useWikiStore.getState()
    const current = () => !disposed && version === epoch.current
    setState({ status: "loading", draft: "" })
    editable.current = false
    loaded.current = draft.current = ""
    const setup = async () => {
      if (!selectedFile) { store.setFileContent(""); return }
      const category = getFileCategory(selectedFile)
      const canEdit = !externalPreview && (!isBinary(category) || isExtractedTextPreviewFile(selectedFile))
      const supplied = !forceDisk.current && (previewContentPath === selectedFile || externalPreview?.path === selectedFile)
      forceDisk.current = false
      const content = supplied ? store.fileContent : canEdit
        ? project && isWikiTextPath(project.path, selectedFile)
          ? await readWikiEditorPage(project.path, selectedFile)
          : await readFile(selectedFile)
        : ""
      if (!current()) return
      loaded.current = draft.current = content
      if (project && isWikiTextPath(project.path, selectedFile) && canEdit) {
        const path = normalizePath(selectedFile).slice(normalizePath(project.path).replace(/\/+$/, "").length + 1)
        const initial = { path, content, revision: await hashContentRevision(content) }
        if (!current()) return
        session.current = createWikiEditorSession(Promise.resolve(initial), {
          save: (input) => wikiPages.save({ projectPath: project.path, path, ...input }),
        })
      }
      editable.current = canEdit
      store.setFileContent(content)
      setState({ status: "ready", draft: content })
    }
    void setup().catch(error => {
      if (current()) setState({ status: "error", message: String(error), draft: "" })
    })
    // Invalidate immediately even for project A -> B -> A in one React render.
    const unsubscribe = useWikiStore.subscribe((next, previous) => {
      if (next.selectedFile !== previous.selectedFile || next.project?.id !== previous.project?.id || next.project?.path !== previous.project?.path) {
        ++epoch.current
        setReloadVersion(value => value + 1)
        session.current?.close()
        if (timer.current) clearTimeout(timer.current)
      }
    })
    return () => {
      disposed = true
      ++epoch.current
      unsubscribe()
      session.current?.close()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [project?.id, project?.path, selectedFile, previewContentPath, externalPreview, reloadVersion])
  const save = useCallback((markdown: string, options?: { immediate?: boolean }) => {
    if (!selectedFile || externalPreview || !editable.current || state.status === "loading") return
    draft.current = markdown
    if (state.status === "conflict") {
      setState(previous => ({ ...previous, draft: markdown }))
      return
    }
    if (timer.current) clearTimeout(timer.current)
    if (markdown === loaded.current && state.status !== "saving") return
    const version = epoch.current, edit = ++generation.current, editor = session.current
    const write = async () => {
      if (version !== epoch.current) return
      setState({ status: "saving", draft: draft.current })
      try {
        if (editor) await editor.save(markdown)
        else await writeFile(selectedFile, markdown)
        if (version !== epoch.current) return
        loaded.current = markdown
        if (edit === generation.current) {
          useWikiStore.getState().setFileContent(markdown)
          setState({ status: "ready", draft: markdown })
        }
      } catch (error) {
        if (version !== epoch.current) return
        setState({ status: error instanceof WikiRevisionConflict ? "conflict" : "error", message: String(error), draft: draft.current })
      }
    }
    if (options?.immediate) void write()
    else timer.current = setTimeout(() => void write(), 1000)
  }, [selectedFile, externalPreview, state.status])
  return {
    state, save,
    retry: () => {
      if (editable.current) save(draft.current, { immediate: true })
      else { forceDisk.current = true; setReloadVersion(value => value + 1) }
    },
    reload: () => { forceDisk.current = true; setReloadVersion(value => value + 1) },
    reloadVersion,
  }
}
