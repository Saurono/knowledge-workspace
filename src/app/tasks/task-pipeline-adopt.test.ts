import { beforeEach, expect, it, vi } from "vitest"
import { createTaskProtocol, type TaskProtocol } from "@/modules/tasks/domain/protocol"
import { createTaskPipeline } from "./task-pipeline"

const files = vi.hoisted(() => new Map<string, string>())
vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}), fileExists: vi.fn(async () => true),
  writeFileAtomic: vi.fn(async (path: string, text: string) => { files.set(path, text) }),
  readFile: async (path: string) => files.get(path),
  listDirectory: async () => [...files.keys()].map(path => ({ name: path.split("/").pop(), path })),
}))
beforeEach(() => { files.clear(); vi.clearAllMocks() })
const now = () => "2026-11-11T00:00:00.000Z"
const input = { kind: "ingest" as const, scopeId: "scope", executorId: "external" }
const external = () => createTaskProtocol({ ...input, id: "adopted", now: now() })
const make = () => {
  const execute = vi.fn(async (_task: TaskProtocol) => ({ ingest: { completedAt: now(), accepted: 1, rejected: 0 } }))
  return { execute, pipeline: createTaskPipeline({ root: "C:/project", now, execute }) }
}

it("does not execute adopted queued tasks on the initial scan", async () => {
  const { pipeline, execute } = make()
  const task = await pipeline.adopt(external())
  await pipeline.start()
  await pipeline.scheduler.notify()
  expect((await pipeline.queue.get(task.id))?.stage).toBe("queued")
  expect(execute).not.toHaveBeenCalled()
  pipeline.dispose()
})

it("filters adopted tasks when real tasks trigger subsequent scans", async () => {
  const { pipeline, execute } = make()
  const adopted = await pipeline.adopt(external())
  await pipeline.start()
  const real = await pipeline.enqueue(input)
  await vi.waitFor(async () => expect((await pipeline.queue.get(real.id))?.stage).toBe("done"))
  await pipeline.scheduler.notify()
  expect((await pipeline.queue.get(adopted.id))?.stage).toBe("queued")
  expect(execute).toHaveBeenCalledTimes(1)
  expect(execute.mock.calls[0]?.[0]).toMatchObject({ id: real.id })
  for (const [task] of execute.mock.calls) expect(task.id).not.toBe(adopted.id)
  pipeline.dispose()
})

it("does not revive terminal adopted tasks with unknown ingest counts", async () => {
  const { pipeline, execute } = make()
  const task = await pipeline.adopt({ ...external(), stage: "done" })
  await pipeline.start()
  await pipeline.scheduler.notify()
  expect(await pipeline.queue.get(task.id)).toEqual(task)
  expect(execute).not.toHaveBeenCalled()
  pipeline.dispose()
})
