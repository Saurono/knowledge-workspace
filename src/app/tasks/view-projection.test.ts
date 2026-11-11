import { expect, it } from "vitest"
import { createTaskProtocol, type TaskProtocol } from "@/modules/tasks"
import { toActivityViews, toImportTaskViews } from "./view-projection"

const at = "2026-11-11T00:00:00Z"
const task = (patch: Partial<TaskProtocol> = {}): TaskProtocol => ({
  ...createTaskProtocol({ id: "a", kind: "other", scopeId: "s", executorId: "e", now: at }), ...patch,
})
const stages = ["queued", "running", "report", "ingest", "done", "failed", "cancelled"] as const
it("projects every import stage", () => {
  expect(stages.map(stage => toImportTaskViews([task({ stage })])[0].status)).toEqual(["pending", "processing", "processing", "processing", "done", "failed", "cancelled"])
})
it("projects every activity stage", () => {
  expect(stages.map(stage => toActivityViews([task({ stage })])[0].status)).toEqual(["running", "running", "running", "running", "done", "error", "cancelled"])
})
it("reads sourcePath with safe payload fallbacks", () => {
  for (const payload of [undefined, null, 1, "path", {}, { sourcePath: 2 }]) expect(toImportTaskViews([task({ payload })])[0].sourcePath).toBe("")
  expect(toImportTaskViews([task({ payload: { sourcePath: "a.md" } })])[0].sourcePath).toBe("a.md")
})
it("maps all task kinds", () => {
  expect((["ingest", "lint", "research", "export", "other"] as const).map(kind => toActivityViews([task({ kind })])[0].type)).toEqual(["ingest", "lint", "query", "query", "query"])
})
it("prefers string titles and otherwise supplies a fallback", () => {
  for (const title of ["Title", "", 2, undefined]) expect(toActivityViews([task({ payload: { title } })])[0].title).toBe(typeof title === "string" ? title : "other · a")
})
it("formats logs and leaves empty logs undefined", () => {
  expect(toActivityViews([task()])[0].log).toBeUndefined()
  expect(toActivityViews([task({ log: [{ at, level: "info", message: "hello" }] })])[0].log).toEqual([`${at} info: hello`])
})
it("sorts both views without modifying input", () => {
  const input = Object.freeze([task({ id: "b" }), task({ id: "a" }), task({ id: "old", createdAt: "2025-01-01" })])
  const before = structuredClone(input)
  for (const project of [toActivityViews, toImportTaskViews]) expect(project(input).map(t => t.id)).toEqual(["old", "a", "b"])
  expect(input).toEqual(before)
})
it("never infers written paths from ingest counts or source paths", () => {
  expect(toActivityViews([task({ payload: { sourcePath: "a.md" }, result: { report: null, ingest: { completedAt: at, accepted: 4, rejected: 2 } } })])[0].filesWritten).toEqual([])
})
it("projects times, errors, progress and parent identity", () => {
  const t = task({ createdAt: "invalid", parentId: "parent", progress: "working", error: { code: "bad", message: "oops", retriable: false } })
  expect(toImportTaskViews([t])[0]).toMatchObject({ addedAt: 0, error: "oops" })
  expect(toActivityViews([t])[0]).toMatchObject({ createdAt: 0, parentTaskId: "parent", taskId: "a", detail: "working" })
  expect(toImportTaskViews([task()])[0]).toMatchObject({ addedAt: Date.parse(at), error: null })
  expect(toActivityViews([task()])[0]).toMatchObject({ createdAt: Date.parse(at), parentTaskId: undefined, detail: "" })
})
