import { describe, expect, it } from "vitest"
import { createMemoryRecord } from "@/modules/memory/domain"
import { emptySharedWorkspace } from "./workspace"
import { createExportBundle, validateExportBundle, planImport } from "./export-bundle"

const fixture = () => ({ projectName: "Example", exportedAt: "2026-11-11T00:00:00Z", workspace: {
  ...emptySharedWorkspace(), memories: ["b", "a"].map(id => createMemoryRecord({ id, title: id, content: "text", category: "fact", domainIds: [], relatedIds: [], createdAt: "2026-11-11T00:00:00Z", updatedAt: "2026-11-11T00:00:00Z" })),
}, wiki: [{ path: "c", content: "C" }, { path: "a", content: "A" }, { path: "b", content: "B" }], documents: [{ sourceId: "b", name: "B", size: 1 }, { sourceId: "a", name: "A", size: 0 }] })

describe("export bundle", () => {
  it("both constructors deeply isolate nested inputs", () => {
    const input = fixture(), snapshot = structuredClone(input)
    const created = createExportBundle(input), validated = validateExportBundle(created), before = structuredClone(created)
    validated.workspace.memories[0].source.kind = "agent"
    validated.wiki[0].content = "changed"
    validated.documents[0].name = "changed"
    expect(created).toEqual(before)
    created.workspace.memories[0].revisions[0].title = "changed"
    created.wiki[0].content = "changed"
    expect(input).toEqual(snapshot)
  })
  it("normalizes all three arrays without changing inputs", () => {
    for (const bundle of [createExportBundle(fixture()), validateExportBundle({ ...createExportBundle(fixture()), wiki: fixture().wiki, documents: fixture().documents, workspace: fixture().workspace })]) {
      expect(bundle.wiki.map(x => x.path)).toEqual(["a", "b", "c"])
      expect(bundle.documents.map(x => x.sourceId)).toEqual(["a", "b"])
      expect(bundle.workspace.memories.map(x => x.id)).toEqual(["a", "b"])
    }
  })
  it("rejects duplicate keys in both constructors", () => {
    const input = fixture()
    input.wiki.push(input.wiki[0])
    expect(() => createExportBundle(input)).toThrow("Duplicate wiki path: c")
    const bundle = createExportBundle(fixture())
    bundle.documents.push(bundle.documents[0])
    expect(() => validateExportBundle(bundle)).toThrow("Duplicate document sourceId: a")
  })
  it("rejects unsupported versions", () => expect(() => validateExportBundle({ ...createExportBundle(fixture()), bundleVersion: 2 })).toThrow("Unsupported export bundle version"))
  it("delegates invalid memory validation", () => {
    const bundle = createExportBundle(fixture())
    expect(() => validateExportBundle({ ...bundle, workspace: { ...bundle.workspace, memories: [{ ...bundle.workspace.memories[0], title: {} }] } })).toThrow()
  })
  it.each([-1, 0.5])("rejects invalid size %s", size => {
    const bundle = createExportBundle(fixture())
    bundle.documents[0].size = size
    expect(() => validateExportBundle(bundle)).toThrow("Invalid documents")
  })
  it("plans sorted creates, updates, skips and counts without mutation", () => {
    const bundle = createExportBundle(fixture()), existing = { wikiPaths: ["b", "a"], documentSourceIds: ["a"] }
    const before = structuredClone({ bundle, existing })
    expect(planImport(bundle, existing)).toEqual({ wiki: { create: ["c"], update: ["a", "b"] }, documents: { create: ["b"], skip: ["a"] }, memories: 2, domains: 0 })
    expect({ bundle, existing }).toEqual(before)
  })
  it("rejects invalid dates, arrays and optional field types", () => {
    const bundle = createExportBundle(fixture())
    for (const patch of [{ exportedAt: "bad" }, { wiki: {} }, { documents: [{ sourceId: "a", name: "A", size: 0, mediaType: 1 }] }]) expect(() => validateExportBundle({ ...bundle, ...patch })).toThrow()
  })
})
