import { lstat, readdir, rm } from "node:fs/promises"
import { join } from "node:path"

export interface OrphanUpload {
  projectId: string
  sourceId: string
  bytes: number
  /** Latest immediate regular-file mtime, or null when there are no files. */
  modifiedAt: string | null
}

export interface OrphanScan {
  orphans: OrphanUpload[]
  totalBytes: number
  /** Real project/upload directories visited; files, symlinks and deeper directories are skipped. */
  scannedProjects: number
  scannedUploads: number
}

export async function scanOrphanUploads(options: {
  root: string
  listDocumentSourceIds: (projectId: string) => Promise<string[]>
}): Promise<OrphanScan> {
  const result: OrphanScan = { orphans: [], totalBytes: 0, scannedProjects: 0, scannedUploads: 0 }
  const base = join(options.root, "uploads")
  let projects
  try {
    if (!(await lstat(base)).isDirectory()) return result
    projects = await readdir(base, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return result
    throw error
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    result.scannedProjects++
    const known = new Set(await options.listDocumentSourceIds(project.name))
    const projectPath = join(base, project.name)
    for (const upload of await readdir(projectPath, { withFileTypes: true })) {
      if (!upload.isDirectory()) continue
      result.scannedUploads++
      if (known.has(upload.name)) continue
      const directory = join(projectPath, upload.name)
      let bytes = 0
      let latest: number | null = null
      for (const file of await readdir(directory, { withFileTypes: true })) {
        if (!file.isFile()) continue
        const info = await lstat(join(directory, file.name))
        if (!info.isFile()) continue
        bytes += info.size
        if (Number.isFinite(info.mtimeMs)) latest = Math.max(latest ?? -Infinity, info.mtimeMs)
      }
      result.orphans.push({ projectId: project.name, sourceId: upload.name, bytes,
        modifiedAt: latest === null ? null : new Date(latest).toISOString() })
      result.totalBytes += bytes
    }
  }
  return result
}

export async function removeOrphanUploads(options: {
  root: string
  orphans: readonly OrphanUpload[]
}): Promise<{ removed: number; failed: Array<{ projectId: string; sourceId: string; reason: string }> }> {
  const result = { removed: 0, failed: [] as Array<{ projectId: string; sourceId: string; reason: string }> }
  for (const { projectId, sourceId } of options.orphans) {
    try {
      for (const id of [projectId, sourceId]) {
        if (!id || id === "." || id === ".." || /[\\/:\0]/.test(id)) throw new Error("Invalid upload path segment")
      }
      const base = join(options.root, "uploads")
      for (const directory of [base, join(base, projectId), join(base, projectId, sourceId)]) {
        if (!(await lstat(directory)).isDirectory()) throw new Error(`Not a real directory: ${directory}`)
      }
      await rm(join(base, projectId, sourceId), { recursive: true, force: false })
      result.removed++
    } catch (error) {
      result.failed.push({ projectId, sourceId, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return result
}

export function createProjectDocumentSourceLister(repository: {
  list(projectId: string, kind: "document", after: string, limit: number): Promise<Array<{ data: unknown }>>
}): (projectId: string) => Promise<string[]> {
  return async projectId => {
    const sources: string[] = []
    let after = ""
    const cursors = new Set<string>()
    for (;;) {
      const page = await repository.list(projectId, "document", after, 200)
      for (const record of page) {
        if (record.data && typeof record.data === "object" && "sourceId" in record.data && typeof record.data.sourceId === "string") {
          sources.push(record.data.sourceId)
        }
      }
      if (page.length < 200) return sources
      const last = page[page.length - 1]
      const key = last && "key" in last ? last.key : undefined
      if (typeof key !== "string" || !key || cursors.has(key)) throw new Error("Document pagination has no advancing key")
      cursors.add(key)
      after = key
    }
  }
}
