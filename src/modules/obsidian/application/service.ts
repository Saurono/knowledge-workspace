import { normalizeVaultPath, receiptBelongsToVault, receiptPayload } from "../domain"
import type { IngestReceipt } from "../domain"
export interface ObsidianRecords { vaultPath: string | null; receipts: Record<string, IngestReceipt> }
export interface ObsidianRepository {
  /** Serialized read/change/save of the aggregate; preserve other feature fields. */
  update(projectPath: string, change: (records: ObsidianRecords) => Promise<boolean>): Promise<void>
}
export interface VaultPort {
  isAbsolute(path: string): boolean
  exists(path: string): Promise<boolean>
  /** The adapter only writes independent receipt files, never source notes. */
  writeReceipt(vaultPath: string, fileName: string, payload: ReturnType<typeof receiptPayload>): Promise<void>
}
export function createObsidianService(repository: ObsidianRepository, vault: VaultPort) {
  return {
    async configure(projectPath: string, vaultPath: string | null) {
      const normalized = vaultPath ? normalizeVaultPath(vaultPath) : null
      if (normalized && (!vault.isAbsolute(normalized) || !(await vault.exists(`${normalized}/.obsidian`))))
        throw new Error("Select an Obsidian Vault containing .obsidian")
      await repository.update(projectPath, async records => { records.vaultPath = normalized; return true })
    },
    async deliver(projectPath: string, id: string) {
      await repository.update(projectPath, async records => {
        const receipt = records.receipts[id]
        if (!receipt || !records.vaultPath || receipt.delivery === "delivered" || !receiptBelongsToVault(receipt, records.vaultPath)) return false
        try {
          if (!(await vault.exists(`${records.vaultPath}/.obsidian`))) throw new Error("Obsidian Vault is unavailable")
          await vault.writeReceipt(records.vaultPath, `${encodeURIComponent(receipt.id)}.json`, receiptPayload(receipt))
          receipt.delivery = "delivered"; receipt.error = null
        } catch (error) {
          receipt.delivery = "pending"; receipt.error = String(error)
        }
        return true
      })
    },
  }
}
