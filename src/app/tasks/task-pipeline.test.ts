import { beforeEach, expect, it, vi } from "vitest"
import { createTaskPipeline, type TaskPipelineOptions } from "./task-pipeline"

const files = vi.hoisted(() => new Map<string, string>())
vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}), fileExists: vi.fn(async () => true),
  writeFileAtomic: vi.fn(async (path: string, text: string) => { files.set(path, text) }),
  readFile: async (path: string) => files.get(path),
  listDirectory: async () => [...files.keys()].map(path => ({ name: path.split("/").pop(), path })),
}))
beforeEach(() => { files.clear(); vi.clearAllMocks() })
const root = "C:/project"
const at = "2026-11-11T00:00:00.000Z"
const result = { report: { ref: "report.md", completedAt: at }, ingest: { completedAt: at, accepted: 2, rejected: 1 } }
const input = { kind: "research" as const, scopeId: "scope", executorId: "fake" }
function pipeline(execute: TaskPipelineOptions["execute"]) {
  let tick = 0
  return createTaskPipeline({ root, execute, now: () => `2026-11-11T00:00:00.${String(tick++).padStart(3, "0")}Z` })
}
const path = (id: string) => `${root}/.llm-wiki/tasks/${id}.json`
async function done(p: ReturnType<typeof pipeline>, id: string, stage = "done") {
  await vi.waitFor(async () => expect((await p.queue.get(id))?.stage).toBe(stage))
  await vi.waitFor(() => expect(p.scheduler.running()).toEqual([]))
}

it("runs through queue, scheduler and journal with the injected result", async () => {
  const payload = { sourcePath: "a.md" }
  const execute = vi.fn<TaskPipelineOptions["execute"]>(async () => result)
  const p = pipeline(execute)
  const task = await p.enqueue({ ...input, payload })
  expect(task.stage).toBe("queued")
  expect(execute).not.toHaveBeenCalled()
  await p.start()
  await done(p, task.id)
  expect(execute.mock.calls[0][0].payload).toEqual(payload)
  expect((await p.queue.get(task.id))?.result).toEqual(result)
  expect(JSON.parse(files.get(path(task.id))!)).toMatchObject({ id: task.id, stage: "done", result })
  p.dispose()
})

it("starts three tasks in the same scope serially in enqueue order", async () => {
  const starts: string[] = []
  let active = 0
  let peak = 0
  const p = pipeline(async task => {
    starts.push(task.id)
    peak = Math.max(peak, ++active)
    await Promise.resolve()
    active--
    return result
  })
  const tasks = [await p.enqueue(input), await p.enqueue(input), await p.enqueue(input)]
  await p.start()
  await done(p, tasks[2].id)
  expect(starts).toEqual(tasks.map(task => task.id))
  expect(peak).toBe(1)
  expect((await p.queue.list()).every(task => task.stage === "done")).toBe(true)
  p.dispose()
})

it("retries a failed task as a successful child without changing the original", async () => {
  let attempts = 0
  const p = pipeline(async () => {
    if (++attempts === 1) throw new Error("first attempt")
    return result
  })
  const original = await p.enqueue(input)
  await p.start()
  await done(p, original.id, "failed")
  expect((await p.queue.get(original.id))?.error).toMatchObject({ retriable: true })
  const child = await p.scheduler.retry(original.id)
  await done(p, child.id)
  expect(child.id).not.toBe(original.id)
  expect(child.parentId).toBe(original.id)
  expect((await p.queue.get(original.id))?.stage).toBe("failed")
  p.dispose()
})

it("recovers a persisted running task on restart and completes both queued tasks", async () => {
  const execute = vi.fn(async () => result)
  const first = pipeline(execute)
  const interrupted = await first.enqueue(input)
  const queued = await first.enqueue(input)
  expect(execute).not.toHaveBeenCalled()
  const record = JSON.parse(files.get(path(interrupted.id))!)
  files.set(path(interrupted.id), JSON.stringify({ ...record, stage: "running", startedAt: at }))
  first.dispose()
  const restarted = pipeline(execute)
  const stages: string[] = []
  restarted.queue.subscribe(task => { if (task.id === interrupted.id) stages.push(task.stage) })
  const recovery = await restarted.start()
  expect(recovery.recovered).toBeGreaterThanOrEqual(1)
  await done(restarted, queued.id)
  expect(stages[0]).toBe("queued")
  expect(stages).toContain("running")
  expect(stages[stages.length - 1]).toBe("done")
  for (const task of [interrupted, queued]) {
    expect(JSON.parse(files.get(path(task.id))!).stage).toBe("done")
  }
  expect((await restarted.queue.get(interrupted.id))?.log).toContainEqual({
    at: "2026-11-11T00:00:00.000Z", level: "warn", message: "Interrupted by restart; returned to queue",
  })
  expect(execute).toHaveBeenCalledTimes(2)
  expect(await restarted.recover()).toEqual({ recovered: 0, interrupted: 0 })
  restarted.dispose()
})

it("cancels a running task and aborts the signal delivered to execute", async () => {
  let signal: AbortSignal | undefined
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const p = pipeline(async (_task, received) => {
    signal = received
    await pending
    return result
  })
  const task = await p.enqueue(input)
  await p.start()
  await vi.waitFor(() => expect(signal).toBeDefined())
  const cancellation = p.scheduler.cancel(task.id)
  expect(signal?.aborted).toBe(true)
  release()
  await cancellation
  await done(p, task.id, "cancelled")
  expect(JSON.parse(files.get(path(task.id))!).stage).toBe("cancelled")
  p.dispose()
})
