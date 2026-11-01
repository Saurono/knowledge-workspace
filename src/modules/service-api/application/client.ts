import { ServiceError } from "../domain"
import type { ApiSuccess, ApiFailure, ProjectRecord, ResourceRecord, WikiContent, ProjectEvent } from "../domain"
import type { SharedWorkspace } from "./workspace"
import type { IngestionCheckpointV1, IngestionSummary } from "@/modules/ingestion/domain"
export interface ApiTransport {
  request(method: string, path: string, options: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal }): Promise<{ status: number; json(): Promise<unknown> }>
}
export class ApiClientError extends ServiceError {
  constructor(code: ServiceError["code"], message: string, public readonly status: number, public readonly requestId: string, details?: Record<string, unknown>) { super(code, message, details) }
}
export function createSharedClient(transport: ApiTransport) {
  const request = async <T>(method: string, path: string, body?: unknown, expected?: number | null, signal?: AbortSignal, extraHeaders?: Record<string, string>): Promise<ApiSuccess<T>> => {
    const headers: Record<string, string> = { ...(expected === undefined ? {} : expected === null ? { "If-None-Match": "*" } : { "If-Match": `"v${expected}"` }), ...extraHeaders }
    const response = await transport.request(method, `/api/v1${path}`, { body, headers, signal })
    const payload = await response.json() as ApiSuccess<T> & ApiFailure
    if (response.status < 200 || response.status >= 300) throw new ApiClientError(payload.error?.code ?? "internal", payload.error?.message ?? "Service request failed", response.status, payload.error?.requestId ?? "", payload.error?.details)
    if (!payload.meta || !("data" in payload)) throw new ApiClientError("internal", "Invalid service response", response.status, "")
    return payload
  }
  const root = (id: string) => `/projects/${encodeURIComponent(id)}`
  const page = (id: string, path: string) => `${root(id)}/wiki/page?path=${encodeURIComponent(path)}`
  return {
    request,
    projects: (query = "", signal?: AbortSignal) => request<ProjectRecord[]>("GET", `/projects${query}`, undefined, undefined, signal),
    createProject: (name: string) => request<ProjectRecord>("POST", "/projects", { name }),
    project: (id: string) => request<ProjectRecord>("GET", root(id)),
    wiki: (id: string, query = "") => request<ResourceRecord<WikiContent>[]>("GET", `${root(id)}/wiki${query}`),
    readWiki: (id: string, path: string) => request<ResourceRecord<WikiContent>>("GET", page(id, path)),
    saveWiki: (id: string, path: string, content: string, expected: number | null) => request<ResourceRecord<WikiContent>>("PUT", page(id, path), { content }, expected),
    removeWiki: (id: string, path: string, expected: number) => request<null>("DELETE", page(id, path), undefined, expected),
    workspace: (id: string) => request<ResourceRecord<SharedWorkspace>>("GET", `${root(id)}/workspace`),
    saveWorkspace: (id: string, workspace: SharedWorkspace, expected: number) => request<ResourceRecord<SharedWorkspace>>("PUT", `${root(id)}/workspace`, workspace, expected),
    documents: (id: string, query = "") => request<ResourceRecord[]>("GET", `${root(id)}/documents${query}`),
    documentIngestion: (projectId: string, documentId: string) => request<{ revision: number; checkpoint: IngestionCheckpointV1; summary: IngestionSummary }>("GET", `${root(projectId)}/documents/${encodeURIComponent(documentId)}/ingestion`),
    events: (id: string, after = 0) => request<ProjectEvent[]>("GET", `${root(id)}/events?after=${after}`),
  }
}
