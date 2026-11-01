import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import ts from "typescript"

const normalize = (value) => value.split(path.sep).join("/")
const sourcePattern = /\.[cm]?[jt]sx?$/
const isTest = (value) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(value)
const packageMatches = (value, allowed) =>
  allowed.some((name) => value === name || value.startsWith(`${name}/`))
function walk(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}
function resolveImport(file, specifier, sourceRoot) {
  const base = specifier.startsWith("@/")
    ? path.join(sourceRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(file), specifier)
      : null
  if (!base) return null
  return (
    [
      base,
      ...[".ts", ".tsx", ".js", ".jsx", ".json", ".css"].map((extension) => base + extension),
      ...["index.ts", "index.tsx", "index.js"].map((name) => path.join(base, name)),
    ].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? base
  )
}
function importsOf(file) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
  const imports = []
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text)
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      if (node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
        imports.push(node.arguments[0].text)
      else imports.push(null)
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      imports.push(node.argument.literal.text)
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    )
      imports.push(node.moduleReference.expression.text)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return imports
}
function domainPlatformCalls(file) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
  const calls = new Set()
  const roots = new Set(["window", "document", "navigator", "localStorage", "sessionStorage", "process"])
  const visit = (node) => {
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression)
      && ["fetch", "Worker", "WebSocket", "XMLHttpRequest"].includes(node.expression.text)) calls.add(node.expression.text)
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression)) {
      if (roots.has(node.expression.text)) calls.add(node.expression.text)
      if (node.expression.text === "globalThis" && ts.isPropertyAccessExpression(node)
        && ["fetch", "window", "document", "navigator", "localStorage", "sessionStorage", "Worker", "WebSocket"].includes(node.name.text)) calls.add(`globalThis.${node.name.text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return [...calls]
}
export function checkModuleBoundaries(root) {
  const sourceRoot = path.join(root, "src")
  const moduleRoot = path.join(sourceRoot, "modules")
  const modules = new Map()
  const errors = []
  if (!fs.existsSync(moduleRoot)) return { errors, modules: 0 }
  for (const entry of fs.readdirSync(moduleRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = path.join(moduleRoot, entry.name)
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, "module.json"), "utf8"))
      if (
        manifest.id !== entry.name ||
        !Array.isArray(manifest.publicEntrypoints) ||
        ![
          manifest.allowedModuleDependencies,
          manifest.allowedExternalImports,
          manifest.allowedLegacyImports,
        ].every(Array.isArray)
      )
        throw new Error("invalid manifest")
      const publicFiles = manifest.publicEntrypoints.map((name) => path.resolve(directory, name))
      if (
        publicFiles.some(
          (file) => !file.startsWith(`${directory}${path.sep}`) || !fs.existsSync(file),
        )
      )
        throw new Error("invalid public entry point")
      modules.set(entry.name, { ...manifest, directory, publicFiles })
    } catch (error) {
      errors.push(`${entry.name}: missing/invalid module.json (${error.message})`)
    }
  }
  const ownerOf = (file) =>
    [...modules.values()].find((module) => file.startsWith(`${module.directory}${path.sep}`))
  const dependencyGraph = new Map([...modules.keys()].map((name) => [name, new Set()]))
  for (const file of [...walk(sourceRoot), ...walk(path.join(root, "server"))].filter((file) => sourcePattern.test(file) && !isTest(file))) {
    const source = ownerOf(file)
    const layer = source ? normalize(path.relative(source.directory, file)).split("/")[0] : null
    if (layer === "domain") for (const global of domainPlatformCalls(file))
      errors.push(`${normalize(path.relative(root, file))}: ${global} — domain cannot call platform globals`)
    for (const specifier of importsOf(file)) {
      if (specifier === null) {
        if (source)
          errors.push(
            `${normalize(path.relative(root, file))}: non-literal import cannot be boundary-checked`,
          )
        continue
      }
      const targetPath = resolveImport(file, specifier, sourceRoot)
      const target = targetPath ? ownerOf(targetPath) : null
      const report = (reason) =>
        errors.push(`${normalize(path.relative(root, file))}: ${specifier} — ${reason}`)
      if (target && target.id !== source?.id && !target.publicFiles.includes(targetPath))
        report("imports a module's private implementation")
      if (!source) continue
      if (target && target.id !== source.id) {
        dependencyGraph.get(source.id).add(target.id)
        if (!source.allowedModuleDependencies.includes(target.id))
          report("undeclared module dependency")
      }
      if (targetPath && !target && !packageMatches(specifier, source.allowedLegacyImports))
        report("undeclared legacy/application dependency")
      if (!targetPath && !packageMatches(specifier, source.allowedExternalImports))
        report("undeclared package dependency")
      if (
        layer === "domain" &&
        ((target &&
          (target.id !== source.id ||
            normalize(path.relative(target.directory, targetPath)).split("/")[0] !== "domain")) ||
          !targetPath ||
          !target)
      )
        report("domain must remain platform/UI independent")
      if (target?.id === source.id) {
        const targetLayer = normalize(path.relative(source.directory, targetPath)).split("/")[0]
        if (layer === "application" && ["ui", "infrastructure"].includes(targetLayer))
          report("application cannot depend on UI or adapters")
        if (layer === "infrastructure" && targetLayer === "ui")
          report("adapter cannot depend on UI")
        if (layer === "ui" && targetLayer === "infrastructure")
          report("UI must use application ports, not concrete adapters")
      }
    }
  }
  const visiting = new Set(),
    done = new Set()
  const visit = (name, stack) => {
    if (visiting.has(name)) {
      errors.push(`Module dependency cycle: ${[...stack, name].join(" -> ")}`)
      return
    }
    if (done.has(name)) return
    visiting.add(name)
    for (const next of dependencyGraph.get(name) ?? []) visit(next, [...stack, name])
    visiting.delete(name)
    done.add(name)
  }
  for (const name of modules.keys()) visit(name, [])
  return { errors, modules: modules.size }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const result = checkModuleBoundaries(root)
  if (result.errors.length) {
    console.error(result.errors.join("\n"))
    process.exitCode = 1
  } else console.log(`Module boundaries passed (${result.modules} modules)`)
}
