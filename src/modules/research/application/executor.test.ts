import { describe, expect, it, vi } from "vitest"
import { createTaskRuntime } from "@/modules/tasks"
import { createDeferred } from "@/test-helpers/deferred"
import { createResearchExecutor, RESEARCH_EXECUTOR, type ResearchPorts } from "./executor"
const source = {
  title: "Evidence",
  url: "https://example.com/a",
  source: "site",
  snippet: "Evidence content",
}
const prose =
  "A substantive analysis compares mechanisms and documents the evidence, its limitations, and implications across multiple contexts. ".repeat(
    3,
  ) + "[1]"
const input = { projectPath: "/p", topic: "Topic", model: true, search: true, queries: ["Topic"] }
function fixture() {
  const ports: ResearchPorts<boolean, boolean> = {
    collect: vi.fn(async () => ({
      results: [source, { ...source, title: "Unused", url: "https://example.com/b" }],
      errors: [],
      candidateCount: 2,
      rejectedCount: 0,
    })),
    readWikiIndex: vi.fn(async () => "[[existing]]"),
    languageDirective: () => "Use the topic language.",
    synthesize: vi.fn(async (_model, _messages, onToken) => {
      onToken(`<think>private</think>${prose}`)
    }),
    save: vi.fn(async () => "wiki/queries/result.md"),
    update: vi.fn(),
  }
  const runtime = createTaskRuntime()
  runtime.register(RESEARCH_EXECUTOR, createResearchExecutor(ports))
  return {
    ports,
    runtime,
    run: (signal?: AbortSignal) =>
      runtime.execute(RESEARCH_EXECUTOR, input, { id: "research-1", scopeId: "p", signal }),
  }
}
describe("research executor contract", () => {
  it("validates prose, strips private reasoning, and saves only cited references", async () => {
    const { ports, run } = fixture()
    expect((await run()).status).toBe("succeeded")
    expect(ports.save).toHaveBeenCalledWith(
      input,
      prose,
      "1. [Evidence](https://example.com/a) — site",
      expect.objectContaining({ taskId: "research-1" }),
    )
    expect(ports.update).toHaveBeenLastCalledWith("research-1", {
      status: "done",
      savedPath: "wiki/queries/result.md",
    })
  })
  it("does not write empty or uncited synthesis", async () => {
    const { ports, run } = fixture()
    vi.mocked(ports.synthesize).mockImplementation(async (_m, _p, emit) => {
      emit("<think>only private</think>")
    })
    await expect(run()).rejects.toThrow("empty or incomplete")
    expect(ports.save).not.toHaveBeenCalled()
  })
  it("reports source search failures rather than falsely completing", async () => {
    const { ports, run } = fixture()
    vi.mocked(ports.collect).mockResolvedValue({
      results: [],
      errors: ["search offline"],
      candidateCount: 0,
      rejectedCount: 0,
    })
    await expect(run()).rejects.toThrow("search offline")
    expect(ports.synthesize).not.toHaveBeenCalled()
  })
  it("keeps a legitimate empty result distinct from a failed search", async () => {
    const { ports, run } = fixture()
    vi.mocked(ports.collect).mockResolvedValue({
      results: [],
      errors: [],
      candidateCount: 0,
      rejectedCount: 0,
    })
    expect(await run()).toMatchObject({ status: "succeeded", value: { savedPath: null } })
    expect(ports.save).not.toHaveBeenCalled()
  })
  it("discards evidence returned after owner cancellation", async () => {
    const { ports, run } = fixture()
    const owner = new AbortController()
    const found = createDeferred<Awaited<ReturnType<typeof ports.collect>>>()
    vi.mocked(ports.collect).mockReturnValue(found.promise)
    const pending = run(owner.signal)
    owner.abort()
    found.resolve({ results: [source], errors: [], candidateCount: 1, rejectedCount: 0 })
    expect(await pending).toEqual({ status: "cancelled" })
    expect(ports.synthesize).not.toHaveBeenCalled()
    expect(ports.save).not.toHaveBeenCalled()
  })
  it("does not report success when cancellation arrives during a noninterruptible save", async () => {
    const { ports, run } = fixture()
    const owner = new AbortController()
    vi.mocked(ports.save).mockImplementation(async () => {
      owner.abort()
      return "wiki/result.md"
    })
    expect(await run(owner.signal)).toEqual({ status: "cancelled" })
    expect(ports.update).not.toHaveBeenCalledWith(
      "research-1",
      expect.objectContaining({ status: "done" }),
    )
  })
})
