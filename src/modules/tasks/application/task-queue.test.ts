import { expect, it, vi } from "vitest"
import { createTaskProtocol, type TaskProtocol } from "../domain/protocol"
import { createTaskQueue } from "./task-queue"

const time = "2026-11-10T00:00:00.000Z"
it("adopts external running records unchanged with isolated payload and observers", async () => {
  const { queue, records, onError } = fixture()
  const task = { ...createTaskProtocol({ ...input, id: "external", now: time }),
    stage: "running" as const, payload: { sourcePath: "external.md" } }
  queue.subscribe(record => {
    expect(records.get(record.id)).toEqual(task)
    ;(record.payload as { sourcePath: string }).sourcePath = "observer"
    throw new Error("observer")
  })
  const adopted = await queue.adopt(task)
  expect(adopted).toEqual(task)
  expect(records.get(task.id)).toEqual(task)
  expect(await queue.get(task.id)).toEqual(task)
  task.payload.sourcePath = "caller"
  ;(adopted.payload as { sourcePath: string }).sourcePath = "return"
  expect((await queue.get(task.id))?.payload).toEqual({ sourcePath: "external.md" })
  expect(onError).toHaveBeenCalledTimes(1)
})

it("adopts an external running to queued rollback", async () => {
  const { queue } = fixture()
  const task = createTaskProtocol({ ...input, id: "external", now: time })
  await queue.adopt({ ...task, stage: "running" })
  await expect(queue.adopt(task)).resolves.toEqual(task)
  expect((await queue.get(task.id))?.stage).toBe("queued")
})

it.each([
  { id: "" }, { kind: "nope" }, { stage: "weird" }, { createdAt: "invalid" },
  { updatedAt: "invalid" }, { log: null }, { result: null },
  { result: [] }, { result: { report: null } }, { result: { ingest: null } },
])("rejects malformed adopted records without saving or publishing: %j", async patch => {
  const { queue, save } = fixture()
  const listener = vi.fn()
  queue.subscribe(listener)
  const task = { ...createTaskProtocol({ ...input, id: "external", now: time }), ...patch } as TaskProtocol
  await expect(queue.adopt(task)).rejects.toThrow("Invalid adopted task")
  expect(save).not.toHaveBeenCalled()
  expect(listener).not.toHaveBeenCalled()
  expect(await queue.list()).toEqual([])
})
const input = { kind: "research" as const, scopeId: "scope", executorId: "executor" }
function fixture(initial: TaskProtocol[] = []) {
  const records = new Map(initial.map(task => [task.id, structuredClone(task)]))
  const save = vi.fn(async (task: TaskProtocol) => { records.set(task.id, structuredClone(task)) })
  const onError = vi.fn()
  let sequence = 0
  const queue = createTaskQueue({ storage: { save, load: async () => structuredClone([...records.values()]) },
    now: () => time, newId: () => `task-${++sequence}`, onError })
  return { queue, save, records, onError }
}

it("preserves payload on enqueue, get and recovery of queued and interrupted tasks", async () => {
  const { queue, records } = fixture()
  const payload = { sourcePath: "a.md" }
  const queued = await queue.enqueue({ ...input, payload })
  const interrupted = await queue.enqueue({ ...input, payload })
  expect((await queue.get(queued.id))?.payload).toEqual(payload)
  expect(records.get(queued.id)?.payload).toEqual(payload)
  await queue.transition(interrupted.id, "running")
  expect(await queue.recover()).toEqual({ recovered: 1, interrupted: 1 })
  for (const task of [queued, interrupted]) {
    expect(await queue.get(task.id)).toMatchObject({ stage: "queued", payload })
    expect(records.get(task.id)?.payload).toEqual(payload)
    expect(JSON.stringify((await queue.get(task.id))?.log)).not.toContain(payload.sourcePath)
  }
})

it("persists enqueue before notifying, and persists every transition", async () => {
  const { queue, save, records } = fixture()
  queue.subscribe(task => { expect(records.get(task.id)).toEqual(task) })
  const task = await queue.enqueue(input)
  expect(await queue.list()).toEqual([task])
  expect(task.stage).toBe("queued")
  await queue.transition(task.id, "running")
  await queue.transition(task.id, "report")
  expect(save.mock.calls.map(([record]) => record.stage)).toEqual(["queued", "running", "report"])
  expect((await queue.get(task.id))?.stage).toBe("report")
  expect(await queue.get("missing")).toBeUndefined()
})

it("propagates invalid transitions without saving or notifying", async () => {
  const { queue, save } = fixture()
  const task = await queue.enqueue(input)
  const listener = vi.fn()
  queue.subscribe(listener)
  await expect(queue.transition(task.id, "done")).rejects.toThrow("Invalid task transition: queued -> done")
  expect(save).toHaveBeenCalledTimes(1)
  expect(listener).not.toHaveBeenCalled()
})

it("requires the result appropriate to the task kind", async () => {
  const { queue } = fixture()
  const research = await queue.enqueue(input)
  await queue.transition(research.id, "running")
  await queue.transition(research.id, "report")
  await queue.recordResult(research.id, { report: { ref: "report.md", completedAt: time } })
  expect((await queue.transition(research.id, "done")).stage).toBe("done")
  const ingest = await queue.enqueue({ ...input, kind: "ingest" })
  await queue.transition(ingest.id, "running")
  await expect(queue.transition(ingest.id, "done")).rejects.toThrow("Task result is incomplete for kind ingest")
})

it.each([true, false])("preserves error retriable=%s", async retriable => {
  const { queue } = fixture()
  const task = await queue.enqueue(input)
  await queue.transition(task.id, "running")
  const error = { code: "failure", message: "Failed", retriable }
  expect(await queue.fail(task.id, error)).toMatchObject({ stage: "failed", error })
})

it("replays synchronously in sorted order, emits changes, and isolates observers", async () => {
  const { queue, onError } = fixture()
  const listener = vi.fn()
  const unsubscribe = queue.subscribe(listener)
  const task = await queue.enqueue(input)
  await queue.enqueue(input)
  const replay = vi.fn()
  queue.subscribe(replay, { replay: true })
  expect(replay.mock.calls.map(([record]) => record.id)).toEqual(["task-1", "task-2"])
  const bad = queue.subscribe(() => { throw new Error("observer") }, { replay: true })
  const later = vi.fn()
  queue.subscribe(later)
  await queue.transition(task.id, "running")
  await queue.progress(task.id, "Working")
  await queue.recordResult(task.id, { report: { ref: null, completedAt: time } })
  await queue.fail(task.id, { code: "failed", message: "failure", retriable: true })
  expect(listener).toHaveBeenCalledTimes(6)
  expect(later).toHaveBeenCalledTimes(4)
  expect(onError).toHaveBeenCalledTimes(6)
  expect((await queue.get(task.id))?.progress).toBe("Working")
  unsubscribe(); bad()
  await queue.enqueue(input)
  expect(listener).toHaveBeenCalledTimes(6)
})

it("recovers interrupted records once and leaves queued and terminal records unchanged", async () => {
  const initial = (["queued", "running", "done", "report"] as const).map((stage, index) => ({
    ...createTaskProtocol({ ...input, id: `task-${index}`, now: time }), stage,
    startedAt: stage === "queued" ? null : time, progress: "Existing progress",
  }))
  const { queue, save, records } = fixture(initial)
  expect(await queue.recover()).toEqual({ recovered: 2, interrupted: 2 })
  for (const index of [1, 3]) {
    const task = await queue.get(`task-${index}`)
    expect(task).toMatchObject({ stage: "queued", startedAt: null, progress: "", updatedAt: time })
    expect(task?.log).toEqual([{ at: time, level: "warn", message: "Interrupted by restart; returned to queue" }])
  }
  for (const index of [0, 2]) {
    expect(await queue.get(`task-${index}`)).toEqual(initial[index])
    expect(records.get(`task-${index}`)).toEqual(initial[index])
  }
  expect(save).toHaveBeenCalledTimes(2)
  expect(await queue.recover()).toEqual({ recovered: 0, interrupted: 0 })
  expect(save).toHaveBeenCalledTimes(2)
})

it("sorts by creation time then ID and returns isolated snapshots", async () => {
  const initial = ["b", "a", "older"].map(id => createTaskProtocol({ ...input, id,
    now: id === "older" ? "2026-11-09T00:00:00.000Z" : time }))
  const { queue } = fixture(initial)
  await queue.recover()
  const tasks = await queue.list()
  expect(tasks.map(task => task.id)).toEqual(["older", "a", "b"])
  tasks[0].log.push({ at: time, level: "warn", message: "external" })
  expect((await queue.get("older"))?.log).toEqual([])
})

it("does not publish or change memory when saving fails", async () => {
  const { queue, save } = fixture()
  const task = await queue.enqueue(input)
  const listener = vi.fn()
  queue.subscribe(listener)
  save.mockRejectedValueOnce(new Error("disk"))
  await expect(queue.transition(task.id, "running")).rejects.toThrow("disk")
  expect((await queue.get(task.id))?.stage).toBe("queued")
  expect(listener).not.toHaveBeenCalled()
})
