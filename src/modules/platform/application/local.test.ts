import { expect, it, vi } from "vitest"
import { createLocalPlatform, type NativePlatformPorts } from "./local"
import type { LocalFileEvent } from "../domain"
import { createSseParser } from "../domain"
it("captures the project and filters watchers while blocking unapproved Shell and path escapes", async () => {
  let handler!: (event: LocalFileEvent) => void
  const unlisten = vi.fn(), stopWatch = vi.fn(async () => {})
  const ports: NativePlatformPorts = { read: vi.fn(async () => "body"), write: vi.fn(async () => {}), listen: async next => { handler = next; return unlisten }, startWatch: vi.fn(async () => {}), stopWatch, shell: vi.fn(async () => ({ stdout: "ok", stderr: "", exitCode: 0, timedOut: false })), configureVault: vi.fn(), deliverReceipt: vi.fn() }
  const project = { id: "first", path: "/first" }, platform = createLocalPlatform(project, ports)
  project.path = "/other"
  await platform.read("wiki/a.md"); expect(ports.read).toHaveBeenCalledWith("/first/wiki/a.md")
  expect(() => platform.read("../outside.md")).toThrow("project-relative")
  await expect(platform.shell({ command: "echo fixture", approved: false })).rejects.toMatchObject({ code: "confirmation_required" })
  expect(ports.shell).not.toHaveBeenCalled()
  const changed = vi.fn(), owner = new AbortController(); await platform.watch(changed, owner.signal)
  handler({ projectId: "other", tasks: [] }); handler({ projectId: "first", tasks: [] }); owner.abort(); handler({ projectId: "first", tasks: [] })
  expect(changed).toHaveBeenCalledOnce(); expect(unlisten).toHaveBeenCalledOnce(); expect(stopWatch).toHaveBeenCalledOnce()
})
it("parses CRLF and arbitrarily split multiline SSE frames without treating keepalive as data", () => {
  const parser = createSseParser()
  expect(parser.feed(": keepalive\r\n\r\nid: 2\r\nevent: resource\r\nda")).toEqual([])
  expect(parser.feed("ta: first\r\ndata: second\r\n\r")).toEqual([])
  expect(parser.feed("\n")).toEqual([{ id: "2", event: "resource", data: "first\nsecond" }])
})
