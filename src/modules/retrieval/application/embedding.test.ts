import { describe, expect, it, vi } from "vitest"
import { createEmbeddingService } from "./embedding"
import type { EmbeddingPorts } from "./ports"
const config = { enabled: true, endpoint: "model", apiKey: "", model: "embed" }
const ports = (): EmbeddingPorts => ({
  model: { embed: vi.fn(async () => [1, 0]), embedBatch: vi.fn(async texts => texts.map(() => [1, 0])) },
  index: { upsert: vi.fn(async () => {}), search: vi.fn(async () => []), deletePage: vi.fn(async () => {}), count: vi.fn(async () => 10), clear: vi.fn(async () => {}), optimize: vi.fn(async () => {}), legacyCount: vi.fn(async () => 0), dropLegacy: vi.fn(async () => {}) },
  pages: { read: vi.fn(async () => "# Title\n\nA page body"), list: vi.fn(async () => []) },
  extractTitle: (_content, fallback) => fallback,
  clampConcurrency: value => Math.max(1, Math.min(64, value)),
  now: () => 0, sleep: async () => {}, logger: { log: () => {}, warn: () => {} },
})
describe("independent embedding service", () => {
  it("does not share model errors or rebuild state between service instances", async () => {
    const firstPorts = ports(), secondPorts = ports()
    vi.mocked(firstPorts.model.embed).mockRejectedValue(new Error("provider unavailable"))
    const first = createEmbeddingService(firstPorts), second = createEmbeddingService(secondPorts)
    await first.fetchEmbedding("q", config)
    expect(first.getLastEmbeddingError()).toBe("provider unavailable")
    expect(second.getLastEmbeddingError()).toBeNull()
    await first.embedAllPages("/first", config)
    expect(first.getEmbeddingReindexState()).toMatchObject({ kind: "done", projectPath: "/first" })
    expect(second.getEmbeddingReindexState()).toEqual({ kind: "idle" })
  })
  it("preserves the existing index if a forced rebuild cannot list pages", async () => {
    const input = ports()
    vi.mocked(input.pages.list).mockRejectedValue(new Error("unreadable"))
    await expect(createEmbeddingService(input).embedAllPages("/p", config, undefined, { clearExisting: true })).rejects.toThrow("left unchanged")
    expect(input.index.clear).not.toHaveBeenCalled()
    expect(input.index.upsert).not.toHaveBeenCalled()
  })
  it("retains old vectors when every model request fails", async () => {
    const input = ports()
    vi.mocked(input.pages.list).mockResolvedValue([{ name: "a.md", path: "/p/wiki/concepts/a.md", is_dir: false }])
    vi.mocked(input.model.embed).mockRejectedValue(new Error("offline"))
    await expect(createEmbeddingService(input).embedAllPages("/p", config, undefined, { clearExisting: true })).rejects.toThrow("kept their previous vectors")
    expect(input.index.clear).not.toHaveBeenCalled()
    expect(input.index.deletePage).not.toHaveBeenCalled()
  })
})
