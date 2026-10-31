import { expect, it, vi } from "vitest"
import { createCodexCliTransport } from "./codex"
import type { CliTransportPorts } from "./ports"
it("binds the invocation cwd before asynchronous registration and ignores events after completion", async () => {
  let cwd = "/first"
  const handlers = new Map<string, (event: { payload: unknown }) => void>()
  const stop = vi.fn(), token = vi.fn(), done = vi.fn(), error = vi.fn()
  const spawn = vi.fn(async () => {
    handlers.get("codex-cli:run")!({ payload: JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "answer" } }) })
    handlers.get("codex-cli:run:done")!({ payload: { code: 0, stderr: "" } })
  })
  const ports: CliTransportPorts = {
    workingDirectory: () => cwd, createId: () => "run", development: false,
    process: { spawn, kill: vi.fn(async () => {}) },
    events: { listen: async (channel, callback) => { cwd = "/second"; handlers.set(channel, callback as (event: { payload: unknown }) => void); return stop } },
  }
  await createCodexCliTransport(ports).streamCodexCli({ model: "model" }, [{ role: "user", content: "q" }], { onToken: token, onDone: done, onError: error })
  expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ workingDirectory: "/first" }))
  handlers.get("codex-cli:run")!({ payload: JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "late" } }) })
  expect(token).toHaveBeenCalledExactlyOnceWith("answer")
  expect(done).toHaveBeenCalledOnce(); expect(error).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledTimes(2)
})
