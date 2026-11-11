import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createDirectory, writeFileAtomic } from "@/commands/fs"
import { createTaskProtocol } from "@/modules/tasks"
import { createProjectTaskJournal } from "./task-journal"

const files = vi.hoisted(() => new Map<string, string>())
vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}), fileExists: vi.fn(async () => true),
  writeFileAtomic: vi.fn(async (path: string, text: string) => { files.set(path, text) }),
  readFile: async (path: string) => files.get(path),
  listDirectory: async () => [...files.keys()].map(path => ({ name: path.split("/").pop(), path })),
}))
beforeEach(() => { files.clear(); vi.clearAllMocks() })
afterEach(() => { vi.restoreAllMocks() })
const record = createTaskProtocol({ id: "task-1", kind: "research", scopeId: "scope",
  executorId: "executor", now: "2026-11-10T00:00:00.000Z" })
const target = "C:/project/.llm-wiki/tasks/task-1.json"

it("saves one atomic JSON file in the project task directory", async () => {
  await createProjectTaskJournal("C:/project").save(record)
  expect(createDirectory).toHaveBeenCalledWith("C:/project/.llm-wiki/tasks")
  expect(writeFileAtomic).toHaveBeenCalledWith(target, JSON.stringify(record))
  expect(files.get(target)).toBe(JSON.stringify(record))
})
it("loads unchanged records and ignores non-JSON files", async () => {
  files.set(target, JSON.stringify(record))
  files.set("C:/project/.llm-wiki/tasks/notes.txt", "not JSON")
  expect(await createProjectTaskJournal("C:/project").load()).toEqual([record])
})
it.each(["{", '{"id":"x"}'])("skips invalid record %s and warns without losing valid records", async invalid => {
  files.set(target, JSON.stringify(record))
  files.set("C:/project/.llm-wiki/tasks/bad.json", invalid)
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  expect(await createProjectTaskJournal("C:/project").load()).toEqual([record])
  expect(warn).toHaveBeenCalledWith("Skipped 1 task journal files")
})
