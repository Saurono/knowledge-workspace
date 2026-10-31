import { afterEach, describe, expect, it, vi } from "vitest"
import { createAgentRuntime, type AgentRuntimePort } from "./runtime"
import type { BackendAgentEventPayload } from "../domain"
const input = { projectId: "p", llmConfig: {}, request: { sessionId: "s", runId: "r", message: "q" } }
function fixture() {
  let handler!: (event: BackendAgentEventPayload) => void
  const stop = vi.fn()
  const port: AgentRuntimePort<{}> = {
    listen: vi.fn(async next => { handler = next; return stop }), start: vi.fn(async () => "s"),
    turn: vi.fn(), cancel: vi.fn(async () => {}), skills: vi.fn(async () => []),
    setTimer: (fn, delay) => setTimeout(fn, delay), clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  }
  const runtime = createAgentRuntime(port)
  return { runtime, port, stop, emit: (type: string, runId = "r") => handler({ sessionId: "s", runId, event: { type, text: "hello" } }) }
}
afterEach(() => vi.useRealTimers())
describe("Agent backend run lifecycle", () => {
  it("registers first, filters other runs, ends once and detaches", async () => {
    const f = fixture(), event = vi.fn()
    const work = f.runtime.stream(input, event, { idleTimeoutMs: 1000 })
    await vi.waitFor(() => expect(f.port.start).toHaveBeenCalledOnce())
    f.emit("messageDelta", "other"); f.emit("messageDelta"); f.emit("done"); f.emit("messageDelta")
    await work
    expect(event.mock.calls.map(([value]) => value.type)).toEqual(["messageDelta", "done"])
    expect(f.stop).toHaveBeenCalledOnce()
  })
  it("cancels a pending native start without waiting for its return", async () => {
    const f = fixture(), owner = new AbortController()
    vi.mocked(f.port.start).mockImplementation(() => new Promise(() => {}))
    const work = f.runtime.stream(input, () => {}, { signal: owner.signal, idleTimeoutMs: 1000 })
    await vi.waitFor(() => expect(f.port.start).toHaveBeenCalledOnce())
    owner.abort()
    await expect(work).rejects.toMatchObject({ name: "AbortError" })
    expect(f.port.cancel).toHaveBeenCalledWith({ projectId: "p", sessionId: "s", runId: "r" })
    expect(f.stop).toHaveBeenCalledOnce()
  })
  it("detaches a listener that registers after cancellation and does not spawn", async () => {
    const f = fixture(), owner = new AbortController()
    let release!: (stop: () => void) => void
    vi.mocked(f.port.listen).mockReturnValue(new Promise(resolve => { release = resolve }))
    const work = f.runtime.stream(input, () => {}, { signal: owner.signal, idleTimeoutMs: 1000 })
    owner.abort()
    await expect(work).rejects.toMatchObject({ name: "AbortError" })
    release(f.stop)
    await vi.waitFor(() => expect(f.stop).toHaveBeenCalledOnce())
    expect(f.port.start).not.toHaveBeenCalled()
  })
  it("times out, cancels and releases listeners", async () => {
    vi.useFakeTimers()
    const f = fixture()
    const work = f.runtime.stream(input, () => {}, { idleTimeoutMs: 10 })
    const rejected = expect(work).rejects.toThrow("timed out")
    await vi.advanceTimersByTimeAsync(10)
    await rejected
    expect(f.stop).toHaveBeenCalledOnce()
    expect(f.port.cancel).toHaveBeenCalledOnce()
  })
})
