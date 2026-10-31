import { describe, expect, it } from "vitest"
import { createTaskRuntime, type TaskExecutionContext } from "../index"
describe("task executor registry", () => {
  it("runs independent executors and rejects duplicate registration", async () => {
    const runtime = createTaskRuntime()
    runtime.register<number, number>("double", { execute: async (value) => value * 2 })
    expect(() => runtime.register("double", { execute: async () => 0 })).toThrow()
    await expect(runtime.execute("double", 3, { id: "a", scopeId: "p" })).resolves.toEqual({
      status: "succeeded",
      value: 6,
    })
    expect(runtime.get("a")?.status).toBe("succeeded")
  })
  it("cancels one execution without aborting another", async () => {
    const runtime = createTaskRuntime()
    const finish = new Map<string, () => void>()
    runtime.register("wait", {
      execute: async (_input, ctx) =>
        new Promise<void>((resolve, reject) => {
          finish.set(ctx.taskId, resolve)
          ctx.signal.addEventListener("abort", () => reject(new Error("aborted")))
        }),
    })
    const a = runtime.execute("wait", null, { id: "a", scopeId: "p" })
    const b = runtime.execute("wait", null, { id: "b", scopeId: "p" })
    runtime.cancel("a")
    await expect(a).resolves.toEqual({ status: "cancelled" })
    expect(runtime.canCancel("b")).toBe(true)
    finish.get("b")!()
    await expect(b).resolves.toMatchObject({ status: "succeeded" })
  })
  it("does not revive a completed task when an executor sends late progress", async () => {
    let context!: TaskExecutionContext
    const runtime = createTaskRuntime()
    runtime.register("one", {
      execute: async (_input, ctx) => {
        context = ctx
        return 1
      },
    })
    await runtime.execute("one", null, { id: "one", scopeId: "p" })
    context.progress("late")
    expect(runtime.get("one")?.status).toBe("succeeded")
  })
  it("keeps task outcomes authoritative when a UI observer fails", async () => {
    const runtime = createTaskRuntime({
      onEvent: () => {
        throw new Error("view gone")
      },
    })
    runtime.register("one", { execute: async () => 1 })
    await expect(runtime.execute("one", null, { id: "one", scopeId: "p" })).resolves.toMatchObject({
      status: "succeeded",
    })
    expect(runtime.canCancel("one")).toBe(false)
  })
  it("discards results when the execution scope changes", async () => {
    let current = true
    let finish!: (value: number) => void
    const runtime = createTaskRuntime({ isScopeCurrent: () => current })
    runtime.register("delayed", {
      execute: () =>
        new Promise<number>((resolve) => {
          finish = resolve
        }),
    })
    const result = runtime.execute("delayed", null, { id: "one", scopeId: "p" })
    current = false
    finish(1)
    await expect(result).resolves.toEqual({ status: "cancelled" })
  })
})
