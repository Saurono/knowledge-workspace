import { expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteRepository } from "./repository"

it("isolates projects, returns stable shaped results and maintains the soft-delete index", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wiki-search-")), repository = new SqliteRepository(dir)
  const now = "2026-11-10T00:00:00Z"
  try {
    for (const id of ["A", "B"]) {
      await repository.createProject({ id, name: id, createdAt: now }, {})
      for (const page of ["one", "two"]) await repository.save(id, "wiki", `wiki/${id}/${page}.md`, {
        path: `wiki/${id}/${page}.md`, content: `---\ntitle: Shared ${id}\nsecret: hiddenmetadata\n---\nshared word${id} body`, authorship: { title: "ignored" },
      }, null, now)
    }
    const input = { projectId: "A", query: "shared" }
    await repository.save("A", "wiki", "wiki/chinese.md", { content: "向量数据库选型" }, null, now)
    expect(await repository.searchWiki({ ...input, query: " 向量数据库 " })).toHaveLength(1)
    for (const query of ["中", " 中文 ", "ab", "  "]) expect(await repository.searchWiki({ ...input, query })).toEqual([])
    for (const query of ['他"说', "foo-bar", "foo*bar", "NEAR("]) {
      await expect(repository.searchWiki({ ...input, query })).resolves.toEqual([])
    }
    const results = await repository.searchWiki(input)
    expect(results).toHaveLength(2)
    expect(await repository.searchWiki(input)).toEqual(results)
    for (const row of results) {
      expect(row.path).toMatch(/^wiki\/A\//)
      expect(row).toEqual({ path: expect.any(String), title: "Shared A", snippet: expect.any(String), titleMatch: true, score: expect.any(Number) })
    }
    expect(await repository.searchWiki({ projectId: "B", query: "wordB" })).toHaveLength(2)
    expect((await repository.searchWiki({ projectId: "B", query: "wordB" })).every(row => row.path.startsWith("wiki/B/"))).toBe(true)
    expect(await repository.searchWiki({ projectId: "B", query: "wordA" })).toEqual([])
    expect(await repository.searchWiki({ ...input, query: "hiddenmetadata" })).toEqual([])
    expect(await repository.searchWiki({ ...input, query: "  " })).toEqual([])
    expect(await repository.searchWiki({ ...input, domainFilter: ["wiki/A/one"] })).toHaveLength(1)
    expect(await repository.searchWiki({ ...input, limit: 0 })).toHaveLength(1)
    await repository.remove("A", "wiki", results[0].path, 1, now)
    expect(await repository.get("A", "wiki", results[0].path)).toBeNull()
    expect((await repository.searchWiki(input)).map(row => row.path)).toEqual([results[1].path])
    await repository.save("A", "wiki", results[1].path, { content: "replacement" }, 1, now)
    expect(await repository.searchWiki(input)).toEqual([])
  } finally { repository.close(); rmSync(dir, { recursive: true, force: true }) }
})
