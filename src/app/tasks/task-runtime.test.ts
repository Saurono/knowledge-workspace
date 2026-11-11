import { beforeEach, expect, it, vi } from "vitest"
import { createTaskRuntimeHandle } from "./task-runtime"
import { createTaskProtocol } from "@/modules/tasks/domain/protocol"

const files = vi.hoisted(() => new Map<string, string>())
vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}), fileExists: vi.fn(async () => true),
  writeFileAtomic: vi.fn(async (path: string, text: string) => { files.set(path, text) }),
  readFile: async (path: string) => files.get(path),
  listDirectory: async () => [...files.keys()].map(path => ({ name: path.split("/").pop(), path })),
}))
beforeEach(() => { files.clear(); vi.clearAllMocks() })
const now = () => "2026-11-11T00:00:00.000Z"
it("keeps adopted queued records unexecuted and readable after disposal", async () => {
  const execute = vi.fn(async () => result)
  const handle = make(execute)
  const task = await handle.adopt(createTaskProtocol({ ...input, id: "external", now: now() }))
  await handle.start()
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  expect(await handle.list()).toEqual([task])
  expect(execute).not.toHaveBeenCalled()
  await handle.dispose()
  expect(await handle.list()).toEqual([task])
})
const input = { kind: "ingest" as const, scopeId: "scope", executorId: "fake", payload: { sourcePath: "a.md" } }
const result = { ingest: { completedAt: now(), accepted: 1, rejected: 0 } }
const make = (execute = async () => result) => createTaskRuntimeHandle({ root: "C:/project", now, execute })
async function stage(handle: ReturnType<typeof make>, id: string, expected = "done") {
  await vi.waitFor(async () => expect((await handle.list()).find(task => task.id === id)?.stage).toBe(expected))
}

it("enqueues and publishes running and done", async () => {
  const h = make()
  const seen: string[] = []
  h.subscribe(task => seen.push(task.stage))
  const task = await h.enqueue(input)
  expect(task.payload).toEqual(input.payload)
  await h.start()
  await stage(h, task.id)
  expect(seen).toEqual(expect.arrayContaining(["running", "done"]))
  await h.dispose()
})
it("returns the initial recovery counters", async () => {
  const h = make()
  expect(await h.start()).toEqual({ recovered: 0, interrupted: 0 })
  await h.dispose()
})
it("recovers a running disk record on restart", async () => {
  const a = make()
  const task = await a.enqueue(input)
  const path = `C:/project/.llm-wiki/tasks/${task.id}.json`
  files.set(path, JSON.stringify({ ...JSON.parse(files.get(path)!), stage: "running", startedAt: now() }))
  const b = make()
  expect((await b.start()).recovered).toBeGreaterThanOrEqual(1)
  await stage(b, task.id)
  await a.dispose()
  await b.dispose()
})
it("cancels running execution", async () => {
  let signal: AbortSignal | undefined
  const h = createTaskRuntimeHandle({ root: "C:/project", now, execute: async (_task, received) => {
    signal = received
    await new Promise<void>(resolve => received!.addEventListener("abort", () => resolve(), { once: true }))
    return {}
  } })
  const task = await h.enqueue(input)
  await h.start()
  await vi.waitFor(() => expect(signal).toBeDefined())
  await h.cancel(task.id)
  expect(signal!.aborted).toBe(true)
  await stage(h, task.id, "cancelled")
  await h.dispose()
})
it("retries failed execution without changing the original", async () => {
  let attempts = 0
  const h = make(async () => { if (++attempts === 1) throw new Error("failed"); return result })
  const original = await h.enqueue(input)
  await h.start()
  await stage(h, original.id, "failed")
  const retry = await h.retry(original.id)
  await stage(h, retry.id)
  expect(retry.parentId).toBe(original.id)
  await stage(h, original.id, "failed")
  await h.dispose()
})
it("replays the full current snapshot synchronously and unsubscribes", async () => {
  const h = make()
  const tasks = [await h.enqueue(input), await h.enqueue(input)]
  const listener = vi.fn()
  const off = h.subscribe(listener, { replay: true })
  expect(listener.mock.calls.map(([task]) => task.id)).toEqual((await h.list()).map(task => task.id))
  expect(listener).toHaveBeenCalledTimes(tasks.length)
  off()
  await h.enqueue(input)
  expect(listener).toHaveBeenCalledTimes(tasks.length)
  await h.dispose()
})
it("keeps persisted tasks readable after disposal and clears subscriptions", async () => {
  const h = make()
  const task = await h.enqueue(input)
  const listener = vi.fn()
  h.subscribe(listener)
  await h.dispose()
  expect(await h.list()).toEqual([task])
  expect(files.size).toBe(1)
  await h.enqueue(input)
  expect(listener).not.toHaveBeenCalled()
})
