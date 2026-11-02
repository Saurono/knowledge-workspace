import { afterEach, describe, expect, it, vi } from "vitest"
import { createDeferred, waitFor } from "@/test-helpers/deferred"
import { createIngestQueue, type IngestQueue } from "./queue"
import type { IngestQueuePorts } from "./queue-ports"
import type { IngestTask } from "../domain/queue-task"

const instances: IngestQueue[] = []
afterEach(() => {
  for (const queue of instances.splice(0)) queue.clearQueueState()
})
function task(projectId: string, sourcePath = "source.md"): IngestTask {
  return {
    id: `${projectId}-${sourcePath}`,
    projectId,
    sourcePath,
    folderContext: "",
    status: "pending",
    addedAt: 1,
    error: null,
    retryCount: 0,
  }
}
function fixture() {
  const files = new Map<string, string>()
  const timers = new Map<unknown, () => void>()
  let nextId = 0
  let nextTimer = 0
  const ports: IngestQueuePorts<boolean> = {
    snapshots: {
      read: vi.fn(async (path) => files.get(path) ?? "[]"),
      write: vi.fn(async (path, snapshot) => {
        files.set(path, snapshot)
      }),
    },
    paths: { normalize: (path) => path, isAbsolute: (path) => path.startsWith("/") },
    projects: { getPath: vi.fn(async (id) => `/${id}`) },
    models: { read: vi.fn(() => false), isUsable: (model) => model },
    execute: vi.fn(async () => ["wiki/result.md"]),
    loadReviewSweep: vi.fn(async () => vi.fn(async () => 0)),
    loadWikiCleanup: vi.fn(async () => vi.fn(async () => {})),
    clampConcurrency: (value) => Math.max(1, Math.min(64, Math.floor(value))),
    clock: {
      now: () => 1234,
      createId: () => `generated-${++nextId}`,
      setTimer: (callback) => {
        const id = nextTimer++
        timers.set(id, callback)
        return id
      },
      clearTimer: vi.fn((handle) => {
        timers.delete(handle)
      }),
      defer: (callback) => queueMicrotask(callback),
    },
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
  const queue = createIngestQueue(ports)
  instances.push(queue)
  return { queue, ports, files, timers }
}

describe("injected ingest queue service", () => {
  it("isolates queue state, limits, listeners and task identities between instances", async () => {
    const a = fixture()
    const b = fixture()
    await a.queue.restoreQueue("a", "/a")
    await b.queue.restoreQueue("b", "/b")
    a.queue.setIngestWorkerLimit(4)
    const listener = vi.fn()
    a.queue.subscribeIngestQueue(listener)
    await a.queue.enqueueIngest("a", "first.md")
    await waitFor(() => a.queue.getQueueSummary().blockedOnLlmConfig)
    const calls = listener.mock.calls.length
    await b.queue.enqueueIngest("b", "second.md")
    await waitFor(() => b.queue.getQueueSummary().blockedOnLlmConfig)
    expect(listener).toHaveBeenCalledTimes(calls)
    expect(a.queue.getQueue()[0]).toMatchObject({
      id: "generated-1",
      addedAt: 1234,
      sourcePath: "first.md",
    })
    expect(b.queue.getQueue()[0]).toMatchObject({ id: "generated-1", sourcePath: "second.md" })
    expect(a.queue.getIngestWorkerLimit()).toBe(4)
    expect(b.queue.getIngestWorkerLimit()).toBe(1)
  })

  it("captures immutable snapshots and serializes active writes before newer changes", async () => {
    const { queue, ports } = fixture()
    await queue.restoreQueue("p", "/p")
    queue.pauseProcessing()
    const firstWrite = createDeferred<void>()
    const writes: string[] = []
    vi.mocked(ports.snapshots.write).mockImplementation(async (_path, snapshot) => {
      writes.push(snapshot)
      if (writes.length === 1) await firstWrite.promise
    })
    const first = queue.enqueueIngest("p", "first.md")
    const second = queue.enqueueIngest("p", "second.md")
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0])).toHaveLength(1)
    firstWrite.resolve()
    await Promise.all([first, second])
    expect(writes).toHaveLength(2)
    expect(JSON.parse(writes[1]).map((item: IngestTask) => item.sourcePath)).toEqual([
      "first.md",
      "second.md",
    ])
  })

  it("reports inactive write failure without poisoning later persistence", async () => {
    const { queue, ports, files } = fixture()
    vi.mocked(ports.snapshots.write).mockRejectedValueOnce(new Error("offline"))
    await expect(
      queue.enqueueInactiveProjectBatch("p", "/p", [{ sourcePath: "first.md", folderContext: "" }]),
    ).rejects.toThrow("offline")
    await queue.enqueueInactiveProjectBatch("p", "/p", [
      { sourcePath: "second.md", folderContext: "" },
    ])
    expect(JSON.parse(files.get("/p")!)).toEqual([
      expect.objectContaining({ sourcePath: "second.md" }),
    ])
    expect(ports.execute).not.toHaveBeenCalled()
  })

  it("keeps a queue with an invalid restored snapshot empty and never executes after enqueue or resume", async () => {
    const { queue, ports, files } = fixture()
    vi.mocked(ports.models.read).mockReturnValue(true)
    const corrupt = JSON.stringify([{
      ...task("p"), sourceId: "source_12345678", sourceRevision: "not-a-sha", idempotencyKey: "forged",
    }])
    files.set("/p", corrupt)
    await expect(queue.restoreQueue("p", "/p")).rejects.toThrow("Invalid ingestion idempotency identity")
    expect(queue.getQueue()).toEqual([])

    await expect(queue.enqueueIngest("p", "new.md")).rejects.toThrow("snapshot is invalid")
    expect(queue.getQueue()).toEqual([])
    queue.resumeProcessing()
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(queue.getQueue()).toEqual([])
    expect(ports.execute).not.toHaveBeenCalled()
  })

  it("does not begin compilation when persisting the prepared idempotency binding fails", async () => {
    const { queue, ports } = fixture()
    vi.mocked(ports.models.read).mockReturnValue(true)
    const compile = vi.fn(async () => ["wiki/result.md"])
    vi.mocked(ports.execute).mockImplementation(async input => {
      await input.bindIdempotency?.({
        sourceId: "source_12345678",
        sourceRevision: "a".repeat(64),
        idempotencyKey: `ingest-v1:p:source_12345678:${"a".repeat(64)}:compile`,
      })
      return compile()
    })
    await queue.restoreQueue("p", "/p")
    let writes = 0
    vi.mocked(ports.snapshots.write).mockImplementation(async (_path, _snapshot) => {
      writes++
      if (writes >= 3) throw new Error("disk full")
      // Keep enqueue durable; only the prepared idempotency binding fails.
      if (writes !== 1) return
      await Promise.resolve()
    })
    await queue.enqueueIngest("p", "source.md")
    await waitFor(() => queue.getQueue()[0]?.status === "failed")
    expect(compile).not.toHaveBeenCalled()
  })

  it.each(["project switch", "same-project ABA restore"] as const)("rejects a deferred prepared identity after %s without rebinding the replacement task", async mode => {
    const { queue, ports } = fixture()
    vi.mocked(ports.models.read).mockReturnValue(true)
    const started = createDeferred<Parameters<IngestQueuePorts<boolean>["execute"]>[0]>()
    const finish = createDeferred<string[]>()
    vi.mocked(ports.execute).mockImplementation(async input => {
      started.resolve(input)
      return finish.promise
    })
    await queue.restoreQueue("p", "/p")
    await queue.enqueueIngest("p", "source.md")
    const oldInput = await started.promise

    vi.mocked(ports.models.read).mockReturnValue(false)
    const target = mode === "project switch" ? ["other", "/other"] as const : ["p", "/p"] as const
    await queue.restoreQueue(target[0], target[1])
    const writesBeforeLateBind = vi.mocked(ports.snapshots.write).mock.calls.length
    await expect(oldInput.bindIdempotency?.({
      sourceId: "source_12345678",
      sourceRevision: "b".repeat(64),
      idempotencyKey: `ingest-v1:p:source_12345678:${"b".repeat(64)}:compile`,
    })).rejects.toMatchObject({ name: "TaskCancelledError" })
    expect(vi.mocked(ports.snapshots.write).mock.calls).toHaveLength(writesBeforeLateBind)
    expect(vi.mocked(ports.snapshots.write).mock.calls.slice(0, writesBeforeLateBind).every(([path]) => path === "/p")).toBe(true)
    finish.resolve(["wiki/result.md"])
  })

  it("recovers interrupted work, backfills legacy project IDs and drops foreign tasks", async () => {
    const { queue, files, ports } = fixture()
    const legacy: Partial<IngestTask> = { ...task("p"), status: "processing" }
    delete legacy.projectId
    files.set("/p", JSON.stringify([legacy, task("foreign")]))
    await queue.restoreQueue("p", "/p")
    expect(queue.getQueue()).toEqual([
      expect.objectContaining({ projectId: "p", status: "pending" }),
    ])
    expect(ports.execute).not.toHaveBeenCalled()
    expect(JSON.parse(files.get("/p")!)[0].status).toBe("pending")
  })

  it.each(["different-project", "same-project"])(
    "discards an old restored snapshot after a %s scope replacement",
    async (mode) => {
      const { queue, ports, files } = fixture()
      const oldRead = createDeferred<string>()
      vi.mocked(ports.snapshots.read).mockImplementationOnce(() => oldRead.promise)
      const first = queue.restoreQueue("old", "/old")
      await waitFor(() => vi.mocked(ports.snapshots.read).mock.calls.length === 1)
      const current = mode === "same-project" ? "old" : "current"
      files.set(`/${current}`, JSON.stringify([task(current, "current.md")]))
      await queue.restoreQueue(current, `/${current}`)
      oldRead.resolve(JSON.stringify([task("old", "outdated.md")]))
      await first
      expect(queue.getQueue()).toEqual([
        expect.objectContaining({ projectId: current, sourcePath: "current.md" }),
      ])
      expect(JSON.parse(files.get(`/${current}`)!)[0].sourcePath).toBe("current.md")
    },
  )

  it("uses and clears an injected zero-valued quota-resume timer", async () => {
    const { queue, ports, timers } = fixture()
    vi.mocked(ports.models.read).mockReturnValue(true)
    vi.mocked(ports.execute).mockRejectedValue(new Error("quota exceeded"))
    await queue.restoreQueue("p", "/p")
    await queue.enqueueIngest("p", "source.md")
    await waitFor(() => queue.isQueuePaused())
    expect(timers.has(0)).toBe(true)
    queue.pauseProcessing()
    expect(ports.clock!.clearTimer).toHaveBeenCalledWith(0)
    expect(timers.size).toBe(0)
  })

  it("does not run a lazily resolved review sweep in a replaced project", async () => {
    const { queue, ports } = fixture()
    const loadSweep =
      createDeferred<(projectPath: string, signal: AbortSignal) => Promise<unknown>>()
    const sweep = vi.fn(async () => 0)
    vi.mocked(ports.models.read).mockReturnValue(true)
    vi.mocked(ports.loadReviewSweep).mockReturnValueOnce(loadSweep.promise)
    await queue.restoreQueue("old", "/old")
    await queue.enqueueIngest("old", "source.md")
    await waitFor(() => vi.mocked(ports.loadReviewSweep).mock.calls.length === 1)
    await queue.restoreQueue("current", "/current")
    loadSweep.resolve(sweep)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(sweep).not.toHaveBeenCalled()
  })
})
