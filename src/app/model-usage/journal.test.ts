import { expect, it, vi } from "vitest"
import { createProjectUsageJournal } from "./journal"
import type { UsageRecord } from "@/modules/model-gateway"
const files = vi.hoisted(() => new Map<string, string>())
vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}), fileExists: async () => true,
  writeFileAtomic: async (path: string, text: string) => { files.set(path, text) },
  readFile: async (path: string) => files.get(path),
  listDirectory: async () => [...files.keys()].map(path => ({ name: path.split("/").pop(), path })),
}))
it("writes the project path, reads back and skips bad JSON", async () => {
  const journal = createProjectUsageJournal("C:/project")
  const record = { id: "usage-1", projectId: "C:/project" } as UsageRecord
  await journal.append(record)
  expect(files.has("C:/project/.llm-wiki/model-usage/usage-1.json")).toBe(true)
  expect(await journal.all()).toEqual([record])
  files.set("C:/project/.llm-wiki/model-usage/bad.json", "{")
  const error = vi.spyOn(console, "error").mockImplementation(() => {})
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  expect(await journal.all()).toEqual([record])
  expect(warn).toHaveBeenCalledWith("Skipped 1 usage journal files")
  error.mockRestore(); warn.mockRestore()
})
