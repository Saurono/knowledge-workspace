import { beforeEach, describe, expect, it, vi } from "vitest"
import { createDeferred, flushMicrotasks } from "@/test-helpers/deferred"
const native = vi.hoisted(() => ({ list: vi.fn(), restore: vi.fn() }))
vi.mock("@/commands/fs", () => ({
  listFileHistory: native.list,
  restoreFileHistory: native.restore,
}))
import { readProjectFileHistory, restoreProjectFileHistory } from "./history"
import { withProjectLock } from "@/lib/project-mutex"
beforeEach(() => {
  vi.resetAllMocks()
  native.list.mockResolvedValue([])
  native.restore.mockResolvedValue("restored")
})
describe("project file history transport", () => {
  it("maps Wiki and raw file paths to the existing native history API", async () => {
    await readProjectFileHistory("C:\\p", "C:/p/wiki/a.md")
    expect(native.list).toHaveBeenCalledWith("C:\\p", "C:/p/wiki/a.md")
    expect(await restoreProjectFileHistory("/p", "/p/raw/a.txt", "version")).toBe("restored")
    expect(native.restore).toHaveBeenCalledWith("/p", "/p/raw/a.txt", "version")
  })
  it("serializes restore with other Wiki/project commits", async () => {
    const gate = createDeferred<void>()
    const holding = withProjectLock("/p", () => gate.promise)
    const restore = restoreProjectFileHistory("/p", "/p/wiki/a.md", "version")
    await flushMicrotasks()
    expect(native.restore).not.toHaveBeenCalled()
    gate.resolve()
    await holding
    expect(await restore).toBe("restored")
  })
  it("releases the commit lock after a restore failure", async () => {
    native.restore.mockRejectedValueOnce(new Error("unavailable"))
    await expect(restoreProjectFileHistory("/p", "/p/wiki/a.md", "version")).rejects.toThrow(
      "unavailable",
    )
    await expect(restoreProjectFileHistory("/p", "/p/wiki/a.md", "version")).resolves.toBe(
      "restored",
    )
  })
  it.each(["/other/a.md", "/p/wiki/../outside.md", "/p//a.md"])(
    "rejects out-of-scope or ambiguous path %s before native I/O",
    (path) => {
      expect(() => readProjectFileHistory("/p", path)).toThrow()
      expect(native.list).not.toHaveBeenCalled()
    },
  )
})
