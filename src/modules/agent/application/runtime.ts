import type { AvailableAgentSkill, BackendAgentEventPayload, BackendAgentResponse } from "../domain"
export interface AgentTurnInput<Config> {
  projectId: string
  llmConfig: Config
  request: { sessionId: string; runId?: string; message: string; [key: string]: unknown }
}
export interface AgentRunIdentity { projectId: string; sessionId: string; runId?: string }
export interface AgentRuntimePort<Config> {
  listen(handler: (event: BackendAgentEventPayload) => void): Promise<() => void>
  start(input: AgentTurnInput<Config>): Promise<unknown>
  turn(input: AgentTurnInput<Config>): Promise<BackendAgentResponse>
  cancel(identity: AgentRunIdentity): Promise<unknown>
  skills(projectPath: string): Promise<AvailableAgentSkill[]>
  setTimer(callback: () => void, milliseconds: number): unknown
  clearTimer(timer: unknown): void
}
/** UI/API bridge to the shared backend engine; never reimplements tools or routing. */
export function createAgentRuntime<Config>(port: AgentRuntimePort<Config>) {
  return {
    skills: port.skills,
    turn: port.turn,
    cancel: port.cancel,
    async stream(input: AgentTurnInput<Config>, onEvent: (event: BackendAgentEventPayload["event"]) => void, options: { signal?: AbortSignal; idleTimeoutMs: number }) {
      const identity = { projectId: input.projectId, sessionId: input.request.sessionId, runId: input.request.runId }
      if (options.signal?.aborted) throw new DOMException("Agent cancelled", "AbortError")
      let closed = false, started = false
      let unlisten: (() => void) | undefined
      let timer: unknown
      let resolve!: () => void, reject!: (error: unknown) => void
      const done = new Promise<void>((yes, no) => { resolve = yes; reject = no })
      void done.catch(() => {})
      const finish = (error?: unknown) => {
        if (closed) return
        closed = true
        if (error) reject(error)
        else resolve()
      }
      const abort = () => finish(new DOMException("Agent cancelled", "AbortError"))
      const reset = () => {
        if (timer !== undefined) port.clearTimer(timer)
        timer = port.setTimer(() => finish(new Error("Agent stream timed out")), options.idleTimeoutMs)
      }
      options.signal?.addEventListener("abort", abort, { once: true })
      reset()
      const registration = Promise.resolve().then(() => port.listen(payload => {
        if (closed || payload.sessionId !== identity.sessionId || payload.runId !== identity.runId) return
        reset()
        try {
          onEvent(payload.event)
          if (payload.event.type === "done") finish()
          else if (payload.event.type === "error") finish(new Error(payload.event.message || "Agent failed"))
        } catch (error) { finish(error) }
      })).then(stop => { if (closed) stop(); else unlisten = stop })
      try {
        await Promise.race([registration, done])
        if (!closed) {
          if (options.signal?.aborted) abort()
          else {
            started = true
            // Completion/abort can arrive while the native start invocation is pending.
            await Promise.race([port.start(input).then(() => done), done])
          }
        }
        await done
      } catch (error) {
        finish(error)
        if (started) void port.cancel(identity).catch(() => {})
        throw error
      } finally {
        closed = true
        if (timer !== undefined) port.clearTimer(timer)
        options.signal?.removeEventListener("abort", abort)
        unlisten?.()
      }
    },
  }
}
