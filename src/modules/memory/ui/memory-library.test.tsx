import { createElement } from "react"
import * as React from "react"
import type { MemoryLibraryProps } from "./memory-library"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { MemoryLibrary } from "./memory-library"
import { createMemoryRecord } from "../domain/model"
import { MEMORY_CATEGORIES } from "../domain"

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, options?: { to: number }) => options ? `${key}: v1–v${options.to}` : key }) }))
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof React>()
  return { ...actual, useState: vi.fn(actual.useState) }
})
const record = (id: string) => createMemoryRecord({
  id, title: id, content: "Content", category: "", domainIds: [], relatedIds: [],
  createdAt: "2026-01-01", updatedAt: "2026-01-01",
})
// Existing tree visitors invoke the component directly, outside a React renderer.
const effectMock = vi.spyOn(React, "useEffect").mockImplementation(() => {})
const render = (memories = [record("a")]) => renderToStaticMarkup(createElement(MemoryLibrary, {
  memories, domains: [], loading: false, saving: false, error: null, selected: "a",
  onSelect: vi.fn(), onSave: vi.fn(), onRemove: vi.fn(), onRetry: vi.fn(),
}))
describe("MemoryLibrary display", () => {
  it("renders supplied summary conflicts and preserves full-record detection", () => {
    const a = record("a"), b = record("b")
    const props: MemoryLibraryProps = {
      memories: [a], summaries: [
        { id: "a", title: "Alpha", status: "active", version: 1, updatedAt: "2026-11-11", owner: null, category: "fact" },
        { id: "b", title: "Beta", status: "active", version: 1, updatedAt: "2026-11-11", owner: null, category: "fact" },
      ], conflicts: [{ a: "a", b: "b" }],
      domains: [], loading: false, saving: false, error: null, selected: "a",
      onSelect: vi.fn(), onSave: vi.fn(), onRemove: vi.fn(), onRetry: vi.fn(),
    }
    const html = renderToStaticMarkup(createElement(MemoryLibrary, props))
    expect(html).toContain("workspace.memoryDisplay.conflicts")
    expect(html).toContain("b / Beta")
    expect(renderToStaticMarkup(createElement(MemoryLibrary, { ...props, conflicts: undefined }))).not.toContain("workspace.memoryDisplay.conflicts")
    b.relations = [{ type: "contradicts", targetId: "a" }]
    expect(renderToStaticMarkup(createElement(MemoryLibrary, { ...props, summaries: undefined, memories: [a, b], conflicts: [] }))).toContain("b / b")
  })
  it("renders category as a whitelist select and writes changes to the draft", () => {
    const previousUseState = vi.mocked(React.useState).getMockImplementation()!
    const setDraft = vi.fn()
    vi.mocked(React.useState).mockImplementation(((initial: unknown) =>
      [initial, setDraft]) as unknown as typeof React.useState)
    try {
      const a = record("a")
      const nodes: { type: unknown; props: any }[] = []
      const visit = (node: any) => {
        if (!node || typeof node !== "object") return
        if (Array.isArray(node)) return node.forEach(visit)
        nodes.push(node)
        visit(node.props?.children)
      }
      visit(MemoryLibrary({
        memories: [a], domains: [], loading: false, saving: false, error: null, selected: "a",
        onSelect: vi.fn(), onSave: vi.fn(), onRemove: vi.fn(), onRetry: vi.fn(),
      }))
      const label = nodes.find(n => n.type === "label" && n.props.children[0] === "workspace.category")!
      const select = label.props.children[1]
      expect(select.type).toBe("select")
      expect(select.props.value).toBe(a.category)
      expect(select.props.children).toHaveLength(MEMORY_CATEGORIES.length)
      expect(select.props.children.map((option: any) => option.props.value)).toEqual([...MEMORY_CATEGORIES])
      select.props.onChange({ target: { value: "preference" } })
      expect(setDraft).toHaveBeenCalledWith({ ...a, category: "preference" })
    } finally {
      vi.mocked(React.useState).mockImplementation(previousUseState)
    }
  })
  it("shows archived bodies before retained revisions", () => {
    const a = record("a")
    a.revisionCompaction = { upToVersion: 7, keptFrom: 8, digest: "digest" }
    a.revisions.push({ ...a.revisions[0], version: 8 })
    const history = render([a]).split("workspace.memoryDisplay.history")[1].split("</ol>")[0]
    expect(history).toContain("workspace.memoryDisplay.compacted: v1–v7")
    expect(history.indexOf("compacted")).toBeLessThan(history.indexOf("v8"))
    expect(history.match(/<li /g)).toHaveLength(1)
  })
  it("omits the archive notice without compaction", () => {
    expect(render()).not.toContain("workspace.memoryDisplay.compacted")
  })
  it("renders status and unknown importance", () => {
    const html = render()
    expect(html).toContain("workspace.memoryDisplay.active")
    expect(html).toContain("workspace.memoryDisplay.importance: workspace.memoryDisplay.unknown")
    expect(html).not.toContain("workspace.memoryDisplay.importance: 0")
  })
  it("preserves revision count and order", () => {
    const a = record("a")
    a.revisions.push({ ...a.revisions[0], version: 2, changeNote: "Second revision" })
    const html = render([a])
    const history = html.split("workspace.memoryDisplay.history")[1].split("</ol>")[0]
    expect(history.match(/<li /g)).toHaveLength(2)
    expect(history.indexOf("v1")).toBeLessThan(history.indexOf("v2"))
    expect(history).toContain("Second revision")
  })
  it("shows conflicts from either endpoint and omits empty conflicts", () => {
    expect(render()).not.toContain("workspace.memoryDisplay.conflicts")
    const a = record("a"), b = record("b")
    b.relations = [{ type: "contradicts", targetId: "a" }]
    const html = render([a, b])
    expect(html).toContain("workspace.memoryDisplay.conflicts")
    expect(html).toContain("b / b")
  })
})

describe("MemoryLibrary lifecycle actions", () => {
  const build = (status: ReturnType<typeof record>["status"], extra: Partial<MemoryLibraryProps> = {}, target = "") => {
    vi.mocked(React.useState).mockImplementation(((initial: unknown) =>
      [typeof initial === "object" && initial !== null && "owner" in initial ? { owner: "a", target } : initial, vi.fn()]) as unknown as typeof React.useState)
    const a = { ...record("a"), status }
    const props: MemoryLibraryProps = {
      memories: [a, record("b")], domains: [], loading: false, saving: false, error: null,
      selected: "a", onSelect: vi.fn(), onSave: vi.fn(), onRemove: vi.fn(), onRetry: vi.fn(),
      onPromote: vi.fn(), onArchive: vi.fn(), onSupersede: vi.fn(), ...extra,
    }
    const nodes: { type: unknown; props: any }[] = []
    const visit = (node: any) => {
      if (!node || typeof node !== "object") return
      if (Array.isArray(node)) return node.forEach(visit)
      nodes.push(node)
      visit(node.props?.children)
    }
    visit(MemoryLibrary(props))
    const button = (key: string) => nodes.find(n => n.type === "button" && n.props.children === `workspace.memoryDisplay.${key}`)
    return { props, nodes, button }
  }
  it("promotes candidates and archives active memories", () => {
    const candidate = build("candidate")
    candidate.button("promote")!.props.onClick()
    expect(candidate.props.onPromote).toHaveBeenCalledWith("a")
    const active = build("active")
    active.button("archive")!.props.onClick()
    expect(active.props.onArchive).toHaveBeenCalledWith("a")
  })
  it("omits lifecycle actions for archived records and missing handlers", () => {
    for (const view of [build("archived"), build("candidate", { onPromote: undefined, onArchive: undefined }), build("active", { onArchive: undefined, onSupersede: undefined })])
      for (const key of ["promote", "archive", "supersede"]) expect(view.button(key)).toBeUndefined()
  })
  it("disables actions in read-only mode", () => {
    const view = build("candidate", { readOnly: true })
    expect(view.button("promote")!.props.disabled).toBe(true)
    expect(view.button("archive")!.props.disabled).toBe(true)
  })
  const conflictView = (extra: Partial<MemoryLibraryProps> = {}) => {
    const a = record("a"), b = record("b")
    b.relations = [{ type: "contradicts", targetId: "a" }]
    return build("active", { memories: [a, b], onResolve: vi.fn(), ...extra })
  }
  it("renders both conflict resolution buttons", () => {
    const view = conflictView()
    expect(view.button("resolveBoth")).toBeDefined()
    expect(view.button("resolveMerged")).toBeDefined()
  })
  it("resolves keeping both records with the current endpoint first", () => {
    const view = conflictView()
    view.button("resolveBoth")!.props.onClick()
    expect(view.props.onResolve).toHaveBeenCalledWith("a", "b", "both-intentional")
  })
  it("omits resolution buttons without a handler", () => {
    const view = conflictView({ onResolve: undefined })
    expect(view.button("resolveBoth")).toBeUndefined()
    expect(view.button("resolveMerged")).toBeUndefined()
  })
  it("disables both resolution buttons in read-only mode", () => {
    const view = conflictView({ readOnly: true })
    expect(view.button("resolveBoth")!.props.disabled).toBe(true)
    expect(view.button("resolveMerged")!.props.disabled).toBe(true)
  })
  it("selects an active replacement before superseding", () => {
    const empty = build("active")
    expect(empty.button("supersede")!.props.disabled).toBe(true)
    const select = empty.nodes.find(n => n.type === "select" && n.props["aria-label"] === "workspace.memoryDisplay.supersedeTarget")!
    select.props.onChange({ target: { value: "b" } })
    const selected = build("active", {}, "b")
    expect(selected.button("supersede")!.props.disabled).toBe(false)
    selected.button("supersede")!.props.onClick()
    expect(selected.props.onSupersede).toHaveBeenCalledWith("a", "b")
  })
})

describe("MemoryLibrary summary mode", () => {
  const summary = (id: string, version = 3) => ({
    id, title: `Summary ${id}`, status: "active" as const, version,
    updatedAt: "2026-11-10", owner: null, category: "preference",
  })
  const withView = async (extra: Partial<MemoryLibraryProps>, run: (view: {
    draw: () => any[]; props: MemoryLibraryProps; html: () => string
  }) => Promise<void> | void) => {
    const previousState = vi.mocked(React.useState).getMockImplementation()!
    const states: unknown[] = []
    let cursor = 0
    let dependencies: React.DependencyList | undefined
    let pending: (() => void) | undefined
    vi.mocked(React.useState).mockImplementation(((initial: unknown) => {
      const index = cursor++
      if (!(index in states)) states[index] = initial
      return [states[index], (next: unknown) => {
        states[index] = typeof next === "function" ? next(states[index]) : next
      }]
    }) as typeof React.useState)
    effectMock.mockImplementation((effect, deps) => {
      if (!dependencies || deps?.some((value, index) => value !== dependencies![index])) {
        dependencies = deps
        pending = () => { effect() }
      }
    })
    const props: MemoryLibraryProps = {
      summaries: [summary("a")], domains: [], loading: false, saving: false,
      error: null, selected: null, onSelect: id => { props.selected = id },
      onSave: vi.fn(), onRemove: vi.fn(), onRetry: vi.fn(), ...extra,
    }
    const tree = () => { cursor = 0; return MemoryLibrary(props) }
    const draw = () => {
      const nodes: any[] = []
      const visit = (node: any) => {
        if (!node || typeof node !== "object") return
        if (Array.isArray(node)) return node.forEach(visit)
        nodes.push(node)
        visit(node.props?.children)
      }
      visit(tree())
      const effect = pending
      pending = undefined
      effect?.()
      return nodes
    }
    try { await run({ draw, props, html: () => renderToStaticMarkup(tree()) }) }
    finally {
      vi.mocked(React.useState).mockImplementation(previousState)
      effectMock.mockImplementation(() => {})
    }
  }
  const listButton = (nodes: any[]) => nodes.find(n => n.type === "button" && n.props.children?.[0]?.type === "strong")
  it("renders summary titles and versions without full records", async () => {
    await withView({}, ({ html }) => {
      expect(html()).toContain("Summary a")
      expect(html()).toContain("v3")
      expect(html()).toContain("workspace.selectMemory")
    })
  })
  it("loads an unloaded selection and displays its body", async () => {
    let resolve!: (value: ReturnType<typeof record>) => void
    const onLoadMemory = vi.fn(() => new Promise<ReturnType<typeof record>>(done => { resolve = done }))
    await withView({ onLoadMemory }, async ({ draw, html }) => {
      listButton(draw()).props.onClick()
      draw()
      expect(onLoadMemory).toHaveBeenCalledWith("a")
      expect(html()).toContain("workspace.loadingMemory")
      resolve({ ...record("a"), content: "Loaded body" })
      await Promise.resolve()
      expect(html()).toContain("Loaded body")
    })
  })
  it("shows a failed null load and retries on another click", async () => {
    const onLoadMemory = vi.fn().mockResolvedValue(null)
    await withView({ onLoadMemory }, async ({ draw, html }) => {
      listButton(draw()).props.onClick()
      draw()
      await Promise.resolve()
      expect(html()).toContain('role="alert"')
      expect(html()).toContain("errors.generic")
      expect(html()).toContain("workspace.retry")
      listButton(draw()).props.onClick()
      await Promise.resolve()
      expect(onLoadMemory).toHaveBeenCalledTimes(2)
    })
  })
  it("omits conflicts even when available full records contradict", async () => {
    const a = record("a"), b = record("b")
    b.relations = [{ type: "contradicts", targetId: "a" }]
    await withView({ memories: [a, b], summaries: [summary("a"), summary("b")], selected: "a" }, ({ html }) => {
      expect(html()).not.toContain("workspace.memoryDisplay.conflicts")
      expect(html()).not.toContain("冲突")
    })
  })
  it("merges the returned saved record without duplicating its summary", async () => {
    const saved = { ...record("a"), title: "Saved title", version: 4, updatedAt: "2026-11-11" }
    const onSave = vi.fn().mockResolvedValue({ success: true, record: saved })
    await withView({ memories: [record("a")], selected: "a", onSave }, async ({ draw, html }) => {
      await draw().find(n => n.type === "button" && n.props.children === "workspace.save").props.onClick()
      expect(onSave).toHaveBeenCalledTimes(1)
      const aside = html().split("<aside")[1].split("</aside>")[0]
      expect(aside.match(/<button /g)).toHaveLength(1)
      expect(aside).toContain("Saved title")
      expect(aside).toContain("v4")
      expect(aside).not.toContain("v3")
    })
  })
})
