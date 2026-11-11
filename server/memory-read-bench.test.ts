import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { createMemoryRecord } from "@/modules/memory/domain/model"
import { SqliteRepository } from "./repository"

const at = "2026-11-10T00:00:00.000Z"
const body = "记忆基线测量用于验证项目规模以及并发写入行为。".repeat(20).slice(0, 300)
const emit = (value: object) => console.log(`BENCH ${JSON.stringify(value)}`)
const percentile = (sorted: number[], p: number) => sorted[Math.ceil(sorted.length * p) - 1]
const stats = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b)
  return { p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95) }
}

describe.skipIf(!process.env.KW_BENCH)("memory read baseline (repository, no HTTP)", () => {
  it.each([100, 500, 1000])("measures %i memories", async count => {
    const directory = mkdtempSync(join(tmpdir(), "kw-memory-read-"))
    const repository = new SqliteRepository(directory)
    let reader: DatabaseSync | undefined
    try {
      const memories = Array.from({ length: count }, (_, index) => {
        const memory = createMemoryRecord({ id: `memory-${index}`, title: `Memory ${index}`, content: body,
          category: "fact", domainIds: [], relatedIds: [], createdAt: at, updatedAt: at })
        return { ...memory, version: 5, revisions: Array.from({ length: 5 }, (_, revision) => ({
          version: revision + 1, title: memory.title, content: body, at, source: memory.source,
        })) }
      })
      await repository.createProject({ id: "bench", name: "Bench", createdAt: at },
        { version: 1, domains: [], resourceDomains: {}, memories })
      reader = new DatabaseSync(join(directory, "service.sqlite"), { readOnly: true })
      const columns = (reader.prepare("PRAGMA table_info(memories)").all() as { name: string }[]).map(row => row.name)
      const projection = ["id", "title", "status", "version", "updated_at", "importance"].filter(column => columns.includes(column))
      const statement = reader.prepare(`SELECT ${projection.join(",")} FROM memories WHERE project_id=? ORDER BY updated_at DESC, id LIMIT 200`)
      const journal = (reader.prepare("PRAGMA journal_mode").get() as { journal_mode?: string } | undefined)?.journal_mode ?? "unknown"
      emit({ metric: "conditions", count, node: process.version, platform: process.platform,
        journal, bodyCharacters: body.length,
        revisionsPerMemory: 5, projection, warmup: 2 })
      const reads = {
        A: () => repository.get("bench", "workspace", "default"),
        B: () => repository.memoryRows("bench"),
        C: async () => statement.all("bench"),
      }
      for (const [metric, read] of Object.entries(reads)) {
        const samples: number[] = [], bytes: number[] = []
        for (let iteration = 0; iteration < 32; iteration++) {
          const started = performance.now()
          const result = await read()
          const elapsed = performance.now() - started
          expect(result).toBeTruthy()
          if (iteration >= 2) {
            samples.push(elapsed)
            bytes.push(Buffer.byteLength(JSON.stringify(result), "utf8"))
          }
        }
        emit({ metric, count, samples: samples.length, ...stats(samples), averageBytes: bytes.reduce((a, b) => a + b, 0) / bytes.length })
      }
      for (const metric of ["A", "C"] as const) {
        let successes = 0
        const samples: number[] = []
        for (let round = 0; round < 20; round++) {
          const results = await Promise.allSettled(Array.from({ length: 8 }, async () => {
            const started = performance.now()
            await reads[metric]()
            samples.push(performance.now() - started)
          }))
          successes += results.filter(result => result.status === "fulfilled").length
        }
        expect(successes).toBe(160)
        emit({ metric: `D_${metric}`, count, rounds: 20, readers: 8, successes, ...stats(samples) })
      }
    } finally {
      reader?.close()
      repository.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }, 120_000)
})
