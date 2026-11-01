export const API_VERSION = "v1"
export type ErrorCode = "invalid_argument" | "unauthenticated" | "forbidden" | "not_found" | "conflict" | "precondition_required" | "too_large" | "unsupported" | "internal"
export const ERROR_STATUS: Record<ErrorCode, number> = { invalid_argument: 400, unauthenticated: 401, forbidden: 403, not_found: 404, conflict: 409, precondition_required: 428, too_large: 413, unsupported: 501, internal: 500 }
export class ServiceError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly details?: Record<string, unknown>) { super(message); this.name = "ServiceError" }
}
export interface ApiMeta { requestId: string; page?: { nextCursor: string | null } }
export interface ApiSuccess<T> { data: T; meta: ApiMeta }
export interface ApiFailure { error: { code: ErrorCode; message: string; requestId: string; details?: Record<string, unknown> } }
export type ResourceKind = "wiki" | "workspace" | "document"
export interface ProjectRecord { id: string; name: string; createdAt: string }
export interface ResourceRecord<T = unknown> { projectId: string; kind: ResourceKind; key: string; data: T; revision: number; createdAt: string; updatedAt: string }
export interface WikiContent { path: string; content: string }
export interface ProjectEvent { sequence: number; projectId: string; type: string; resource: { kind: ResourceKind | "project"; key: string; revision: number }; recordedAt: string }
export interface Page<T> { items: T[]; nextCursor: string | null }
export const etag = (revision: number) => `"v${revision}"`
export function parsePrecondition(headers: { match?: string; noneMatch?: string }): number | null {
  if (headers.match && headers.noneMatch) throw new ServiceError("invalid_argument", "Use exactly one version precondition")
  if (headers.noneMatch === "*") return null
  const match = headers.match?.match(/^"v([1-9]\d*)"$/)
  const revision = match ? Number(match[1]) : NaN
  if (Number.isSafeInteger(revision) && revision > 0) return revision
  if (headers.match || headers.noneMatch) throw new ServiceError("invalid_argument", "Invalid resource version")
  throw new ServiceError("precondition_required", "Use If-Match for an update or If-None-Match: * for creation")
}
export function pageInput(scope: string, limit?: string | number | null, cursor?: string | null) {
  const size = limit == null ? 50 : Number(limit)
  if (!Number.isInteger(size) || size < 1 || size > 200) throw new ServiceError("invalid_argument", "Page limit must be between 1 and 200")
  let after = ""
  if (cursor) {
    try {
      const decoded = JSON.parse(decodeURIComponent(cursor))
      if (decoded.version !== 1 || decoded.scope !== scope || typeof decoded.after !== "string") throw new Error()
      after = decoded.after
    } catch { throw new ServiceError("invalid_argument", "Invalid pagination cursor") }
  }
  return { limit: size, after }
}
export const pageCursor = (scope: string, after: string) => encodeURIComponent(JSON.stringify({ version: 1, scope, after }))
export function requireId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw new ServiceError("invalid_argument", "Invalid project identifier")
  return value
}
