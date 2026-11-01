export interface LocalProject { id: string; path: string }
export interface LocalFileEvent { projectId: string; tasks: Array<{ id: string; path: string; kind: string; status: string }> }
export interface ShellResult { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }
export class CapabilityError extends Error {
  constructor(public readonly code: "unsupported" | "confirmation_required" | "invalid_path", message: string) { super(message); this.name = "CapabilityError" }
}
export function localResourcePath(root: string, relative: string) {
  const normalized = relative.replace(/\\/g, "/")
  if (!normalized || normalized.includes(":") || normalized.includes("\0") || normalized.split("/").some(part => !part || part === "." || part === "..")) throw new CapabilityError("invalid_path", "Expected a project-relative resource path")
  const project = root.replace(/\\/g, "/").replace(/\/+$/, "")
  if (!project || project.includes("\0")) throw new CapabilityError("invalid_path", "Project directory is required")
  return `${project}/${normalized}`
}
export interface SseFrame { id: string; event: string; data: string }
/** Handles arbitrary network chunk boundaries; incomplete trailing data stays buffered. */
export function createSseParser() {
  let pending = ""
  return {
    feed(chunk: string): SseFrame[] {
      pending += chunk
      if (pending.length > 1024 * 1024) throw new Error("Event frame exceeds limit")
      const frames: SseFrame[] = []
      let match: RegExpMatchArray | null
      while ((match = pending.match(/\r?\n\r?\n/))) {
        const boundary = match.index!, block = pending.slice(0, boundary)
        pending = pending.slice(boundary + match[0].length)
        const frame = { id: "", event: "message", data: "" }, data: string[] = []
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith(":")) continue
          const colon = line.indexOf(":"), field = colon < 0 ? line : line.slice(0, colon)
          const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "")
          if (field === "id") frame.id = value
          if (field === "event") frame.event = value
          if (field === "data") data.push(value)
        }
        if (data.length) { frame.data = data.join("\n"); frames.push(frame) }
      }
      return frames
    },
  }
}
