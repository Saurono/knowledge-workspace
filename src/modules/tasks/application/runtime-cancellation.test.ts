import { describe, expect, it, vi } from "vitest"
import { createTaskRuntime, type TaskExecutionContext } from "./runtime"

describe("owner cancellation contract", () => {
  it("does not start an executor with a pre-aborted owner signal", async () => {
    const owner = new AbortController()
    owner.abort()
    const execute = vi.fn(async () => 1)
    const runtime = createTaskRuntime()
    runtime.register("work", { execute })
    await expect(
      runtime.execute("work", null, { id: "a", scopeId: "p", signal: owner.signal }),
    ).resolves.toEqual({ status: "cancelled" })
    expect(execute).not.toHaveBeenCalled()
    expect(runtime.get("a")).toEqual({
      id: "a",
      scopeId: "p",
      executorId: "work",
      status: "cancelled",
      detail: "Cancelled",
    })
  })

  it("propagates owner cancellation and waits for the executor to release its slot", async () => {
    const owner = new AbortController()
    let context!: TaskExecutionContext
    let finish!: () => void
    const runtime = createTaskRuntime()
    runtime.register("work", {
      execute: async (_input, ctx) => {
        context = ctx
        await new Promise<void>((resolve) => {
          finish = resolve
        })
      },
    })
    const pending = runtime.execute("work", null, { id: "a", scopeId: "p", signal: owner.signal })
    owner.abort("project changed")
    expect(context.signal.aborted).toBe(true)
    expect(context.signal.reason).toBe("project changed")
    expect(runtime.canCancel("a")).toBe(true)
    finish()
    expect(await pending).toEqual({ status: "cancelled" })
    expect(runtime.canCancel("a")).toBe(false)
  })

  it.each(["success", "failure", "cancel"])("removes the owner listener after %s", async (mode) => {
    const owner = new AbortController()
    const add = vi.spyOn(owner.signal, "addEventListener")
    const remove = vi.spyOn(owner.signal, "removeEventListener")
    const runtime = createTaskRuntime()
    runtime.register("work", {
      execute: async () => {
        if (mode === "failure") throw new Error("failed")
        if (mode === "cancel") owner.abort()
        return 1
      },
    })
    const pending = runtime.execute("work", null, { id: "a", scopeId: "p", signal: owner.signal })
    if (mode === "failure") await expect(pending).rejects.toThrow("failed")
    else await pending
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1])
  })

  it("does not let an old owner or late progress cancel or overwrite a retry", async () => {
    const previous = new AbortController()
    const current = new AbortController()
    let oldContext!: TaskExecutionContext
    let attempt = 0
    let finish!: () => void
    const runtime = createTaskRuntime()
    runtime.register("work", {
      execute: async (_input, ctx) => {
        if (++attempt === 1) {
          oldContext = ctx
          return
        }
        await new Promise<void>((resolve) => {
          finish = resolve
        })
      },
    })
    await runtime.execute("work", null, { id: "a", scopeId: "p", signal: previous.signal })
    const retry = runtime.execute("work", null, { id: "a", scopeId: "p", signal: current.signal })
    previous.abort()
    oldContext.progress("old output")
    expect(runtime.get("a")?.detail).toBe("")
    finish()
    expect((await retry).status).toBe("succeeded")
  })
})
