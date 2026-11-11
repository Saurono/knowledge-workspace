import { beforeEach, expect, it, vi } from "vitest"
import { createTaskProtocol } from "@/modules/tasks"
import { createIngestExecute, type IngestExecuteDeps } from "./ingest-execute"
import { createTaskPipeline } from "./task-pipeline"

const files = vi.hoisted(() => new Map<string, string>())
vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(async () => {}), fileExists: vi.fn(async () => true),
  writeFileAtomic: vi.fn(async (path: string, text: string) => { files.set(path, text) }),
  readFile: async (path: string) => files.get(path),
  listDirectory: async () => [...files.keys()].map(path => ({ name: path.split("/").pop(), path })),
}))
beforeEach(() => { files.clear(); vi.clearAllMocks() })
const at = "2026-11-11T00:00:00.000Z"
// Deliberately partial: injected fakes do not require the real projectId or model.
const payload = { projectPath: "C:/p", sourcePath: "a.md" }
const input = { kind: "ingest" as const, scopeId: "scope", executorId: "ingest" }
const task = () => createTaskProtocol({ ...input, id: "task", now: at, payload })
const fake = () => vi.fn<NonNullable<IngestExecuteDeps["ingest"]>>(async () => ["wiki/a.md"])

it("counts written paths and uses the injected completion time", async () => {
  const ingest = fake()
  expect(await createIngestExecute({ ingest, now: () => at })(task())).toEqual({
    ingest: { completedAt: at, accepted: 1, rejected: 0 },
  })
  expect(ingest.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
})

it("passes the payload object and task identity through", async () => {
  const ingest = fake()
  const current = task()
  await createIngestExecute({ ingest, now: () => at })(current)
  expect(ingest.mock.calls[0][0]).toBe(payload)
  expect(ingest.mock.calls[0][1]).toMatchObject({ id: current.id, scopeId: current.scopeId })
})

it("passes the supplied signal through unchanged", async () => {
  const ingest = fake()
  const mySignal = new AbortController().signal
  await createIngestExecute({ ingest, now: () => at })(task(), mySignal)
  expect(ingest.mock.calls[0][1].signal).toBe(mySignal)
})

it("rejects a task without a payload before calling ingest", async () => {
  const ingest = fake()
  const current = createTaskProtocol({ ...input, id: "empty", now: at })
  await expect(createIngestExecute({ ingest, now: () => at })(current)).rejects.toThrow("Ingest task requires a payload")
  expect(ingest).not.toHaveBeenCalled()
})

it("completes an enqueued ingest through the pipeline and journal", async () => {
  const p = createTaskPipeline({ root: "C:/p", now: () => at,
    execute: createIngestExecute({ ingest: fake(), now: () => at }),
  })
  try {
    const queued = await p.enqueue({ ...input, payload })
    await p.start()
    await vi.waitFor(async () => expect((await p.queue.get(queued.id))?.stage).toBe("done"))
    await vi.waitFor(() => expect(p.scheduler.running()).toEqual([]))
    expect((await p.queue.get(queued.id))?.result.ingest?.accepted).toBe(1)
    expect(JSON.parse(files.get(`C:/p/.llm-wiki/tasks/${queued.id}.json`)!)).toMatchObject({
      stage: "done", result: { ingest: { accepted: 1, rejected: 0, completedAt: at } },
    })
  } finally { p.dispose() }
})
