import type { MemoryWriteResult } from "./service"
export type MemoryWriteErrorCode = "version_conflict" | "idempotency_conflict" | "invalid_argument" | "not_found"
export class MemoryWriteError extends Error {
  constructor(readonly code: MemoryWriteErrorCode, message: string, readonly currentVersion?: number, readonly replay?: MemoryWriteResult) {
    super(message)
    this.name = "MemoryWriteError"
  }
}
