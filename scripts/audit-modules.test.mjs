import { afterEach, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { auditModules } from "./audit-modules.mjs"
const roots = []
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-audit-")); roots.push(root)
  const write = (name, value) => { const full = path.join(root, name); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, value) }
  write("src/modules/sample/module.json", JSON.stringify({ id: "sample", publicEntrypoints: ["index.ts"], allowedModuleDependencies: [], allowedExternalImports: [], allowedLegacyImports: [] }))
  write("src/modules/sample/index.ts", "export const value = 1\n")
  write("src/modules/sample/README.md", "# Sample\n\nPublic module contract and its application boundary.")
  write("src/lib/compat.ts", 'export { value } from "@/modules/sample"\n')
  return { root, write }
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
it("counts both type-only production imports and contract tests for compatibility APIs", () => {
  const { root, write } = fixture()
  write("src/app/use.ts", 'import type { value } from "@/lib/compat"\n')
  write("src/compat.test.ts", 'import { value } from "./lib/compat"\n')
  const audit = auditModules(root)
  expect(audit.errors).toEqual([])
  expect(audit.compatibility).toEqual([{ path: "src/lib/compat.ts", productionImporters: 1, testImporters: 1 }])
  expect(audit.modules[0].publicEntrypoints[0].productionImporters).toBe(1)
})
it("reports a genuinely unused facade rather than keeping it as migration scaffolding", () => {
  const { root } = fixture()
  expect(auditModules(root).errors).toContain("src/lib/compat.ts: unreferenced compatibility facade")
})
