import { describe, expect, it, vi } from "vitest"
import { createTaskRuntime } from "@/modules/tasks"
import {
  createIngestExecutor,
  INGEST_EXECUTOR,
  type IngestCompiler,
  type IngestExecutionInput,
} from "./execute-ingest"

const input: IngestExecutionInput<string> = {
  projectId: "project-id",
  projectPath: "/project",
  sourcePath: "/project/raw/source.md",
  model: "configured-model",
  folderContext: "notes",
}
function setup(compiler: IngestCompiler<string>) {
  const runtime = createTaskRuntime()
  runtime.register(INGEST_EXECUTOR, createIngestExecutor(compiler))
  return runtime
}

describe("queued ingest executor", () => {
  it("preserves task identity, commit runner and completed write notifications", async () => {
    const written = vi.fn()
    const runCommit = vi.fn(async <T>(operation: () => Promise<T>) => operation())
    const runtime = setup({
      compile: async (request, context) => {
        expect(context.taskId).toBe("task-1")
        expect(context.signal).toBeInstanceOf(AbortSignal)
        expect(request.sourcePath).toBe(input.sourcePath)
        expect(request.model).toBe(input.model)
        await request.runCommit!(async () => {
          context.onFileWritten("wiki/a.md")
        })
        return ["wiki/a.md"]
      },
    })
    expect(
      await runtime.execute(
        INGEST_EXECUTOR,
        { ...input, runCommit, onFileWritten: written },
        { id: "task-1", scopeId: "project-id" },
      ),
    ).toEqual({ status: "succeeded", value: ["wiki/a.md"] })
    expect(runCommit).toHaveBeenCalledOnce()
    expect(written).toHaveBeenCalledWith("wiki/a.md")
    expect(runtime.get("task-1")?.detail).toBe("wiki/a.md")
  })

  it("rejects an empty compiler result instead of reporting success", async () => {
    const runtime = setup({ compile: async () => [] })
    await expect(
      runtime.execute(INGEST_EXECUTOR, input, { id: "a", scopeId: "p" }),
    ).rejects.toThrow("Ingest produced no output files")
    expect(runtime.get("a")?.status).toBe("failed")
  })

  it("keeps the original failure object for the queue retry policy", async () => {
    const failure = Object.assign(new Error("unsafe source"), { nonRetryable: true })
    const runtime = setup({
      compile: async () => {
        throw failure
      },
    })
    await expect(runtime.execute(INGEST_EXECUTOR, input, { id: "a", scopeId: "p" })).rejects.toBe(
      failure,
    )
  })

  it("accounts for an atomic write finishing after cancellation and discards its success result", async () => {
    const owner = new AbortController()
    const written = vi.fn()
    const runtime = setup({
      compile: async (_request, context) => {
        owner.abort()
        context.onFileWritten("wiki/existing-page.md")
        return ["wiki/existing-page.md"]
      },
    })
    const result = await runtime.execute(
      INGEST_EXECUTOR,
      { ...input, onFileWritten: written },
      { id: "a", scopeId: "p", signal: owner.signal },
    )
    expect(result).toEqual({ status: "cancelled" })
    expect(written).toHaveBeenCalledWith("wiki/existing-page.md")
    expect(runtime.get("a")?.status).toBe("cancelled")
  })

  it("does not invoke the compiler if the queue already cancelled the run", async () => {
    const owner = new AbortController()
    owner.abort()
    const compile = vi.fn(async () => ["wiki/a.md"])
    const runtime = setup({ compile })
    expect(
      await runtime.execute(INGEST_EXECUTOR, input, {
        id: "a",
        scopeId: "p",
        signal: owner.signal,
      }),
    ).toEqual({ status: "cancelled" })
    expect(compile).not.toHaveBeenCalled()
  })
})
