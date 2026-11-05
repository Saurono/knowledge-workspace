import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createDeferred } from "@/test-helpers/deferred"
const deps = vi.hoisted(() => ({
  search: vi.fn(),
  stream: vi.fn(),
  write: vi.fn(),
  exists: vi.fn(),
  read: vi.fn(),
}))
vi.mock("@/lib/web-search", () => ({
  webSearch: deps.search,
  resolveSearchConfig: (v: unknown) => v,
  hasConfiguredSearchProvider: () => true,
}))
vi.mock("@/lib/anytxt-search", () => ({
  anyTxtSearchSmart: vi.fn(),
  hasConfiguredAnyTxt: () => false,
}))
vi.mock("@/lib/llm-client", () => ({ streamChat: deps.stream }))
vi.mock("@/commands/fs", () => ({
  createDirectory: async () => {},
  writeFileAtomic: async () => {},
  fileExists: deps.exists,
  writeFile: deps.write,
  readFile: deps.read,
}))
vi.mock("@/lib/ingest", () => ({ currentWikiDate: () => "2026-10-31" }))
vi.mock("@/lib/project-file-tree-refresh", () => ({ refreshProjectFileTree: vi.fn() }))
import { queueResearch } from "./service"
import { useResearchStore } from "@/stores/research-store"
import { useWikiStore } from "@/stores/wiki-store"
const model = useWikiStore.getState().llmConfig
const config = { provider: "none" as const, apiKey: "" }
beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  useResearchStore.setState({ tasks: [], maxConcurrent: 1 })
  useWikiStore.setState({
    project: { id: "p", name: "P", path: "/p" },
    embeddingConfig: { ...useWikiStore.getState().embeddingConfig, enabled: false },
  })
  deps.exists.mockResolvedValue(false)
  deps.read.mockResolvedValue("")
  deps.write.mockResolvedValue(undefined)
  deps.search.mockResolvedValue([
    { title: "A", url: "https://example.com", source: "site", snippet: "Evidence" },
  ])
  deps.stream.mockImplementation(async (_model, messages, callbacks) => {
    if (messages[0].content.includes("evidence-quality gate")) {
      callbacks.onToken('{"keep":[1]}')
      return
    }
    callbacks.onToken(
      "Evidence and mechanisms are compared with their limitations and implications for this topic. ".repeat(
        3,
      ) + "[1]",
    )
  })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})
describe("research application wiring", () => {
  it("runs a real queued task through validation and writes a query page", async () => {
    const id = queueResearch("/p", "Topic", model, config)
    await vi.advanceTimersByTimeAsync(51)
    expect(useResearchStore.getState().tasks.find((t) => t.id === id)).toMatchObject({
      status: "done",
      projectPath: "/p",
      savedPath: expect.stringContaining("wiki/queries/"),
    })
    expect(deps.write).toHaveBeenCalledTimes(1)
  })
  it("aborts an old scope even if the user switches away and back before search returns", async () => {
    const found = createDeferred<unknown[]>()
    deps.search.mockReturnValue(found.promise)
    const id = queueResearch("/p", "Topic", model, config)
    await vi.advanceTimersByTimeAsync(51)
    useWikiStore.setState({ project: { id: "other", name: "Other", path: "/other" } })
    useWikiStore.setState({ project: { id: "p", name: "P", path: "/p" } })
    found.resolve([{ title: "A", url: "https://example.com", source: "site", snippet: "Evidence" }])
    await vi.advanceTimersByTimeAsync(1)
    expect(deps.write).not.toHaveBeenCalled()
    expect(useResearchStore.getState().tasks.find((t) => t.id === id)?.status).toBe("error")
  })
  it("does not start a delayed queued task under another project", async () => {
    const id = queueResearch("/p", "Topic", model, config)
    useWikiStore.setState({ project: { id: "other", name: "Other", path: "/other" } })
    await vi.advanceTimersByTimeAsync(51)
    expect(deps.search).not.toHaveBeenCalled()
    expect(useResearchStore.getState().tasks.find((t) => t.id === id)?.status).toBe("queued")
  })
})
