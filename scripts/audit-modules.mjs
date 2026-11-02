import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import ts from "typescript"
import { checkModuleBoundaries } from "./check-module-boundaries.mjs"
const normalize = value => value.split(path.sep).join("/")
const test = file => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
const walk = directory => fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path.join(directory, entry.name)] : []) : []
function resolve(file, specifier, sourceRoot) {
  const base = specifier.startsWith("@/") ? path.join(sourceRoot, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : null
  if (!base) return null
  return [base, ...[".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"].map(extension => base + extension)]
    .map(candidate => path.normalize(candidate))
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
}
export function auditModules(root) {
  const sourceRoot = path.join(root, "src"), moduleRoot = path.join(sourceRoot, "modules")
  const files = [...walk(sourceRoot), ...walk(path.join(root, "server"))], importers = new Map(), facades = []
  for (const file of files) {
    const ast = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
    if (file.startsWith(path.join(sourceRoot, "lib") + path.sep) && ast.statements.length && ast.statements.every(statement => ts.isExportDeclaration(statement) && statement.moduleSpecifier)) facades.push(file)
    const visit = node => {
      let specifier
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text
      else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) specifier = node.argument.literal.text
      if (specifier) {
        const target = resolve(file, specifier, sourceRoot)
        if (target) {
          const counts = importers.get(target) ?? { production: new Set(), tests: new Set() }
          counts[test(file) ? "tests" : "production"].add(file)
          importers.set(target, counts)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  const { errors } = checkModuleBoundaries(root)
  const modules = fs.readdirSync(moduleRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
    const directory = path.join(moduleRoot, entry.name), manifest = JSON.parse(fs.readFileSync(path.join(directory, "module.json"), "utf8"))
    if (!fs.existsSync(path.join(directory, "README.md"))) errors.push(`${entry.name}: missing README.md`)
    if (manifest.allowedLegacyImports.length) errors.push(`${entry.name}: legacy import exceptions remain`)
    const owned = files.filter(file => file.startsWith(directory + path.sep))
    return { id: entry.name, productionFiles: owned.filter(file => !test(file)).length, testFiles: owned.filter(test).length,
      publicEntrypoints: manifest.publicEntrypoints.map(name => ({ path: normalize(name), productionImporters: importers.get(path.join(directory, name))?.production.size ?? 0 })),
      dependencies: [...manifest.allowedModuleDependencies].sort(), externalPackages: [...manifest.allowedExternalImports].sort(), legacyExceptions: manifest.allowedLegacyImports }
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const compatibility = facades.map(file => ({ path: normalize(path.relative(root, file)), productionImporters: importers.get(file)?.production.size ?? 0, testImporters: importers.get(file)?.tests.size ?? 0 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  for (const facade of compatibility) if (!facade.productionImporters && !facade.testImporters) errors.push(`${facade.path}: unreferenced compatibility facade`)
  return { schemaVersion: 1, scope: "src and server production imports and type imports; feature layers/manifests; compatibility facade references including tests", productionFiles: files.filter(file => !test(file)).length,
    moduleCount: modules.length, modules, compatibility, errors }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const report = auditModules(root), reportPath = path.join(root, "analysis/architecture/module-audit-v1.json")
  const content = JSON.stringify(report, null, 2) + "\n"
  if (report.errors.length) { console.error(report.errors.join("\n")); process.exitCode = 1 }
  else if (process.argv.includes("--check")) {
    if (!fs.existsSync(reportPath) || fs.readFileSync(reportPath, "utf8") !== content) { console.error("Module audit snapshot is stale; run npm run audit:modules and commit the report."); process.exitCode = 1 }
    else console.log(`Module audit passed (${report.moduleCount} modules, ${report.productionFiles} production source files)`)
  } else { fs.writeFileSync(reportPath, content); console.log(`Module audit written (${report.moduleCount} modules, ${report.productionFiles} production source files)`) }
}
