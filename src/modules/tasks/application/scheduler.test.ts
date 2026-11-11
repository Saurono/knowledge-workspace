import { expect, it, vi } from "vitest"
import { createTaskScheduler, type TaskQueuePort, type TaskRunnerPort } from "./scheduler"
import { appendTaskLog, createTaskProtocol, failTask, recordTaskResult, taskTransition, type TaskProtocol } from "../domain/protocol"

const now = () => "2026-11-10T00:00:00Z"
function fixture(concurrency = 2) {
  const tasks = new Map<string, TaskProtocol>()
  const listeners = new Set<(task: TaskProtocol) => void>()
  const events: string[] = []
  const save = (task: TaskProtocol) => {
    tasks.set(task.id, structuredClone(task))
    for (const listener of listeners) listener(structuredClone(task))
    return structuredClone(task)
  }
  const requireTask = (id: string) => {
    const task = tasks.get(id)
    if (!task) throw new Error(`Unknown task: ${id}`)
    return task
  }
  let sequence = 0
  const queue: TaskQueuePort = {
    async list() { return structuredClone([...tasks.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) },
    async get(id) { return structuredClone(tasks.get(id)) },
    async enqueue(input) { return save(createTaskProtocol({ ...input, id: `task-${++sequence}`, now: now() })) },
    async transition(id, stage) { events.push(`${id}:${stage}`); return save(taskTransition(requireTask(id), stage, now())) },
    async progress(id, text) { return save({ ...appendTaskLog(requireTask(id), { at: now(), level: "info", message: text }), progress: text, updatedAt: now() }) },
    async recordResult(id, patch) { events.push(`${id}:result`); return save({ ...recordTaskResult(requireTask(id), patch), updatedAt: now() }) },
    async fail(id, error) { events.push(`${id}:failed`); return save(failTask(requireTask(id), error, now())) },
    subscribe(listener, options) {
      listeners.add(listener)
      if (options?.replay) for (const task of tasks.values()) listener(structuredClone(task))
      return () => { listeners.delete(listener) }
    },
  }
  type Outcome = Awaited<ReturnType<TaskRunnerPort["execute"]>>
  const controls = new Map<string, { resolve: (value: Outcome) => void; reject: (error: unknown) => void }>()
  const started: string[] = []
  const runner: TaskRunnerPort = {
    execute: vi.fn((_executor, _input, request) => {
      started.push(request.id)
      return new Promise<Outcome>((resolve, reject) => { controls.set(request.id, { resolve, reject }) })
    }),
    cancel: vi.fn(id => { controls.get(id)?.resolve({ status: "cancelled" }) }),
  }
  const onError = vi.fn()
  const scheduler = createTaskScheduler({ queue, runner, concurrency, now, onError })
  const add = (scopeId: string) => queue.enqueue({ kind: "other", scopeId, executorId: "executor" })
  // Wait on observable queue events, not timer sleeps or unawaited executions.
  const terminal = (id: string) => new Promise<void>(resolve => {
    const stop = queue.subscribe(task => {
      if (task.id === id && ["done", "failed", "cancelled"].includes(task.stage)) { stop(); resolve() }
    })
  })
  const finish = async (id: string, error?: Error) => {
    const ended = terminal(id)
    if (error) controls.get(id)!.reject(error)
    else controls.get(id)!.resolve({ status: "succeeded", value: "value" })
    await ended
    await scheduler.notify()
  }
  return { queue, runner, scheduler, add, started, events, controls, onError, finish, terminal }
}

it("并发上限 2，第三条在结束后补位", async () => {
  const f = fixture()
  const a = await f.add("a"), b = await f.add("b"), c = await f.add("c")
  await f.scheduler.start()
  expect(f.started).toEqual([a.id, b.id])
  expect(f.scheduler.running()).toHaveLength(2)
  await f.finish(a.id)
  expect(f.started).toEqual([a.id, b.id, c.id])
  await f.finish(b.id); await f.finish(c.id)
})

it("concurrency 0 按 1 处理", async () => {
  const f = fixture(0)
  const a = await f.add("a"), b = await f.add("b")
  await f.scheduler.start()
  expect(f.started).toEqual([a.id])
  await f.finish(a.id)
  expect(f.started).toEqual([a.id, b.id])
  await f.finish(b.id)
})

it("同域串行并保持开始顺序，不同域并行", async () => {
  const f = fixture()
  const a = await f.add("same"), b = await f.add("same"), c = await f.add("other")
  await f.scheduler.start()
  expect(f.started).toEqual([a.id, c.id])
  await f.finish(a.id)
  expect(f.started).toEqual([a.id, c.id, b.id])
  await f.finish(b.id); await f.finish(c.id)
})

it("成功按 running、执行、结果、done 顺序写入", async () => {
  const f = fixture()
  const task = await f.queue.enqueue({ kind: "research", scopeId: "s", executorId: "executor" })
  const patch = { report: { ref: "report", completedAt: now() } }
  const inputFor = vi.fn(() => ({ input: true }))
  const onSucceeded = vi.fn(() => patch)
  const scheduler = createTaskScheduler({ queue: f.queue, runner: f.runner, now, inputFor, onSucceeded })
  await scheduler.start()
  expect(f.events).toEqual([`${task.id}:running`])
  expect(f.runner.execute).toHaveBeenCalledWith("executor", { input: true }, { id: task.id, scopeId: "s" })
  const ended = f.terminal(task.id)
  f.controls.get(task.id)!.resolve({ status: "succeeded", value: 42 })
  await ended; await scheduler.notify()
  expect(onSucceeded).toHaveBeenCalledWith(expect.objectContaining({ stage: "running" }), 42)
  expect(f.events).toEqual([`${task.id}:running`, `${task.id}:result`, `${task.id}:done`])
  expect((await f.queue.get(task.id))?.result).toMatchObject(patch)
})

it("执行失败落 failed 且不向调度调用抛错", async () => {
  const f = fixture()
  const a = await f.add("s")
  await f.scheduler.start()
  const error = new Error("boom")
  await f.finish(a.id, error)
  expect(f.onError).toHaveBeenCalledWith(error)
  expect(await f.queue.get(a.id)).toMatchObject({ stage: "failed", error: { code: "execution_failed", message: String(error), retriable: true } })
})

it("取消 running 只写一次终态并立即补位；queued 直接取消；终态无动作", async () => {
  const f = fixture(1)
  const a = await f.add("s"), b = await f.add("s"), c = await f.add("c")
  await f.scheduler.cancel(c.id)
  await f.scheduler.start()
  await f.scheduler.cancel(a.id)
  expect(f.runner.cancel).toHaveBeenCalledWith(a.id)
  expect(f.started).toEqual([a.id, b.id])
  expect(f.events.filter(event => event.startsWith(`${a.id}:`))).toEqual([`${a.id}:running`, `${a.id}:cancelled`])
  await f.scheduler.cancel(a.id)
  expect(f.runner.cancel).toHaveBeenCalledTimes(1)
  await f.finish(b.id)
  expect((await f.queue.get(c.id))?.stage).toBe("cancelled")
})

it("重复和并行 start / notify 不重复执行同一 id", async () => {
  const f = fixture()
  const a = await f.add("s")
  await Promise.all([f.scheduler.start(), f.scheduler.start(), f.scheduler.notify()])
  expect(f.runner.execute).toHaveBeenCalledTimes(1)
  await f.finish(a.id)
  await f.scheduler.start()
  expect(f.runner.execute).toHaveBeenCalledTimes(1)
})

it("取消与成功或拒绝同时发生仍只进入 cancelled", async () => {
  for (const rejects of [false, true]) {
    const f = fixture(1)
    const a = await f.add("s")
    await f.scheduler.start()
    f.runner.cancel = vi.fn(id => {
      if (rejects) f.controls.get(id)!.reject(new Error("aborted"))
      else f.controls.get(id)!.resolve({ status: "succeeded", value: "late" })
    })
    await Promise.all([f.scheduler.cancel(a.id), f.scheduler.cancel(a.id)])
    expect(f.events).toEqual([`${a.id}:running`, `${a.id}:cancelled`])
    expect(f.scheduler.running()).toEqual([])
  }
})

it("无 queued 时 start 返回且没有运行任务，默认输入和成功日志", async () => {
  const f = fixture()
  await f.scheduler.start()
  expect(f.scheduler.running()).toEqual([])
  const a = await f.add("s")
  await f.scheduler.notify()
  expect(f.runner.execute).toHaveBeenCalledWith("executor", a.id, expect.objectContaining({ id: a.id }))
  await f.finish(a.id)
  await f.scheduler.start()
  expect(f.scheduler.running()).toEqual([])
  expect((await f.queue.get(a.id))?.log).toEqual([{ at: now(), level: "info", message: `Execution succeeded at ${now()}` }])
})

it("重试 failed / cancelled 新建带日志子任务，原终态不变，拒绝 done / queued / running", async () => {
  const f = fixture()
  const a = await f.add("s"), b = await f.add("b")
  await expect(f.scheduler.retry(a.id)).rejects.toThrow("cannot be retried")
  await f.scheduler.cancel(b.id)
  const cancelled = await f.queue.get(b.id)
  const retryB = await f.scheduler.retry(b.id)
  expect(retryB).toMatchObject({ stage: "queued", parentId: b.id, kind: b.kind, scopeId: b.scopeId, executorId: b.executorId,
    log: [{ at: now(), level: "info", message: `Retry of ${b.id}` }] })
  expect(retryB.id).not.toBe(b.id)
  expect(await f.queue.get(b.id)).toEqual(cancelled)
  await f.scheduler.start()
  await expect(f.scheduler.retry(a.id)).rejects.toThrow("cannot be retried")
  await f.finish(a.id, new Error("failed"))
  const failed = await f.queue.get(a.id)
  const retryA = await f.scheduler.retry(a.id)
  expect(retryA).toMatchObject({ stage: "queued", parentId: a.id })
  expect(await f.queue.get(a.id)).toEqual(failed)
  await f.scheduler.cancel(retryA.id)
  await f.finish(retryB.id)
  await expect(f.scheduler.retry(retryB.id)).rejects.toThrow("cannot be retried")
})
