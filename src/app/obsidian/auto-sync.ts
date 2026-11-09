import { phaseReceipts } from "./phase-receipts"
import { isFeedbackRetryable, retryIngestionFeedback } from "@/app/ingestion/retry-feedback"
import type { PhaseReceiptV2 } from "@/modules/obsidian/domain"

export interface PhaseReceiptAutoSyncRead { vaultPath: string | null }
export interface PhaseReceiptAutoSyncResult { delivered?: number; failed?: string[] }
export interface PhaseReceiptAutoSyncPorts {
  read(projectPath: string): Promise<PhaseReceiptAutoSyncRead>
  sync(projectPath: string): Promise<PhaseReceiptAutoSyncResult>
  setInterval(callback: () => void, milliseconds: number): unknown
  clearInterval(handle: unknown): void
  onError?(projectPath: string, error: unknown): void
}

const INTERVAL_MS = 15_000

export async function syncConfiguredPhaseReceipts(projectPath: string, ports: {
  read(projectPath: string): Promise<{ vaultPath: string | null; receipts: Record<string, PhaseReceiptV2> }>
  retryFeedback(projectPath: string, receiptId: string): Promise<unknown>
  sync(projectPath: string): Promise<PhaseReceiptAutoSyncResult>
  onFeedbackError?(receiptId: string, error: unknown): void
}): Promise<PhaseReceiptAutoSyncResult> {
  const records = await ports.read(projectPath)
  if (!records.vaultPath) return { delivered: 0, failed: [] }
  for (const receipt of Object.values(records.receipts)) {
    if (!isFeedbackRetryable(receipt)) continue
    try { await ports.retryFeedback(projectPath, receipt.id) }
    catch (error) { ports.onFeedbackError?.(receipt.id, error) }
  }
  return ports.sync(projectPath)
}

export function createPhaseReceiptAutoSync(ports: PhaseReceiptAutoSyncPorts, intervalMs = INTERVAL_MS) {
  type Entry = { projectPath: string; timer: unknown; disposed: boolean; inFlight: boolean }
  let active: Entry | null = null

  const stopEntry = (entry: Entry) => {
    if (entry.disposed) return
    entry.disposed = true
    ports.clearInterval(entry.timer)
    if (active === entry) active = null
  }

  const run = async (entry: Entry) => {
    if (entry.disposed || active !== entry || entry.inFlight) return
    entry.inFlight = true
    try {
      const records = await ports.read(entry.projectPath)
      if (entry.disposed || active !== entry || !records.vaultPath) return
      const result = await ports.sync(entry.projectPath)
      if (entry.disposed || active !== entry) return
      if (result.failed?.length) ports.onError?.(entry.projectPath, new Error(`Phase receipt sync left ${result.failed.length} receipt(s) pending`))
    } catch (error) {
      // Sync errors are intentionally non-terminal. The durable receipt remains
      // pending and the next timer tick will retry it.
      if (!entry.disposed && active === entry) ports.onError?.(entry.projectPath, error)
    } finally {
      entry.inFlight = false
    }
  }

  return {
    start(projectPath: string): () => void {
      if (active?.projectPath === projectPath && !active.disposed) {
        const existing = active
        return () => stopEntry(existing)
      }
      if (active) stopEntry(active)
      const entry: Entry = { projectPath, timer: undefined, disposed: false, inFlight: false }
      active = entry
      entry.timer = ports.setInterval(() => { void run(entry) }, intervalMs)
      void run(entry)
      return () => stopEntry(entry)
    },
    dispose() { if (active) stopEntry(active) },
  }
}

const phaseReceiptAutoSync = createPhaseReceiptAutoSync({
  read: projectPath => phaseReceipts.read(projectPath),
  sync: projectPath => syncConfiguredPhaseReceipts(projectPath, {
    read: path => phaseReceipts.read(path),
    retryFeedback: retryIngestionFeedback,
    sync: path => phaseReceipts.sync(path),
    onFeedbackError: (id, error) => console.warn(`[phase-receipt-sync] feedback remains pending for ${id}:`, error),
  }),
  setInterval: (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
  clearInterval: handle => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
  onError: (projectPath, error) => console.warn(`[phase-receipt-sync] retry will continue for ${projectPath}:`, error),
})

export const startPhaseReceiptAutoSync = (projectPath: string) => phaseReceiptAutoSync.start(projectPath)
