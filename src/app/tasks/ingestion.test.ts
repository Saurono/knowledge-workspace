import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
const compile = vi.hoisted(() => vi.fn())
vi.mock("@/lib/ingest", () => ({ autoIngest: compile }))
import { runQueuedIngest } from "./ingestion"

const input = {
  projectId: "project-id",
  projectPath: "/project",
  sourcePath: "/project/raw/a.md",
  model: {} as LlmConfig,
  folderContext: "folder",
}
beforeEach(() => vi.resetAllMocks())
describe("ingest runtime platform wiring", () => {
  it("passes the receipt identity and ordered commit callback to the existing compiler", async () => {
    const runCommit = async <T>(operation: () => Promise<T>) => operation()
    compile.mockResolvedValue(["wiki/a.md"])
    expect(
      await runQueuedIngest(
        { ...input, runCommit },
        { id: "logical-task", scopeId: "project-id", signal: new AbortController().signal },
      ),
    ).toEqual(["wiki/a.md"])
    expect(compile).toHaveBeenCalledWith(
      "/project",
      "/project/raw/a.md",
      input.model,
      expect.any(AbortSignal),
      "folder",
      expect.any(Function),
      { taskId: "logical-task", projectId: input.projectId, runCommit },
    )
  })

  it("isolates restored attempts with the same logical task ID", async () => {
    const oldOwner = new AbortController()
    const newOwner = new AbortController()
    let finishOld!: (value: string[]) => void
    compile.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          finishOld = resolve
        }),
    )
    compile.mockResolvedValueOnce(["wiki/new.md"])
    const oldRun = runQueuedIngest(input, {
      id: "restored",
      scopeId: "project",
      signal: oldOwner.signal,
    })
    oldOwner.abort()
    const newRun = runQueuedIngest(input, {
      id: "restored",
      scopeId: "project",
      signal: newOwner.signal,
    })
    await expect(newRun).resolves.toEqual(["wiki/new.md"])
    finishOld(["wiki/old.md"])
    await expect(oldRun).rejects.toMatchObject({ name: "TaskCancelledError" })
    expect(compile).toHaveBeenCalledTimes(2)
  })
})
