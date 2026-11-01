import { createSharedClient, ApiClientError } from "@/modules/service-api/application"
import type { ReceivedDocument } from "@/modules/service-api/application"
import type { ApiSuccess, ResourceRecord, ProjectEvent, ApiFailure } from "@/modules/service-api/domain"
import { CapabilityError, createSseParser } from "@/modules/platform/domain"
export type ConnectionState = "connecting" | "connected" | "reconnecting" | "stopped" | "error"
const pause = (signal: AbortSignal) => new Promise<void>(resolve => {
  const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve() }
  const timer = setTimeout(finish, 1000)
  signal.addEventListener("abort", finish, { once: true })
  if (signal.aborted) finish()
})
export function createWebPlatform(baseUrl: string, token = "", transport: typeof fetch = fetch) {
  const base = new URL(baseUrl)
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error("Use the service origin as the connection address")
  const origin = base.origin
  const send = (path: string, init: RequestInit = {}) => transport(origin + path, { ...init, redirect: "error", credentials: token ? "omit" : "same-origin", headers: { "X-KW-CSRF": "1", ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
  const api = createSharedClient({ request: (method, path, options) => send(path, { method, signal: options.signal, headers: { "Content-Type": "application/json", ...options.headers }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }) })
  const unsupported = () => Promise.reject(new CapabilityError("unsupported", "This Web connection does not have a local machine bridge"))
  return {
    api,
    capabilities: Object.freeze({ localFiles: false, watcher: false, shell: false, vault: false, upload: true, events: true }),
    readLocal: unsupported, shell: unsupported, configureVault: unsupported,
    async upload(projectId: string, file: File, signal?: AbortSignal): Promise<ApiSuccess<ResourceRecord<ReceivedDocument>>> {
      if (!file.size || file.size > 16 * 1024 * 1024) throw new Error("Choose a non-empty document up to 16 MiB")
      const response = await send(`/api/v1/projects/${encodeURIComponent(projectId)}/documents`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) }, body: file, signal })
      const value = await response.json()
      if (!response.ok) { const failure = value as ApiFailure; throw new ApiClientError(failure.error.code, failure.error.message, response.status, failure.error.requestId, failure.error.details) }
      return value
    },
    watch(projectId: string, onEvent: (event: ProjectEvent) => void, onState: (state: ConnectionState) => void, signal?: AbortSignal, after = 0) {
      const controller = new AbortController(), stop = () => controller.abort()
      let cursor = after
      signal?.addEventListener("abort", stop, { once: true }); if (signal?.aborted) stop()
      const run = async () => {
        while (!controller.signal.aborted) {
          try {
            onState("connecting")
            const response = await send(`/api/v1/projects/${encodeURIComponent(projectId)}/events/stream?after=${cursor}`, { signal: controller.signal, headers: { Accept: "text/event-stream" } })
            if (!response.ok || !response.body) {
              if ([401, 403, 404].includes(response.status)) { await response.body?.cancel(); onState("error"); return }
              throw new Error("Event connection failed")
            }
            onState("connected")
            const reader = response.body.getReader(), parser = createSseParser(), decoder = new TextDecoder()
            try {
              while (!controller.signal.aborted) {
                const chunk = await reader.read()
                if (chunk.done) break
                for (const frame of parser.feed(decoder.decode(chunk.value, { stream: true }))) {
                  const event = JSON.parse(frame.data) as ProjectEvent
                  if (event.projectId !== projectId || !Number.isSafeInteger(event.sequence) || event.sequence <= cursor) continue
                  onEvent(event); cursor = event.sequence
                }
              }
            } finally { await reader.cancel().catch(() => {}) }
            if (!controller.signal.aborted) throw new Error("Event connection closed")
          } catch {
            if (controller.signal.aborted) break
            onState("reconnecting"); await pause(controller.signal)
          }
        }
      }
      void run().catch(() => onState("error")).finally(() => { signal?.removeEventListener("abort", stop); if (controller.signal.aborted) onState("stopped") })
      return stop
    },
  }
}
