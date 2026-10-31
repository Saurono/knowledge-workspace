import { createDirectory, fileExists, writeFileAtomic } from "@/commands/fs"
import { isAbsolutePath } from "@/lib/path-utils"
import { createObsidianService } from "@/modules/obsidian/application"
import { RECEIPT_DIRECTORY } from "@/modules/obsidian/domain"
import { loadIngestRecords, saveRecords, withRecordsLock } from "@/app/document-records/repository"
export const obsidian = createObsidianService({
  update: (projectPath, change) => withRecordsLock(projectPath, async () => {
    const records = await loadIngestRecords(projectPath)
    if (await change(records)) await saveRecords(projectPath, records)
  }),
}, {
  isAbsolute: isAbsolutePath, exists: path => fileExists(path),
  writeReceipt: async (vaultPath, fileName, payload) => {
    const directory = `${vaultPath}/${RECEIPT_DIRECTORY}`
    await createDirectory(directory)
    await writeFileAtomic(`${directory}/${fileName}`, JSON.stringify(payload, null, 2))
  },
})
export const configureObsidianVault = obsidian.configure
export const deliverObsidianReceipt = obsidian.deliver
