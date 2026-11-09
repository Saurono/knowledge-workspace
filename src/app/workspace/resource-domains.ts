import { fileExists } from "@/commands/fs"
import { readLocalSourceTimes } from "./source-times"
import { canonicalDomainResourceKey } from "@/modules/domains/domain"
import { getRelativePath, isAbsolutePath, normalizePath } from "@/lib/path-utils"

export type LocalDomainResource =
  | { kind: "wiki"; path: string }
  | { kind: "document"; path: string }

export interface ResolvedLocalDomainResource {
  canonicalKey: string
  /** Legacy keys are returned only after matching the exact catalog entry. */
  legacyKeys: string[]
  receivedAt: string | null
  sourceIngestedAt: string | null
  revisionIngestedAt: string | null
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
    return { canonicalKey, legacyKeys: [], receivedAt: null, sourceIngestedAt: null, revisionIngestedAt: null }
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

  let metadata = (await readLocalSourceTimes(root, [canonicalAbsolute]))[canonicalAbsolute]
  if (!metadata && options.registerExistingSource) {
    // Registration is an explicit assignment side effect and happens only after
    // proving the physical source exists. Reads and filters never allocate IDs.
    const { registerImportedSource } = await import("@/app/document-records/documents")
    await registerImportedSource(root, canonicalAbsolute, canonicalAbsolute)
    metadata = (await readLocalSourceTimes(root, [canonicalAbsolute]))[canonicalAbsolute]
  }
  if (!metadata) return null
  const canonicalKey = canonicalDomainResourceKey("document", metadata.id)
  return { canonicalKey, legacyKeys: [sourceRelative], receivedAt: metadata.receivedAt, sourceIngestedAt: metadata.sourceIngestedAt, revisionIngestedAt: metadata.revisionIngestedAt }
}

/** Resolve a batch of already discovered leaves with one catalog read and no identity writes. */
export async function resolveLocalDomainResources(
  projectPath: string,
  resources: readonly LocalDomainResource[],
): Promise<(ResolvedLocalDomainResource | null)[]> {
  const root = normalizePath(projectPath).replace(/\/+$/, "")
  const documentPaths = resources.filter((resource): resource is Extract<LocalDomainResource, { kind: "document" }> => resource.kind === "document")
    .map(resource => isAbsolutePath(resource.path) ? normalizePath(resource.path) : `${root}/${safeRelative(resource.path)}`)
  const metadata = documentPaths.length ? await readLocalSourceTimes(root, documentPaths) : {}
  return Promise.all(resources.map(async (resource) => {
    if (resource.kind === "wiki") {
      const canonicalKey = canonicalDomainResourceKey("wiki", resource.path)
      if (!(await fileExists(`${root}/${canonicalKey}`))) return null
      return { canonicalKey, legacyKeys: [], receivedAt: null, sourceIngestedAt: null, revisionIngestedAt: null }
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
    const source = metadata[canonicalAbsolute]
    if (!source) return null
    return { canonicalKey: canonicalDomainResourceKey("document", source.id), legacyKeys: [sourceRelative], receivedAt: source.receivedAt, sourceIngestedAt: source.sourceIngestedAt, revisionIngestedAt: source.revisionIngestedAt }
  }))
}
