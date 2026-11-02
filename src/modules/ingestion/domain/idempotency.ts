export const INGEST_COMPILE_OPERATION = "compile" as const

/** Stable operation identity; paths, attempts and random queue IDs are excluded. */
export function ingestionIdempotencyKey(
  projectId: string,
  sourceId: string,
  revision: string,
  operation: typeof INGEST_COMPILE_OPERATION = INGEST_COMPILE_OPERATION,
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(projectId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sourceId) || !/^[a-f0-9]{64}$/.test(revision) || operation !== INGEST_COMPILE_OPERATION)
    throw Object.assign(new Error("Invalid ingestion idempotency identity"), { code: "invalid_argument" })
  return `ingest-v1:${projectId}:${sourceId}:${revision}:${operation}`
}

export function isCanonicalIngestionIdempotencyKey(projectId: string, sourceId: string, revision: string, key: string): boolean {
  try { return ingestionIdempotencyKey(projectId, sourceId, revision) === key } catch { return false }
}
