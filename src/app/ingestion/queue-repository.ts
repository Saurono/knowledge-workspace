import { fileExists, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { QueueSnapshotRepository } from "@/modules/ingestion/application"

const snapshotPath = (projectPath: string) =>
  `${normalizePath(projectPath)}/.llm-wiki/ingest-queue.json`

/** Existing v1 storage location/encoding; serialization order belongs to the service. */
export const localQueueSnapshots: QueueSnapshotRepository = {
  read: async (projectPath) => {
    const path = snapshotPath(projectPath)
    return await fileExists(path) ? readFile(path) : null
  },
  write: (projectPath, snapshot) => writeFile(snapshotPath(projectPath), snapshot),
}
