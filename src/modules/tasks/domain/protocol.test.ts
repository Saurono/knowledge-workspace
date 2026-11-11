import { describe, expect, it } from "vitest"
import {
  TASK_STAGES, appendTaskLog, createTaskProtocol, failTask, isTerminalStage,
  recordTaskResult, taskTransition, type TaskKind, type TaskStage,
} from "../index"

const t0 = "2026-11-10T00:00:00Z"
const t1 = "2026-11-10T00:01:00Z"
const t2 = "2026-11-10T00:02:00Z"
const create = (kind: TaskKind = "other") => createTaskProtocol({
  id: "task-1", kind, scopeId: "scope-1", executorId: "executor-1", now: t0,
})
const report = { ref: null, completedAt: t1 }
const ingest = { completedAt: t2, accepted: 3, rejected: 1 }

it("preserves optional payload through state, log, result and failure updates without logging it", () => {
  const payload = { sourcePath: "private-source.md", nested: { token: "private-token" } }
  const original = structuredClone(payload)
  expect(create().payload).toBeUndefined()
  const queued = createTaskProtocol({ ...create(), now: t0, payload })
  const running = taskTransition(queued, "running", t1)
  const logged = appendTaskLog(running, { at: t1, level: "info", message: "started" })
  const reported = recordTaskResult(logged, { report })
  const failed = failTask(reported, { code: "ERR", message: "failed", retriable: true }, t2)
  for (const task of [queued, running, logged, reported, failed]) {
    expect(task.payload).toBe(payload)
    expect(JSON.stringify(task.log)).not.toContain(payload.sourcePath)
    expect(JSON.stringify(task.log)).not.toContain(payload.nested.token)
  }
  expect(payload).toEqual(original)
  expect(failed.log).toEqual([{ at: t1, level: "info", message: "started" }])
})

describe("task protocol creation and time", () => {
  it("sets all defaults and preserves explicit parent and identity", () => {
    expect(create()).toEqual({
      id: "task-1", kind: "other", stage: "queued", parentId: null,
      scopeId: "scope-1", executorId: "executor-1", createdAt: t0, updatedAt: t0,
      startedAt: null, finishedAt: null, progress: "", log: [],
      result: { report: null, ingest: null }, error: null,
    })
    expect(createTaskProtocol({ ...create(), now: t0, parentId: "parent" }).parentId).toBe("parent")
  })
  it("rejects empty IDs and unparseable input times", () => {
    expect(() => createTaskProtocol({ ...create(), id: "", now: t0 })).toThrow()
    expect(() => createTaskProtocol({ ...create(), now: "invalid" })).toThrow()
    expect(() => taskTransition(create(), "running", "invalid")).toThrow()
    expect(() => failTask(taskTransition(create(), "running", t1), {
      code: "ERR", message: "error", retriable: false,
    }, "invalid")).toThrow()
  })
})

describe("task protocol transitions", () => {
  it("runs queued → running → report → ingest → done with write-once times", () => {
    const queued = create()
    const running = taskTransition(queued, "running", t1)
    expect(running.startedAt).toBe(t1)
    expect(running.finishedAt).toBeNull()
    const reporting = taskTransition(running, "report", t2)
    const ingesting = taskTransition(reporting, "ingest", t2)
    const done = taskTransition(ingesting, "done", t2)
    expect(done.startedAt).toBe(t1)
    expect(done.finishedAt).toBe(t2)
    expect(taskTransition(done, "done", t1).finishedAt).toBe(t2)
    expect(queued.stage).toBe("queued")
    expect(taskTransition({ ...queued, startedAt: t0, finishedAt: t0 }, "running", t1))
      .toMatchObject({ startedAt: t0, finishedAt: t0, updatedAt: t1 })
  })
  // Exhaustive matrix includes queued → done, done/cancelled → running,
  // terminal self-transitions and forbidden nonterminal self-transitions.
  const allowed: Record<TaskStage, TaskStage[]> = {
    queued: ["running", "cancelled"],
    running: ["report", "ingest", "done", "failed", "cancelled"],
    report: ["ingest", "done", "failed", "cancelled"],
    ingest: ["done", "failed", "cancelled"],
    done: ["done"], failed: ["failed"], cancelled: ["cancelled"],
  }
  for (const from of TASK_STAGES) for (const to of TASK_STAGES) {
    it(`${from} → ${to}: ${allowed[from].includes(to) ? "allowed" : "rejected"}`, () => {
      const task = { ...create(), stage: from }
      if (allowed[from].includes(to)) {
        const next = taskTransition(task, to, t1)
        expect(next.stage).toBe(to)
        expect(next.finishedAt).toBe(isTerminalStage(to) ? t1 : null)
      } else expect(() => taskTransition(task, to, t1))
        .toThrow(`Invalid task transition: ${from} -> ${to}`)
    })
  }
})

describe("task protocol logs", () => {
  it("appends monotonically, permits equal instants, and keeps updatedAt", () => {
    const original = create()
    const first = appendTaskLog(original, { at: t1, level: "info", message: "start" })
    const equal = appendTaskLog(first, {
      at: "2026-11-10T08:01:00+08:00", level: "warn", message: "same instant",
    })
    const later = appendTaskLog(equal, { at: t2, level: "error", message: "later" })
    expect(later.log).toHaveLength(3)
    expect(later.updatedAt).toBe(t0)
    expect(original.log).toEqual([])
    expect(() => appendTaskLog(later, { at: t1, level: "info", message: "old" })).toThrow()
    expect(() => appendTaskLog(original, { at: "invalid", level: "info", message: "bad" })).toThrow()
  })
})

describe("task protocol results and errors", () => {
  it("merges only supplied halves and refuses clearing a completed report", () => {
    const original = create()
    const reported = recordTaskResult(original, { report })
    const both = recordTaskResult(reported, { ingest })
    expect(both.result).toEqual({ report, ingest })
    expect(recordTaskResult(both, {}).result).toEqual(both.result)
    expect(recordTaskResult(both, { ingest: null }).result).toEqual({ report, ingest: null })
    expect(recordTaskResult(original, { report: null }).result.report).toBeNull()
    expect(() => recordTaskResult(both, { report: null })).toThrow()
    expect(original.result).toEqual({ report: null, ingest: null })
  })
  it.each(["research", "ingest"] as const)("requires the matching result for %s", (kind) => {
    const running = taskTransition(create(kind), "running", t1)
    expect(() => taskTransition(running, "done", t2))
      .toThrow(`Task result is incomplete for kind ${kind}`)
    const wrong = recordTaskResult(running, kind === "research" ? { ingest } : { report })
    expect(() => taskTransition(wrong, "done", t2)).toThrow()
    const complete = recordTaskResult(running, kind === "research" ? { report } : { ingest })
    expect(taskTransition(complete, "done", t2).stage).toBe("done")
  })
  it("keeps report completion separate from ingest completion", () => {
    const reporting = taskTransition(taskTransition(create("research"), "running", t1), "report", t2)
    const completedReport = recordTaskResult(reporting, { report })
    expect(completedReport.stage).toBe("report")
    expect(completedReport.result).toEqual({ report, ingest: null })
    expect(isTerminalStage("report")).toBe(false)
    expect(completedReport.finishedAt).toBeNull()
    expect(taskTransition(completedReport, "done", t2).result.ingest).toBeNull()
  })
  it("records structured failure through the same transition rules", () => {
    const running = taskTransition(create(), "running", t1)
    const error = { code: "IO_ERROR", message: "unavailable", retriable: true }
    expect(failTask(running, error, t2)).toMatchObject({
      stage: "failed", error, startedAt: t1, finishedAt: t2, updatedAt: t2,
    })
    expect(running.error).toBeNull()
    expect(() => failTask(create(), error, t2)).toThrow("Invalid task transition: queued -> failed")
  })
})
