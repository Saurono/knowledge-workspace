import { expect, it } from "vitest"
import { isWikiProvenance, moveWikiProvenance, preserveWikiCreatedFrontmatter, recordWikiProvenance, recordWikiWrite } from "./provenance"
it("preserves unknown source creation time when moving into a known destination", () => {
  expect(moveWikiProvenance({
    "wiki/source.md": { createdAt: null, sources: ["source"] },
    "wiki/destination.md": { createdAt: "known", sources: ["destination"] },
  }, "old", "new", new Map([["wiki/source.md", "wiki/destination.md"]])))
    .toEqual({ "wiki/destination.md": { createdAt: null, sources: ["source", "destination"] } })
})
it("retains unknown legacy creation time and unions sources without mutation", () => {
  const catalog = { "wiki/a.md": { createdAt: null, sources: ["old"] } }
  const updated = recordWikiProvenance(catalog, ["wiki\\a.md", "wiki/b.md"], "new", { "wiki/a.md": "today", "wiki/b.md": "today" })
  expect(updated["wiki/a.md"]).toEqual({ createdAt: null, sources: ["old", "new"] })
  expect(updated["wiki/b.md"].createdAt).toBe("today")
  expect(catalog["wiki/a.md"].sources).toEqual(["old"])
})
it("moves references and page metadata while keeping creation time and merging destinations", () => {
  const updated = moveWikiProvenance({
    "wiki/old.md": { createdAt: "earlier", sources: ["old"] },
    "wiki/new.md": { createdAt: "later", sources: ["new", "other"] },
  }, "old", "new", new Map([["wiki/old.md", "wiki/new.md"]]))
  expect(updated).toEqual({ "wiki/new.md": { createdAt: "earlier", sources: ["new", "other"] } })
})
it("records only proven first writes and never fills legacy unknown timestamps", () => {
  const empty = recordWikiWrite({}, "wiki/new.md", { existed: false, now: "t1", sources: ["source-a"] })
  expect(empty["wiki/new.md"]).toEqual({ createdAt: "t1", sources: ["source-a"] })
  const edited = recordWikiWrite(empty, "wiki/new.md", { existed: true, now: "t2", sources: ["source-b"] })
  expect(edited["wiki/new.md"]).toEqual({ createdAt: "t1", sources: ["source-a", "source-b"] })
  const legacy = recordWikiWrite({}, "wiki/legacy.md", { existed: true, now: "t3" })
  expect(legacy["wiki/legacy.md"]).toEqual({ createdAt: null, sources: [] })
  expect(recordWikiWrite(legacy, "wiki/legacy.md", { existed: true, now: "t4" })["wiki/legacy.md"].createdAt).toBeNull()
})
it("tracks substantive body authorship by hash and leaves review/metadata out of origins", () => {
  const user = { actor: { kind: "user" as const, id: "local-user", entrypoint: "editor" } }
  const agent = { actor: { kind: "agent" as const, id: "local-agent-run", entrypoint: "compile" } }
  const first = recordWikiWrite({}, "wiki/page.md", { existed: false, now: "t1", contentHash: "a".repeat(64), attribution: user })
  const same = recordWikiWrite(first, "wiki/page.md", { existed: true, now: "t2", contentHash: "a".repeat(64), attribution: agent })
  expect(same["wiki/page.md"].revisions).toHaveLength(1)
  const next = recordWikiWrite(same, "wiki/page.md", { existed: true, now: "t3", contentHash: "b".repeat(64), attribution: { ...agent, metadataOnly: true } })
  expect(next["wiki/page.md"].revisions).toHaveLength(1)
  const changed = recordWikiWrite(next, "wiki/page.md", { existed: true, now: "t4", contentHash: "c".repeat(64), attribution: agent })
  expect(changed["wiki/page.md"].creator).toEqual(user.actor)
  expect(changed["wiki/page.md"].revisions?.[1].originKinds).toEqual(["user", "agent"])
  expect(isWikiProvenance(changed["wiki/page.md"])).toBe(true)
})
it("keeps legacy unknown creator unknown after a later known edit and rejects malformed authorship", () => {
  const legacy = recordWikiWrite({ "wiki/old.md": { createdAt: null, sources: [] } }, "wiki/old.md", {
    existed: true, now: "later", contentHash: "d".repeat(64), attribution: { actor: { kind: "user", id: "local-user", entrypoint: "editor" } },
  })
  expect(legacy["wiki/old.md"].creator).toBeUndefined()
  expect(isWikiProvenance({ ...legacy["wiki/old.md"], revisions: [{ revision: 4 }] })).toBe(false)
})
it("protects only top-level YAML created and leaves a missing created field missing", () => {
  expect(preserveWikiCreatedFrontmatter(
    "---\ncreated: 2026-11-01\ntitle: T\n---\nbody created: old",
    "---\ntitle: T\ncreated: 2026-11-03\n---\nbody created: new",
  )).toContain("created: 2026-11-01")
  const noPrior = preserveWikiCreatedFrontmatter(
    "---\ntitle: T\n---\nbody",
    "---\ntitle: T\ncreated: 2026-11-03\n---\nbody created: text",
  )
  expect(noPrior.match(/^---\n([\s\S]*?)\n---/m)?.[1]).not.toMatch(/^created\s*:/m)
  expect(noPrior).toContain("body created: text")
})
it("preserves multiline created fields and does not confuse frontmatter delimiters", () => {
  const output = preserveWikiCreatedFrontmatter(
    "---\ntitle: T\ncreated: |-\n  old text\n  created: nested\n---\nbody",
    "---\ntitle: T\ncreated: 2026-11-05\n---\nbody",
  )
  expect(output).toContain("created: |-\n  old text\n  created: nested")
  expect(preserveWikiCreatedFrontmatter("---\ntitle: T\n---\nbody", "---\ntitle: T\n---\nbody"))
    .toBe("---\ntitle: T\n---\nbody")
})
