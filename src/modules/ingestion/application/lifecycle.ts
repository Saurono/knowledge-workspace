import { beginStage, finishStage, recoverInterrupted, retryStage, validateCheckpoint } from "../domain/checkpoint"
import type { IngestionCheckpointV1, IngestionStage, StageError } from "../domain/checkpoint"
export interface IngestionCheckpointRepository {
  read(projectId: string, documentId: string): Promise<{ revision: number; checkpoint: IngestionCheckpointV1 } | null>
  save(projectId: string, documentId: string, expectedRevision: number, checkpoint: IngestionCheckpointV1): Promise<{ revision: number; checkpoint: IngestionCheckpointV1 }>
}
export type IngestionLifecycleErrorCode = "invalid_argument" | "not_found" | "conflict" | "internal"
export class IngestionLifecycleError extends Error {
  constructor(public readonly code: IngestionLifecycleErrorCode, message: string) { super(message); this.name = "IngestionLifecycleError" }
}
function mapError(error: unknown): never {
  if (error instanceof IngestionLifecycleError) throw error
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined
  if (code === "invalid_argument" || code === "not_found" || code === "conflict") throw new IngestionLifecycleError(code, error instanceof Error ? error.message : "Ingestion operation failed")
  throw error
}
function validId(value: string) { return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) }
function validRevision(revision: number): boolean { return Number.isSafeInteger(revision) && revision > 0 }
export function createIngestionLifecycleService(repository: IngestionCheckpointRepository) {
  async function read(projectId: string, documentId: string) {
    if (!validId(projectId) || !validId(documentId)) throw new IngestionLifecycleError("invalid_argument", "Invalid project or document identifier")
    let current
    try { current = await repository.read(projectId, documentId) } catch (error) { mapError(error) }
    if (current) {
      if (!validRevision(current.revision)) throw new IngestionLifecycleError("invalid_argument", "Invalid checkpoint revision")
      try { validateCheckpoint(current.checkpoint) } catch (error) { mapError(error) }
      if (current.checkpoint.projectId !== projectId || current.checkpoint.documentId !== documentId) throw new IngestionLifecycleError("invalid_argument", "Checkpoint ownership mismatch")
    }
    return current
  }
  async function mutate(projectId: string, documentId: string, expectedRevision: number, change: (checkpoint: IngestionCheckpointV1) => IngestionCheckpointV1) {
    if (!validRevision(expectedRevision)) throw new IngestionLifecycleError("invalid_argument", "Expected revision must be a positive safe integer")
    const current = await read(projectId, documentId)
    if (!current) throw new IngestionLifecycleError("not_found", "Checkpoint not found")
    if (current.revision !== expectedRevision) throw new IngestionLifecycleError("conflict", "Checkpoint revision conflict")
    let checkpoint: IngestionCheckpointV1
    try { checkpoint = change(current.checkpoint); validateCheckpoint(checkpoint) } catch (error) { mapError(error) }
    if (checkpoint.projectId !== projectId || checkpoint.documentId !== documentId) throw new IngestionLifecycleError("invalid_argument", "Checkpoint ownership mismatch")
    try { return await repository.save(projectId, documentId, expectedRevision, checkpoint) } catch (error) { mapError(error) }
  }
  return {
    read,
    begin: (projectId: string, documentId: string, expectedRevision: number, stage: IngestionStage, input: { attemptId: string; now: string }) => mutate(projectId, documentId, expectedRevision, checkpoint => beginStage(checkpoint, stage, input)),
    finish: (projectId: string, documentId: string, expectedRevision: number, stage: IngestionStage, input: { attempt: number; attemptId: string; now: string; outcome: "succeeded" | "failed" | "blocked" | "cancelled"; evidence?: string[]; error?: StageError }) => mutate(projectId, documentId, expectedRevision, checkpoint => finishStage(checkpoint, stage, input)),
    retry: (projectId: string, documentId: string, expectedRevision: number, stage: IngestionStage, now: string) => mutate(projectId, documentId, expectedRevision, checkpoint => retryStage(checkpoint, stage, now)),
    recover: async (projectId: string, documentId: string, expectedRevision: number, now: string) => {
      if (!validRevision(expectedRevision)) throw new IngestionLifecycleError("invalid_argument", "Expected revision must be a positive safe integer")
      const current = await read(projectId, documentId)
      if (!current) throw new IngestionLifecycleError("not_found", "Checkpoint not found")
      if (current.revision !== expectedRevision) throw new IngestionLifecycleError("conflict", "Checkpoint revision conflict")
      let checkpoint: IngestionCheckpointV1
      try { checkpoint = recoverInterrupted(current.checkpoint, now) } catch (error) { mapError(error) }
      if (checkpoint === current.checkpoint) return current
      try { return await repository.save(projectId, documentId, expectedRevision, checkpoint) } catch (error) { mapError(error) }
    },
  }
}
