import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { describe, expect, it } from "vitest"
import { createMemoryRecord } from "@/modules/memory/domain/model"
import { SqliteRepository } from "./repository"

const at = "2026-11-10T00:00:00.000Z"
const body = "记忆基线测量用于验证项目规模以及并发写入行为。".repeat(20).slice(0, 300)
const makeWorkspace = (count: number) => ({
  version: 1, domains: [], resourceDomains: {},
  memories: Array.from({ length: count }, (_, index) => {
    const memory = createMemoryRecord({ id: `memory-${index}`, title: `Memory ${index}`, content: body,
      category: "fact", domainIds: [], relatedIds: [], createdAt: at, updatedAt: at })
    return { ...memory, version: 5, revisions: Array.from({ length: 5 }, (_, index) => ({
      version: index + 1, title: memory.title, content: body, at, source: memory.source,
    })) }
  }),
})
type Workspace = ReturnType<typeof makeWorkspace>
function edited(workspace: Workspace, index: number, marker: number) {
  const next = structuredClone(workspace), memory = next.memories[index]
  memory.content = body.slice(0, 294) + String(marker).padStart(6, "0")
  memory.version++
  memory.revisions = [...memory.revisions.slice(1), { version: memory.version, title: memory.title,
    content: memory.content, at, source: memory.source }]
  return next
}
const emit = (value: object) => console.log(`BENCH ${JSON.stringify(value)}`)
const percentile = (sorted: number[], p: number) => sorted[Math.ceil(sorted.length * p) - 1]

describe.skipIf(!process.env.KW_BENCH)("memory scale baseline (repository, no HTTP)", () => {
  it.each([100, 500, 1000])("measures %i memories", async count => {
    const directory = mkdtempSync(join(tmpdir(), "kw-memory-scale-"))
    const repository = new SqliteRepository(directory)
    try {
      emit({ metric: "conditions", count, node: process.version, platform: process.platform,
        directory, database: "service.sqlite", journal: "WAL", ftsRebuildIncluded: true,
        bodyCharacters: body.length, revisionsPerMemory: 5 })
      let workspace = makeWorkspace(count)
      await repository.createProject({ id: "bench", name: "Bench", createdAt: at }, workspace)
      let revision = (await repository.get("bench", "workspace", "default"))!.revision
      const serialized = JSON.stringify(workspace)
      emit({ metric: "serialization", count, bytes: Buffer.byteLength(serialized, "utf8") })
      const samples: number[] = []
      for (let iteration = 0; iteration < 22; iteration++) {
        // Build the edit outside timing; save includes stringify, SQLite commit, events and FTS rebuild.
        workspace = edited(workspace, 0, iteration)
        const started = performance.now()
        const saved = await repository.save("bench", "workspace", "default", workspace, revision, at)
        const elapsed = performance.now() - started
        revision = saved.revision
        expect((await repository.verifyMemoryMirror("bench")).ok).toBe(true)
        if (iteration >= 2) samples.push(elapsed)
      }
      const sorted = [...samples].sort((a, b) => a - b)
      emit({ metric: "write", count, warmup: 2, samplesMs: samples,
        p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95) })

      for (const differentMemories of [false, true]) {
        let successes = 0, conflicts = 0, revisionAdvances = 0
        for (let round = 0; round < 10; round++) {
          const snapshot = (await repository.get("bench", "workspace", "default"))!
          const data = snapshot.data as Workspace
          // All contenders see the same pre-write snapshot. Distinct memories each retain
          // their current correct memory version, but save accepts only a workspace CAS.
          const writes = Array.from({ length: 4 }, (_, writer) =>
            edited(data, differentMemories ? writer : 0, 100 + round * 4 + writer))
          const results = await Promise.allSettled(writes.map(next =>
            repository.save("bench", "workspace", "default", next, snapshot.revision, at)))
          expect((await repository.verifyMemoryMirror("bench")).ok).toBe(true)
          for (const result of results) {
            if (result.status === "fulfilled") successes++
            else {
              const code = (result.reason as { code?: string }).code ?? ""
              if (!/conflict|precondition/.test(code)) throw result.reason
              conflicts++
            }
          }
          revisionAdvances += (await repository.get("bench", "workspace", "default"))!.revision - snapshot.revision
        }
        expect(successes + conflicts).toBe(40)
        expect(revisionAdvances).toBe(successes)
        emit({ metric: differentMemories ? "different_memories" : "same_workspace_cas", count,
          rounds: 10, writers: 4, successes, conflicts, successRate: successes / 40,
          conflictRate: conflicts / 40, revisionAdvances })
      }

      const atomicSamples: number[] = []
      for (let iteration = 0; iteration < 22; iteration++) {
        const data = (await repository.get("bench", "workspace", "default"))!.data as Workspace
        const next = edited(data, 0, 200 + iteration).memories[0]
        const started = performance.now()
        await repository.saveMemoryAtomic("bench", next, { memoryVersion: data.memories[0].version }, at)
        const elapsed = performance.now() - started
        expect((await repository.verifyMemoryMirror("bench")).ok).toBe(true)
        if (iteration >= 2) atomicSamples.push(elapsed)
      }
      const atomicSorted = [...atomicSamples].sort((a, b) => a - b)
      emit({ metric: "atomic_write", count,
        p50Ms: percentile(atomicSorted, 0.5), p95Ms: percentile(atomicSorted, 0.95) })

      for (const differentMemories of [true, false]) {
        let successes = 0, conflicts = 0
        for (let round = 0; round < 10; round++) {
          const data = (await repository.get("bench", "workspace", "default"))!.data as Workspace
          const writes = Array.from({ length: 4 }, (_, writer) => {
            const index = differentMemories ? writer : 0
            return { next: edited(data, index, 300 + round * 4 + writer).memories[index],
              expected: { memoryVersion: data.memories[index].version } }
          })
          const results = await Promise.allSettled(writes.map(({ next, expected }) =>
            repository.saveMemoryAtomic("bench", next, expected, at)))
          expect((await repository.verifyMemoryMirror("bench")).ok).toBe(true)
          let roundSuccesses = 0
          for (const result of results) {
            if (result.status === "fulfilled") { successes++; roundSuccesses++ }
            else {
              const reason = result.reason as { code?: string; message?: string }
              if (!/conflict|precondition/.test(reason.code ?? reason.message ?? "")) throw result.reason
              conflicts++
            }
          }
          expect(roundSuccesses).toBe(differentMemories ? 4 : 1)
        }
        expect(successes + conflicts).toBe(40)
        emit({ metric: differentMemories ? "atomic_concurrent_different" : "atomic_concurrent_same",
          count, rounds: 10, writers: 4, successes, conflicts,
          ...(differentMemories ? { successRate: successes / 40 } : {}) })
      }
    } finally {
      repository.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }, 120_000)
})
