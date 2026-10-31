import { expect, it, vi } from "vitest"
import { createReviewFiles } from "./review-files"
it("resolves page suffixes without treating viewing as resolution", async () => {
  const read = vi.fn(async path => { if (!path.endsWith(".md")) throw new Error("missing"); return "body" })
  const service = createReviewFiles({ read, remove: vi.fn() })
  expect(await service.open("/p", "concepts/a")).toEqual({ path: "/p/wiki/concepts/a.md", content: "body" })
})
it("rejects traversal and external deletion before file operations", async () => {
  const read = vi.fn(), remove = vi.fn(), service = createReviewFiles({ read, remove })
  expect(() => service.remove("/p", "/other/a.md")).toThrow("outside")
  expect(() => service.remove("/p", "/p/wiki/../a.md")).toThrow("Invalid")
  await expect(service.open("/p", "../../outside")).rejects.toThrow("Invalid")
  expect(read).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled()
})
