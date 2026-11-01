import { localResourcePath, CapabilityError } from "../domain"
import type { LocalProject, LocalFileEvent, ShellResult } from "../domain"
export interface NativePlatformPorts {
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
  listen(handler: (event: LocalFileEvent) => void): Promise<() => void>
  startWatch(project: LocalProject): Promise<unknown>
  stopWatch(project: LocalProject): Promise<void>
  shell(project: LocalProject, input: { command: string; approved: boolean; timeoutSeconds?: number }): Promise<ShellResult>
  configureVault(projectPath: string, vaultPath: string | null): Promise<void>
  deliverReceipt(projectPath: string, id: string): Promise<void>
}
export function createLocalPlatform(project: LocalProject, ports: NativePlatformPorts) {
  const captured = Object.freeze({ ...project })
  return {
    read: (relative: string) => ports.read(localResourcePath(captured.path, relative)),
    write: (relative: string, content: string) => ports.write(localResourcePath(captured.path, relative), content),
    async watch(handler: (event: LocalFileEvent) => void, signal?: AbortSignal) {
      if (signal?.aborted) throw new DOMException("Watcher cancelled", "AbortError")
      let stopped = false, started = false
      let unlisten: (() => void) | undefined
      const stop = () => { if (stopped) return; stopped = true; unlisten?.(); if (started) void ports.stopWatch(captured).catch(() => {}); signal?.removeEventListener("abort", stop) }
      signal?.addEventListener("abort", stop, { once: true })
      try {
        unlisten = await ports.listen(event => { if (!stopped && event.projectId === captured.id) handler(event) })
        if (stopped) { unlisten(); return stop }
        started = true
        await ports.startWatch(captured)
        if (stopped) await ports.stopWatch(captured)
        return stop
      } catch (error) { stop(); throw error }
    },
    shell: (input: { command: string; approved: boolean; timeoutSeconds?: number }) => {
      if (!input.approved) return Promise.reject(new CapabilityError("confirmation_required", "Shell execution requires explicit approval"))
      return ports.shell(captured, { ...input })
    },
    configureVault: (path: string | null) => ports.configureVault(captured.path, path),
    deliverReceipt: (id: string) => ports.deliverReceipt(captured.path, id),
  }
}
