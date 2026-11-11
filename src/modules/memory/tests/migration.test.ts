import { describe, expect, it } from "vitest"
import { createMemoryRecord, validateMemories } from "../domain/model"
import { migrateMemoryV1, migrateMemoriesV1 } from "../domain/migrate"
import { validateSharedWorkspace } from "../../service-api/application/workspace"

const legacy = () => ({ id: "a", title: "A", content: "Content", category: "fact", domainIds: [], relatedIds: ["b"], createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z" })
describe("memory normalization", () => {
  it.each(["legacy", "versioned"])("normalizes unknown categories idempotently on the %s path", path => {
    const original = path === "legacy" ? legacy() : createMemoryRecord({ ...legacy(), status: "candidate" })
    const migrated = migrateMemoryV1({ ...original, category: "工作" })
    expect(migrated.category).toBe("context")
    expect(migrated.transitions[migrated.transitions.length - 1]).toEqual({ at: original.updatedAt, from: "status" in original ? original.status : "active", to: "status" in original ? original.status : "active", reason: "category-normalized:工作", source: migrated.source })
    const again = migrateMemoryV1(migrated)
    expect(again.category).toBe("context")
    expect(again.transitions).toHaveLength(migrated.transitions.length)
  })
  it("normalizes empty categories and preserves legal categories", () => {
    const empty = migrateMemoryV1({ ...legacy(), category: "" })
    expect(empty.category).toBe("context")
    expect(empty.transitions[empty.transitions.length - 1]?.reason).toBe("category-normalized:")
    expect(migrateMemoryV1(legacy())).toMatchObject({ category: "fact", transitions: [] })
    expect(createMemoryRecord({ ...legacy(), category: "乱七八糟" }).category).toBe("context")
  })
  it("defaults factory and legacy lifecycle without invented transitions", () => {
    expect(createMemoryRecord(legacy())).toMatchObject({ status: "active", transitions: [] })
    expect(migrateMemoryV1(legacy())).toMatchObject({ status: "active", transitions: [] })
  })
  it("factory defaults and legacy migration preserve old fields and are idempotent", () => {
    const old = legacy(), migrated = migrateMemoryV1(old)
    expect(migrated).toMatchObject({ ...old, version: 1, source: { kind: "legacy" }, importance: null, credibility: null, validity: {}, relations: [{ type: "related", targetId: "b" }] })
    expect(migrated.revisions).toEqual([{ version: 1, title: old.title, content: old.content, at: old.updatedAt, source: { kind: "legacy" } }])
    expect(migrateMemoryV1(migrated)).toBe(migrated)
    expect(migrateMemoriesV1([migrated])).toEqual([migrated])
    expect(old).toEqual(legacy())
    expect(createMemoryRecord(old).source).toEqual({ kind: "user" })
  })
  it("migrates at workspace ingress", () => {
    expect(validateSharedWorkspace({ version: 1, domains: [], resourceDomains: {}, memories: [{ ...legacy(), relatedIds: [] }] }).memories[0].source.kind).toBe("legacy")
  })
  it.each([
    { title: 3 }, { domainIds: [3] }, { relatedIds: null }, { access: {} },
    { version: 0 }, { version: 1.5 }, { source: { kind: "unknown" } }, { source: { kind: "user", actorId: 3 } },
    { importance: -1 }, { importance: 1.1 }, { credibility: NaN }, { credibility: "1" },
    { validity: null }, { validity: { from: "bad" } }, { validity: { from: "2026-10-02", until: "2026-10-01" } },
    { relations: [{ type: "unknown", targetId: "b" }] }, { relations: [{ type: "related", targetId: "../bad" }] },
    { revisions: [] }, { revisions: [{ version: 1 }] }, { title: "Mismatch" }, { updatedAt: "2026-10-03" },
  ])("rejects invalid field %j", patch => {
    expect(() => validateMemories([{ ...createMemoryRecord(legacy()), ...patch }])).toThrow("Invalid memory records")
  })
  it("rejects duplicates, partial migrations and invalid collections", () => {
    const record = createMemoryRecord(legacy())
    expect(() => validateMemories([record, record])).toThrow()
    expect(() => migrateMemoryV1({ ...legacy(), version: 1 })).toThrow()
    expect(() => migrateMemoriesV1(null)).toThrow()
  })
  it("accepts score endpoints and ordered validity", () => {
    expect(validateMemories([createMemoryRecord({ ...legacy(), importance: 0, credibility: 1, validity: { from: "2026-10-01", until: "2026-10-01" } })])).toHaveLength(1)
  })
})
