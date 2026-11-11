import { describe, expect, it, vi } from "vitest"
import { createRetrievalService } from "./search"
import type { BackendSearchResponse, SearchResult } from "../domain"
const page = (path: string, body = "body"): SearchResult => ({ path, title: path, snippet: "snippet", content: body, images: [], score: 1, titleMatch: true })
const response = (results: SearchResult[]): BackendSearchResponse => ({ mode: "hybrid", tokenHits: 1, vectorHits: 2, graphHits: 1, results })
describe("retrieval service contracts", () => {
  it("never supplies model credentials for local-only search and preserves backend signals", async () => {
    const search = vi.fn().mockResolvedValue(response([page("wiki/a.md")]))
    const result = await createRetrievalService({ search }).search("C:\\project", "topic", { localOnly: true, embeddingConfig: { enabled: true, endpoint: "remote", apiKey: "secret", model: "model" } })
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ projectPath: "C:/project", embeddingConfig: null, includeContent: false }))
    expect(result).toMatchObject({ mode: "hybrid", graphHits: 1, results: [{ path: "C:/project/wiki/a.md" }] })
  })
  it("skips blank queries and refuses work cancelled before dispatch", async () => {
    const search = vi.fn(), service = createRetrievalService({ search })
    expect((await service.search("/p", "  ")).results).toEqual([])
    const owner = new AbortController(); owner.abort()
    await expect(service.search("/p", "q", { signal: owner.signal })).rejects.toMatchObject({ name: "AbortError" })
    expect(search).not.toHaveBeenCalled()
  })
  it("discards a late native result after cancellation", async () => {
    let release!: (value: BackendSearchResponse) => void
    const pending = new Promise<BackendSearchResponse>(resolve => { release = resolve })
    const owner = new AbortController()
    const work = createRetrievalService({ search: () => pending }).search("/p", "q", { signal: owner.signal })
    owner.abort(); release(response([page("wiki/a.md")]))
    await expect(work).rejects.toMatchObject({ name: "AbortError" })
  })
  it("budgets evidence, skips empty hits and assigns contiguous citation numbers", async () => {
    const search = vi.fn().mockResolvedValue(response([page("wiki/empty.md", ""), page("wiki/a.md", "abcdef"), page("wiki/b.md", "uvwxyz")]))
    // The first hit also has no snippet and must not consume a citation.
    search.mockResolvedValue(response([{ ...page("wiki/empty.md", ""), snippet: "" }, page("wiki/a.md", "abcdef"), page("wiki/b.md", "uvwxyz")]))
    const result = await createRetrievalService({ search }).evidence("/p", "q", { maxChars: 7, perPageChars: 4 })
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ includeContent: true, topK: 5 }))
    expect(result.evidence.map(hit => [hit.citation, hit.text, hit.content])).toEqual([[1, "abcd", undefined], [2, "uvw", undefined]])
  })
  it("uses the snippet when the backend cannot provide a full body", async () => {
    const result = await createRetrievalService({ search: async () => response([{ ...page("wiki/a.md"), content: undefined }]) }).evidence("/p", "q")
    expect(result.evidence[0].text).toBe("snippet")
  })
  it.each(["../outside.md", "wiki/../a.md", "C:/other/a.md", "wiki/a\0.md"])("rejects invalid backend result paths: %s", async path => {
    await expect(createRetrievalService({ search: async () => response([page(path)]) }).search("/p", "q")).rejects.toThrow("project-relative")
  })
})

it("enforces scope and forwards filters while preserving unscoped results", async () => {
 const search = vi.fn().mockResolvedValue(response([{ ...page("a.md"), projectId: "a" }, { ...page("b.md"), projectId: "b" }]))
 const service = createRetrievalService({ search })
 const scoped = await service.search("/p", "q", { accessScope: { allowedProjectIds: ["a"] }, domainFilter: ["engineering"] })
 expect(scoped.results.map(r => r.projectId)).toEqual(["a"])
 expect(scoped.deniedCount).toBe(1)
 expect(search).toHaveBeenCalledWith(expect.objectContaining({ accessScope: { allowedProjectIds: ["a"] }, domainFilter: ["engineering"] }))
 const all = await service.search("/p", "q")
 expect(all.results).toHaveLength(2)
 expect(all.deniedCount ?? 0).toBe(0)
})
