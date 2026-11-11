import { createDirectory, fileExists, listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { isAbsolutePath, normalizePath } from "@/lib/path-utils"
import { TASK_KINDS, TASK_STAGES, type TaskProtocol, type TaskStoragePort } from "@/modules/tasks"

export function createProjectTaskJournal(root: string): TaskStoragePort {
  const base = normalizePath(root)
  if (!isAbsolutePath(base) || base.split("/").some(p => p === "." || p === ".."))
    throw new Error("Project path must be absolute and canonical")
  const directory = `${base.replace(/\/+$/, "")}/.llm-wiki/tasks`
  const path = (id: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new Error("Invalid task ID")
    return `${directory}/${id}.json`
  }
  return {
    async save(task) {
      const target = path(task.id)
      await createDirectory(directory)
      await writeFileAtomic(target, JSON.stringify(task))
    },
    async load() {
      if (!await fileExists(directory)) return []
      const tasks: TaskProtocol[] = []
      let skipped = 0
      for (const entry of await listDirectory(directory)) {
        if (!entry.name.endsWith(".json")) continue
        try {
          const task = JSON.parse(await readFile(path(entry.name.slice(0, -5))))
          if (!task || typeof task.id !== "string" || !task.id ||
            !TASK_STAGES.includes(task.stage) || !TASK_KINDS.includes(task.kind)) {
            skipped++
            continue
          }
          tasks.push(task)
        } catch { skipped++ }
      }
      if (skipped) console.warn(`Skipped ${skipped} task journal files`)
      return tasks
    },
  }
}
