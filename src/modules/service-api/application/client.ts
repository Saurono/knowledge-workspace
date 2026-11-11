import { ServiceError } from "../domain"
import type { MemoryGraphNode } from "@/modules/service-api/domain"
import type { ApiSuccess, ApiFailure, ProjectRecord, ResourceRecord, WikiContent, ProjectEvent, MemorySummary } from "../domain"
import type { SharedWorkspace } from "./workspace"
import type { IngestionCheckpointV1, IngestionSummary } from "@/modules/ingestion/domain"
import type { PhaseReceiptV2 } from "@/modules/obsidian/domain"
import type { DomainFilter } from "@/modules/domains/domain"
import { appendDomainFilterQuery } from "./domain-query"
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
    exportProject: (id: string) => request<unknown>("GET", `${root(id)}/export`),
    importProject: (id: string, bundle: unknown, options?: { dryRun?: boolean }) =>
      request<unknown>("POST", `${root(id)}/import${options?.dryRun ? "?dryRun=1" : ""}`, bundle),
    memoryGraph: (id: string, options?: { limit?: number }) =>
      request<{ items: Array<Pick<MemoryGraphNode, "id" | "title" | "status" | "category" | "domainIds" | "relations" | "updatedAt" | "owner">> }>(
        "GET", `${root(id)}/memories/graph${options?.limit === undefined ? "" : `?limit=${options.limit}`}`),
    memory: (id: string, memoryId: string) =>
      request<{ memory: unknown; revision: number }>("GET", `${root(id)}/memories/${memoryId}`),
    memorySummaries: (id: string, options?: { limit?: number; cursor?: string | null }) =>
      request<{ items: Array<Pick<MemorySummary, "id" | "title" | "status" | "version" | "updatedAt" | "owner" | "category">>; nextCursor: string | null }>(
        "GET", `${root(id)}/memories/summaries?${new URLSearchParams({ ...(options?.limit === undefined ? {} : { limit: String(options.limit) }), ...(options?.cursor ? { cursor: options.cursor } : {}) })}`),
    writeMemory: (id: string, memoryId: string, body: { input?: unknown; expectedVersion: number | null; idempotencyKey?: string }) =>
      request<{ memory: unknown; revision: number; replayed: boolean }>("POST", `${root(id)}/memories`, { memoryId, ...body }),
    memoryAction: (id: string, memoryId: string, action: "promote" | "archive", body?: Record<string, unknown>) =>
      request<{ memory: unknown; revision: number }>("POST", `${root(id)}/memories/${memoryId}/${action}`, body ?? {}),
    expireMemories: (id: string) => request<{ expired: number; revision: number }>("POST", `${root(id)}/memories/expire`, {}),
    supersedeMemory: (id: string, memoryId: string, newId: string) =>
      request<{ memory: unknown; revision: number }>("POST", `${root(id)}/memories/${memoryId}/supersede`, { newId }),
    projects: (query = "", signal?: AbortSignal) => request<ProjectRecord[]>("GET", `/projects${query}`, undefined, undefined, signal),
    createProject: (name: string) => request<ProjectRecord>("POST", "/projects", { name }),
    project: (id: string) => request<ProjectRecord>("GET", root(id)),
    wiki: (id: string, query = "", domainFilter?: DomainFilter) => request<ResourceRecord<WikiContent>[]>("GET", `${root(id)}/wiki${appendDomainFilterQuery(query, domainFilter)}`),
    readWiki: (id: string, path: string) => request<ResourceRecord<WikiContent>>("GET", page(id, path)),
    saveWiki: (id: string, path: string, content: string, expected: number | null) => request<ResourceRecord<WikiContent>>("PUT", page(id, path), { content }, expected),
    removeWiki: (id: string, path: string, expected: number) => request<null>("DELETE", page(id, path), undefined, expected),
    workspace: (id: string, options?: { memories?: "none" }) => request<ResourceRecord<SharedWorkspace>>("GET", `${root(id)}/workspace${options?.memories === "none" ? "?memories=none" : ""}`),
    saveWorkspace: (id: string, workspace: SharedWorkspace, expected: number) => request<ResourceRecord<SharedWorkspace>>("PUT", `${root(id)}/workspace`, workspace, expected),
    documents: (id: string, query = "", domainFilter?: DomainFilter) => request<ResourceRecord[]>("GET", `${root(id)}/documents${appendDomainFilterQuery(query, domainFilter)}`),
    documentIngestion: (projectId: string, documentId: string) => request<{ revision: number; checkpoint: IngestionCheckpointV1; summary: IngestionSummary }>("GET", `${root(projectId)}/documents/${encodeURIComponent(documentId)}/ingestion`),
    documentReceipt: (projectId: string, documentId: string) => request<PhaseReceiptV2>("GET", `${root(projectId)}/documents/${encodeURIComponent(documentId)}/receipt`),
    events: (id: string, after = 0) => request<ProjectEvent[]>("GET", `${root(id)}/events?after=${after}`),
  }
}
