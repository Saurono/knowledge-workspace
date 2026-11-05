import { fileExists } from "@/commands/fs"
import { documents } from "@/app/document-records/documents"
import { canonicalDomainResourceKey } from "@/modules/domains/domain"
import { getRelativePath, isAbsolutePath, normalizePath } from "@/lib/path-utils"

export type LocalDomainResource =
  | { kind: "wiki"; path: string }
  | { kind: "document"; path: string }

export interface ResolvedLocalDomainResource {
  canonicalKey: string
  /** Legacy keys are returned only after matching the exact catalog entry. */
  legacyKeys: string[]
}

function fail(message: string, code: "invalid_argument" | "not_found" = "invalid_argument"): never {
  throw Object.assign(new Error(message), { code })
}

function safeRelative(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  if (!normalized || normalized.includes("\0") || /[\x01-\x1f\x7f]/.test(normalized) ||
      normalized.split("/").some((part) => !part || part === "." || part === ".."))
    return fail("Invalid local domain resource path")
  return normalized
}

/** Resolve without creating source identity unless the caller explicitly asks to assign. */
export async function resolveLocalDomainResource(
  projectPath: string,
  resource: LocalDomainResource,
  options: { registerExistingSource?: boolean } = {},
): Promise<ResolvedLocalDomainResource | null> {
  const root = normalizePath(projectPath).replace(/\/+$/, "")
  if (resource.kind === "wiki") {
    const canonicalKey = canonicalDomainResourceKey("wiki", resource.path)
    if (!(await fileExists(`${root}/${canonicalKey}`))) return null
    return { canonicalKey, legacyKeys: [] }
  }

  const absolute = isAbsolutePath(resource.path)
    ? normalizePath(resource.path)
    : `${root}/${safeRelative(resource.path)}`
  const prefix = `${root}/raw/sources/`
  const windowsPath = /^[A-Za-z]:\//.test(root) || root.startsWith("//")
  const comparable = (value: string) => windowsPath ? value.toLowerCase() : value
  if (!comparable(absolute).startsWith(comparable(prefix))) return fail("Document domain assignment must target a project raw/sources file")
  const sourceRelative = safeRelative(getRelativePath(absolute, root))
  if (!sourceRelative.startsWith("raw/sources/")) return fail("Document domain assignment must target raw/sources")
  const canonicalAbsolute = `${root}/${sourceRelative}`
  if (!(await fileExists(canonicalAbsolute))) return null

  let catalog = await documents.list(root)
  let provenance = catalog[canonicalAbsolute]
  if (!provenance && options.registerExistingSource) {
    // Registration is an explicit assignment side effect and happens only after
    // proving the physical source exists. Reads and filters never allocate IDs.
    await documents.registerImportedSource(root, canonicalAbsolute, canonicalAbsolute)
    catalog = await documents.list(root)
    provenance = catalog[canonicalAbsolute]
  }
  if (!provenance) return null
  const canonicalKey = canonicalDomainResourceKey("document", provenance.id)
  return { canonicalKey, legacyKeys: [sourceRelative] }
}
