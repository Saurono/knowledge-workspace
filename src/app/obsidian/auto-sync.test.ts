import { describe, expect, it, vi } from "vitest"
import { createPhaseReceiptAutoSync, syncConfiguredPhaseReceipts, type PhaseReceiptAutoSyncPorts } from "./auto-sync"
import type { PhaseReceiptV2 } from "@/modules/obsidian/domain"

function fakeTimerPorts(overrides: Partial<PhaseReceiptAutoSyncPorts> = {}) {
  const intervals = new Map<number, { callback: () => void; milliseconds: number }>()
  let nextHandle = 0
  const ports: PhaseReceiptAutoSyncPorts = {
    read: vi.fn(async () => ({ vaultPath: "/vault" })),
    sync: vi.fn(async () => ({ delivered: 1, failed: [] })),
    setInterval: vi.fn((callback, milliseconds) => {
      const handle = ++nextHandle
      intervals.set(handle, { callback, milliseconds })
      return handle
    }),
    clearInterval: vi.fn(handle => { intervals.delete(handle as number) }),
    ...overrides,
  }
  return { ports, intervals, fire: (handle: number) => intervals.get(handle)?.callback() }
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe("global phase receipt auto-sync", () => {
  it("retries only eligible feedback for an explicitly configured Vault, then syncs final receipts", async () => {
    const receipt = (id: string, feedback: string) => ({
      id,
      checkpoint: {
        policy: { feedback: "required" },
        stages: { compile: { status: "succeeded" }, index: { status: "succeeded" }, feedback: { status: feedback } },
      },
    }) as unknown as PhaseReceiptV2
    const retryFeedback = vi.fn(async (_path: string, id: string) => { if (id === "receipt-bad") throw new Error("Vault offline") })
    const sync = vi.fn(async () => ({ delivered: 1, failed: [] as string[] }))
    const onFeedbackError = vi.fn()
    const ports = {
      read: vi.fn(async () => ({ vaultPath: "/vault", receipts: { ready: receipt("receipt-ready", "succeeded"), failed: receipt("receipt-bad", "failed") } })),
      retryFeedback,
      sync,
      onFeedbackError,
    }
    const result = await syncConfiguredPhaseReceipts("/project", ports)
    expect(retryFeedback).toHaveBeenCalledTimes(1)
    expect(retryFeedback).toHaveBeenCalledWith("/project", "receipt-bad")
    expect(onFeedbackError).toHaveBeenCalledTimes(1)
    expect(sync).toHaveBeenCalledWith("/project")
    expect(result).toEqual({ delivered: 1, failed: [] })

    const withoutVault = { ...ports, read: vi.fn(async () => ({ vaultPath: null, receipts: { failed: receipt("receipt-bad", "failed") } })) }
    await expect(syncConfiguredPhaseReceipts("/project", withoutVault)).resolves.toEqual({ delivered: 0, failed: [] })
    expect(retryFeedback).toHaveBeenCalledTimes(1)
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it("waits for an explicit Vault, recovers from disconnect errors, and retries pending receipts", async () => {
    let vaultPath: string | null = null
    let pending = true
    const sync = vi.fn(async () => {
      if (!vaultPath) throw new Error("Vault disconnected")
      if (pending) throw new Error("Transient write failure")
      return { delivered: 1, failed: [] }
    })
    const onError = vi.fn()
    const fake = fakeTimerPorts({ read: vi.fn(async () => ({ vaultPath })), sync, onError })
    const service = createPhaseReceiptAutoSync(fake.ports)
    const stop = service.start("/project-a")
    await flush()
    expect(sync).not.toHaveBeenCalled()
    const handle = [...fake.intervals.keys()][0]
    expect(fake.intervals.get(handle)?.milliseconds).toBe(15_000)

    vaultPath = "/vault"
    fake.fire(handle)
    await flush()
    expect(sync).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)

    pending = false
    fake.fire(handle)
    await flush()
    expect(sync).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(1)
    stop()
    expect(fake.intervals.size).toBe(0)
  })

  it("does not overlap a slow sync and stops stale project timers when the project changes", async () => {
    const finishes: Array<(value: { delivered: number; failed: string[] }) => void> = []
    const calls: string[] = []
    const fake = fakeTimerPorts({
      sync: vi.fn((projectPath: string) => {
        calls.push(projectPath)
        return new Promise<{ delivered: number; failed: string[] }>(resolve => { finishes.push(resolve) })
      }),
    })
    const service = createPhaseReceiptAutoSync(fake.ports)
    service.start("/project-a")
    await flush()
    const firstHandle = [...fake.intervals.keys()][0]
    fake.fire(firstHandle)
    fake.fire(firstHandle)
    await flush()
    expect(calls).toEqual(["/project-a"])

    const staleCallback = fake.intervals.get(firstHandle)!.callback
    service.start("/project-b")
    expect(fake.intervals.has(firstHandle)).toBe(false)
    staleCallback()
    await flush()
    expect(calls).toEqual(["/project-a", "/project-b"])

    finishes.forEach(resolve => resolve({ delivered: 1, failed: [] }))
    await flush()
    service.dispose()
    expect(fake.intervals.size).toBe(0)
  })
})
