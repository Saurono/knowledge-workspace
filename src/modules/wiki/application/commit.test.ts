import { describe, expect, it, vi } from "vitest"
import { createDeferred, flushMicrotasks } from "@/test-helpers/deferred"
import { createWikiCommitService, type WikiCommitContext, type WikiCommitStorage } from "./commit"
function fixture() {
  const calls: string[] = []
  const storage: WikiCommitStorage = {
    read: vi.fn(async () => "before"),
    exists: vi.fn(async () => false),
    write: vi.fn(async () => {}),
  }
  const service = createWikiCommitService({
    run: async (_project, operation) => {
      calls.push("acquire")
      try {
        return await operation(storage)
      } finally {
        calls.push("release")
      }
    },
  })
  return { service, storage, calls }
}
describe("Wiki commit lifetime", () => {
  it("uses one repository scope for multiple files and preserves generic Wiki outputs", async () => {
    const { service, storage, calls } = fixture()
    expect(
      await service.run("p", async (context) => {
        await context.write("wiki/a.md", "a")
        await context.write("wiki/data.json", "{}")
        return await context.read("wiki/a.md")
      }),
    ).toBe("before")
    expect(calls).toEqual(["acquire", "release"])
    expect(storage.write).toHaveBeenCalledWith("wiki/data.json", "{}")
  })
  it.each([false, true])(
    "rejects a retained writer after scope closure (callback failure=%s)",
    async (fail) => {
      const { service, storage } = fixture()
      let captured!: WikiCommitContext
      const result = service.run("p", async (context) => {
        captured = context
        if (fail) throw new Error("callback")
        return 1
      })
      if (fail) await expect(result).rejects.toThrow("callback")
      else await result
      await expect(captured.write("wiki/late.md", "late")).rejects.toThrow("closed")
      await expect(captured.read("wiki/late.md")).rejects.toThrow("closed")
      expect(storage.write).not.toHaveBeenCalled()
      expect(storage.read).not.toHaveBeenCalled()
    },
  )
  it.each(["complete", "callback failure", "I/O failure", "both fail"])(
    "retains its lock until started writes settle: %s",
    async (mode) => {
      const { service, storage, calls } = fixture()
      const write = createDeferred<void>()
      vi.mocked(storage.write).mockReturnValue(write.promise)
      const original = new Error("callback"),
        ioError = new Error("write")
      const result = service.run("p", async (context) => {
        void context.write("wiki/a.md", "a")
        if (mode === "callback failure" || mode === "both fail") throw original
        return 7
      })
      await flushMicrotasks()
      expect(calls).toEqual(["acquire"])
      if (mode === "I/O failure" || mode === "both fail") write.reject(ioError)
      else write.resolve()
      if (mode === "callback failure" || mode === "both fail")
        await expect(result).rejects.toBe(original)
      else if (mode === "I/O failure") await expect(result).rejects.toBe(ioError)
      else expect(await result).toBe(7)
      expect(calls).toEqual(["acquire", "release"])
    },
  )
  it("preserves deliberately handled I/O failures used by fallback pipelines", async () => {
    const { service, storage } = fixture()
    vi.mocked(storage.write).mockRejectedValueOnce(new Error("optional write failed"))
    expect(
      await service.run("p", async (context) => {
        try {
          await context.write("wiki/a.md", "a")
        } catch {
          /* old fallback semantics */
        }
        return "fallback"
      }),
    ).toBe("fallback")
  })
  it("rejects traversal and non-Wiki paths before storage", async () => {
    const { service, storage } = fixture()
    await service.run("p", async (context) => {
      for (const path of ["wiki/../outside.md", "raw/a.md", "/wiki/a.md", "wiki//a.md"])
        await expect(context.write(path, "x")).rejects.toThrow("inside wiki")
    })
    expect(storage.write).not.toHaveBeenCalled()
  })
})
