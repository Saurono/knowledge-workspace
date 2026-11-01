import type { ServerResponse } from "node:http"
import type { ProjectEvent } from "@/modules/service-api/domain"
/** Durable sequence replay with polling; notifications never replace the database event log. */
export function streamProjectEvents(response: ServerResponse, after: number, read: (after: number) => Promise<ProjectEvent[]>, onClose: () => void) {
  let lastPing = Date.now()
  let cursor = after, closed = false, timer: ReturnType<typeof setTimeout> | undefined
  const close = () => { if (closed) return; closed = true; if (timer) clearTimeout(timer); onClose(); response.end() }
  response.on("close", close)
  response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" })
  response.write("retry: 1000\n\n")
  const pump = async () => {
    if (closed) return
    try {
      const events = await read(cursor)
      for (const event of events) {
        if (closed) return
        if (!response.write(`id: ${event.sequence}\nevent: resource\ndata: ${JSON.stringify(event)}\n\n`)) {
          await new Promise<void>(resolve => { const finish = () => { response.off("drain", finish); response.off("close", finish); resolve() }; response.once("drain", finish); response.once("close", finish) })
        }
        cursor = event.sequence
      }
      if (!events.length && Date.now() - lastPing >= 15_000) { response.write(": keepalive\n\n"); lastPing = Date.now() }
      if (!closed) { timer = setTimeout(() => void pump(), events.length === 200 ? 0 : 500); timer.unref() }
    } catch { close() }
  }
  void pump()
  return close
}
