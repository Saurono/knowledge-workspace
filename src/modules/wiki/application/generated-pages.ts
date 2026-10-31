import { canonicalWikiPagePath } from "../domain/page"
import type { WikiCommitContext } from "./commit"
export interface GeneratedPageDraft {
  title: string
  dir: string
  fileName: string
  pageType: string
  date: string
  pageContent: string
}
export interface PublishedPage extends GeneratedPageDraft {
  path: string
}

/** Find a free name while the caller owns the commit; write before allocating again. */
export async function findAvailableWikiPath(
  commit: WikiCommitContext,
  path: string,
): Promise<string> {
  const canonical = canonicalWikiPagePath(path)
  if (!(await commit.exists(canonical))) return canonical
  const stem = canonical.slice(0, -3)
  for (let suffix = 2; suffix <= 10_000; suffix++) {
    const candidate = `${stem}-${suffix}.md`
    if (!(await commit.exists(candidate))) return candidate
  }
  throw new Error(`No available Wiki filename for ${canonical}`)
}
async function readOrDefault(commit: WikiCommitContext, path: string, fallback: string) {
  return (await commit.exists(path)) ? commit.read(path) : fallback
}
/** Pages and their navigation are serialized together, with no multi-file rollback. */
export async function publishGeneratedPages(
  commit: WikiCommitContext,
  drafts: readonly GeneratedPageDraft[],
  logEntry: (pages: readonly PublishedPage[]) => string,
): Promise<PublishedPage[]> {
  if (drafts.length === 0) return []
  let index = await readOrDefault(commit, "wiki/index.md", "# Wiki Index\n")
  const log = await readOrDefault(commit, "wiki/log.md", "# Wiki Log\n")
  const pages: PublishedPage[] = []
  for (const draft of drafts) {
    const path = await findAvailableWikiPath(commit, `wiki/${draft.dir}/${draft.fileName}`)
    const fileName = path.split("/").pop()!
    await commit.write(path, draft.pageContent)
    const page = { ...draft, fileName, path }
    pages.push(page)
    const header = `## ${draft.dir.charAt(0).toUpperCase() + draft.dir.slice(1)}`
    const entry = `- [[${draft.dir}/${fileName.replace(/\.md$/, "")}|${draft.title}]]`
    const newline = index.includes("\r\n") ? "\r\n" : "\n"
    const lines = index.split(/\r?\n/)
    const heading = lines.findIndex((line) => line === header)
    if (heading >= 0) {
      lines.splice(heading + 1, 0, entry)
      index = lines.join(newline)
    } else index = `${index.trimEnd()}${newline}${newline}${header}${newline}${entry}${newline}`
  }
  await commit.write("wiki/index.md", index)
  await commit.write("wiki/log.md", `${log.trimEnd()}\n${logEntry(pages)}\n`)
  return pages
}
