import { describe, expect, it, vi } from "vitest"
import { createWikiEditorSession } from "./editor-session"
import { WikiRevisionConflict } from "../domain/page"
const initial = { path: "wiki/a.md", content: "base", revision: "r0" }
describe("Wiki editor session", () => {
  it("orders saves against the last successful revision", async () => {
    const save = vi.fn(async ({ content }: { content: string }) => ({ ...initial, content, revision: content }))
    const editor = createWikiEditorSession(Promise.resolve(initial), { save })
    await Promise.all([editor.save("one"), editor.save("two")])
    expect(save.mock.calls).toEqual([[{ content: "one", expectedRevision: "r0" }], [{ content: "two", expectedRevision: "one" }]])
  })
  it("stops queued and later saves after a conflict without accepting a new base", async () => {
    const conflict = new WikiRevisionConflict(initial.path, "r0", "external")
    const save = vi.fn().mockRejectedValue(conflict)
    const editor = createWikiEditorSession(Promise.resolve(initial), { save })
    const results = await Promise.allSettled([editor.save("one"), editor.save("two")])
    expect(results.every(result => result.status === "rejected")).toBe(true)
    await expect(editor.save("three")).rejects.toBe(conflict)
    expect(save).toHaveBeenCalledTimes(1)
  })
  it("retries an I/O failure against the same baseline", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue({ ...initial, content: "draft", revision: "r1" })
    const editor = createWikiEditorSession(Promise.resolve(initial), { save })
    await expect(editor.save("draft")).rejects.toThrow("disk full")
    await editor.save("draft")
    expect(save.mock.calls[1][0].expectedRevision).toBe("r0")
  })
  it("closes queued writes while allowing already-started storage to finish", async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const save = vi.fn(async () => { await gate; return { ...initial, content: "one", revision: "r1" } })
    const editor = createWikiEditorSession(Promise.resolve(initial), { save })
    const first = editor.save("one")
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
    const queued = editor.save("two")
    editor.close()
    release()
    await first
    await expect(queued).rejects.toThrow("closed")
    expect(save).toHaveBeenCalledOnce()
  })
})
