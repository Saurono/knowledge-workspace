import { expect, it } from "vitest"
import { moveWikiProvenance, recordWikiProvenance } from "./provenance"
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
