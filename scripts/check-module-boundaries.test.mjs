import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { checkModuleBoundaries } from "./check-module-boundaries.mjs"

const roots = []
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-module-test-"))
  roots.push(root)
  return root
}
function write(root, name, text) {
  const file = path.join(root, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
function module(root, name, dependencies = []) {
  write(
    root,
    `src/modules/${name}/module.json`,
    JSON.stringify({
      id: name,
      publicEntrypoints: ["index.ts"],
      allowedModuleDependencies: dependencies,
      allowedExternalImports: ["react"],
      allowedLegacyImports: [],
    }),
  )
  write(root, `src/modules/${name}/index.ts`, "export const value = 1\n")
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
describe("module architecture enforcement", () => {
  it("also checks type-only private imports", () => {
    const root = fixture()
    module(root, "scene")
    write(root, "src/modules/scene/domain/private.ts", "export type Hidden = string\n")
    write(root, "src/app.ts", 'type Hidden = import("@/modules/scene/domain/private").Hidden\n')
    expect(
      checkModuleBoundaries(root).errors.some((error) => error.includes("private implementation")),
    ).toBe(true)
  })
  it("requires analyzable imports inside modules", () => {
    const root = fixture()
    module(root, "scene")
    write(
      root,
      "src/modules/scene/ui/loader.ts",
      'const target = "../domain/private"; import(target)\n',
    )
    expect(
      checkModuleBoundaries(root).errors.some((error) => error.includes("non-literal import")),
    ).toBe(true)
  })
  it("allows application code to use declared public entries", () => {
    const root = fixture()
    module(root, "scene")
    write(root, "src/app.ts", 'import { value } from "@/modules/scene"\n')
    expect(checkModuleBoundaries(root).errors).toEqual([])
  })
  it("rejects imports of another module's private code", () => {
    const root = fixture()
    module(root, "scene")
    write(root, "src/modules/scene/domain/private.ts", "export const hidden = 1\n")
    write(root, "src/app.ts", 'import { hidden } from "@/modules/scene/domain/private"\n')
    expect(
      checkModuleBoundaries(root).errors.some((error) => error.includes("private implementation")),
    ).toBe(true)
  })
  it("keeps pure domain logic independent from UI and platform packages", () => {
    const root = fixture()
    module(root, "scene")
    write(root, "src/modules/scene/ui/view.ts", "export const view = 1\n")
    write(
      root,
      "src/modules/scene/domain/model.ts",
      'import { view } from "../ui/view"\nimport React from "react"\n',
    )
    expect(
      checkModuleBoundaries(root).errors.filter((error) => error.includes("domain must remain")),
    ).toHaveLength(2)
  })
  it("rejects module dependency cycles", () => {
    const root = fixture()
    module(root, "one", ["two"])
    module(root, "two", ["one"])
    write(root, "src/modules/one/index.ts", 'export { value } from "@/modules/two"\n')
    write(root, "src/modules/two/index.ts", 'export { value } from "@/modules/one"\n')
    expect(
      checkModuleBoundaries(root).errors.some((error) => error.includes("dependency cycle")),
    ).toBe(true)
  })
  it("rejects undeclared platform and legacy-store coupling", () => {
    const root = fixture()
    module(root, "scene")
    write(root, "src/stores/global.ts", "export const state = 1\n")
    write(
      root,
      "src/modules/scene/ui/view.ts",
      'import { state } from "@/stores/global"\nimport { invoke } from "@tauri-apps/api/core"\n',
    )
    const errors = checkModuleBoundaries(root).errors
    expect(errors.some((error) => error.includes("undeclared legacy"))).toBe(true)
    expect(errors.some((error) => error.includes("undeclared package"))).toBe(true)
  })
})
