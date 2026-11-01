import { mkdir, open, rename, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import type { UploadStorage } from "@/modules/service-api/application"
import { requireId } from "@/modules/service-api/domain"
export class DiskUploads implements UploadStorage {
  constructor(private root: string) {}
  private path(projectId: string, id: string) { return join(this.root, "uploads", requireId(projectId), requireId(id), "source.bin") }
  async write(projectId: string, id: string, bytes: Uint8Array) {
    const directory = join(this.root, "uploads", requireId(projectId), requireId(id))
    await mkdir(join(this.root, "uploads", requireId(projectId)), { recursive: true, mode: 0o700 })
    // Reserve a new document directory; never replace an earlier upload.
    await mkdir(directory, { mode: 0o700 })
    const temporary = join(directory, "source.partial")
    try {
      const file = await open(temporary, "wx", 0o600)
      try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
      await rename(temporary, this.path(projectId, id))
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
  }
  async read(projectId: string, id: string) { return readFile(this.path(projectId, id)) }
  async remove(projectId: string, id: string) { await rm(join(this.root, "uploads", requireId(projectId), requireId(id)), { recursive: true, force: true }) }
}
