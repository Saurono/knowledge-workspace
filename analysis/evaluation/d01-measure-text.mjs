#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_LUNA = resolve(SCRIPT_DIR, "artifacts/d01-luna-initial.patch")
const DEFAULT_CONTROL = resolve(SCRIPT_DIR, "artifacts/d01-primary-control-initial.patch")
const DEFAULT_BRIEF = resolve(SCRIPT_DIR, "d01-trial-brief.md")

function parseArgs(argv) {
  const options = { luna: DEFAULT_LUNA, control: DEFAULT_CONTROL, brief: DEFAULT_BRIEF, output: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!["--luna", "--control", "--brief", "--output"].includes(arg)) throw new Error(`Unknown argument: ${arg}`)
    const value = argv[i + 1]
    if (!value || value.startsWith("--")) throw new Error(`Expected a value after ${arg}`)
    options[arg.slice(2)] = resolve(value)
    i += 1
  }
  return options
}

function classify(path) {
  const normalized = path.replaceAll("\\", "/")
  const base = normalized.split("/").at(-1) ?? ""
  if (base === "module-audit-v1.json") return "audit"
  if (/\.(test|spec)\.tsx?$/.test(base) || /\.(test|spec)\.tsx?$/.test(normalized)) return "tests"
  if (/\.md$/i.test(base)) return "documentation"
  if (/\.(ts|tsx|json)$/i.test(base)) return "implementation"
  return "other"
}

function addedContentByCategory(patch) {
  const categories = Object.fromEntries(["implementation", "tests", "documentation", "audit", "other"].map(name => [name, { text: "", addedLines: 0 }]))
  let currentPath = null
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      currentPath = line.slice(4)
      continue
    }
    if (line.startsWith("diff --git ")) {
      currentPath = null
      continue
    }
    if (currentPath && line.startsWith("+") && !line.startsWith("+++")) {
      const category = classify(currentPath.replace(/^[ab]\//, ""))
      categories[category].text += `${line.slice(1)}\n`
      categories[category].addedLines += 1
    }
  }
  return categories
}

function tokenCount(encode, text) {
  const result = encode(text)
  if (Array.isArray(result) || ArrayBuffer.isView(result)) return result.length
  if (typeof result === "number" && Number.isFinite(result)) return result
  throw new Error("Tokenizer encode(text) returned an unsupported value")
}

async function loadTokenizer() {
  const modulePath = process.env.D01_TOKENIZER_MODULE
  if (!modulePath) throw new Error("D01_TOKENIZER_MODULE is required; install gpt-tokenizer and set it to the absolute path of its o200k_base encoding module")
  if (!isAbsolute(modulePath)) throw new Error("D01_TOKENIZER_MODULE must be an absolute path to the o200k_base encoding module")
  let tokenizer
  try {
    tokenizer = await import(pathToFileURL(modulePath).href)
  } catch (cause) {
    throw new Error(`Could not load o200k_base tokenizer module at ${modulePath}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  const encode = tokenizer.encode ?? tokenizer.default?.encode ?? (typeof tokenizer.default === "function" ? tokenizer.default : null)
  if (typeof encode !== "function") throw new Error(`Tokenizer module at ${modulePath} does not export an encode function`)
  return encode
}

function measureAddedCategories(encode, categories) {
  return Object.fromEntries(Object.entries(categories).map(([name, value]) => [name, {
    o200kBaseBpeTokens: tokenCount(encode, value.text.endsWith("\n") ? value.text.slice(0, -1) : value.text),
    utf8Bytes: Buffer.byteLength(value.text.endsWith("\n") ? value.text.slice(0, -1) : value.text, "utf8"),
    addedLines: value.addedLines,
  }]))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const encode = await loadTokenizer()
  const [lunaPatch, controlPatch, brief] = await Promise.all([
    readFile(options.luna, "utf8"),
    readFile(options.control, "utf8"),
    readFile(options.brief, "utf8"),
  ])
  const measurePatch = patch => ({
    wholePatch: {
      o200kBaseBpeTokens: tokenCount(encode, patch),
      utf8Bytes: Buffer.byteLength(patch, "utf8"),
    },
    addedLinesByCategory: measureAddedCategories(encode, addedContentByCategory(patch)),
  })
  const result = {
    metadata: {
      measure: "visible_text_proxy_not_billing_usage",
      tokenizer: "o200k_base BPE",
      source: "patch added text and shared brief",
      actualInputTokens: null,
      actualOutputTokens: null,
      actualReasoningTokens: null,
      actualCacheTokens: null,
    },
    luna: measurePatch(lunaPatch),
    control: measurePatch(controlPatch),
    sharedBrief: {
      o200kBaseBpeTokens: tokenCount(encode, brief),
      utf8Bytes: Buffer.byteLength(brief, "utf8"),
    },
  }
  const output = `${JSON.stringify(result, null, 2)}\n`
  if (options.output) await writeFile(options.output, output, "utf8")
  else process.stdout.write(output)
}

main().catch(error => {
  process.stderr.write(`d01-measure-text: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
