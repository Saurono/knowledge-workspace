import { expect, it, vi } from "vitest"
import { createQualityRepairs, type RepairPorts } from "./repairs"
import type { QualityItem } from "../domain"
const item = (id: string, page: string): QualityItem => ({ id, page, type: "no-outlinks", severity: "info", detail: "", createdAt: 0, suggestedTarget: id })
function ports(): RepairPorts {
  return { isCurrent: () => true, transform: vi.fn(async () => ({ changed: true })), stub: vi.fn(), review: vi.fn(), remove: vi.fn(), changed: vi.fn() }
}
it("writes one transform per page, acknowledges successful pages before a later failure", async () => {
  const input = ports()
  vi.mocked(input.transform).mockImplementation(async (path, change) => {
    if (path === "bad.md") throw new Error("disk full")
    expect(change("# Page")).toContain("[[one]]")
    expect(change("# Page")).toContain("[[two]]")
    return { changed: true }
  })
  await expect(createQualityRepairs(input).repair([item("one", "ok.md"), item("two", "ok.md"), item("three", "bad.md")])).rejects.toThrow("disk full")
  expect(input.transform).toHaveBeenCalledTimes(2)
  expect(input.remove).toHaveBeenCalledExactlyOnceWith(["one", "two"])
  expect(input.changed).toHaveBeenCalledOnce()
})
it("does not remove findings in another project if scope changes during a write", async () => {
  const input = ports()
  let current = true
  input.isCurrent = () => current
  vi.mocked(input.transform).mockImplementation(async () => { current = false; return { changed: true } })
  await expect(createQualityRepairs(input).repair([item("one", "ok.md")])).rejects.toMatchObject({ name: "AbortError" })
  expect(input.changed).toHaveBeenCalledOnce()
  expect(input.remove).not.toHaveBeenCalled()
})
