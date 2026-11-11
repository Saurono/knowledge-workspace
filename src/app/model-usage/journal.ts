import { createDirectory, fileExists, listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath, isAbsolutePath } from "@/lib/path-utils"
import type { UsageJournal, UsageRecord } from "@/modules/model-gateway"

export function createProjectUsageJournal(root: string): UsageJournal {
  const base = normalizePath(root)
  if (!isAbsolutePath(base) || base.split("/").some(p => p === "." || p === "..")) throw new Error("Project path must be absolute and canonical")
  const directory = `${base.replace(/\/+$/, "")}/.llm-wiki/model-usage`
  const path = (id: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new Error("Invalid usage ID")
    return `${directory}/${id}.json`
  }
  return {
    async append(record) {
      const target = path(record.id)
      await createDirectory(directory)
      await writeFileAtomic(target, JSON.stringify(record))
    },
    async all() {
      if (!await fileExists(directory)) return []
      const records: UsageRecord[] = []
      let skipped = 0
      for (const entry of await listDirectory(directory)) {
        if (!entry.name.endsWith(".json")) continue
        try { records.push(JSON.parse(await readFile(path(entry.name.slice(0, -5)))) as UsageRecord) }
        catch (error) { skipped++; console.error("Skipping invalid usage journal file", entry.name, error) }
      }
      if (skipped) console.warn(`Skipped ${skipped} usage journal files`)
      return records
    },
  }
}
