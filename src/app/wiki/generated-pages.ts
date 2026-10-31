import { publishGeneratedPages } from "@/modules/wiki/application"
import {
  cleanAssistantContentForWikiSave,
  titleFromCleanAssistantContent,
} from "@/lib/chat-save-to-wiki"
import { makeQueryFileName } from "@/lib/wiki-filename"
import { availableReviewPageFileName, type ReviewPageDraft } from "@/lib/review-create-page"
import { normalizePath } from "@/lib/path-utils"
import { wikiCommits } from "./commit"

export async function saveGeneratedQuery(projectPath: string, content: string) {
  const clean = cleanAssistantContentForWikiSave(content)
  const title = titleFromCleanAssistantContent(clean)
  const { date, fileName } = makeQueryFileName(title)
  const pageContent = `---\ntype: query\ntitle: "${title.replace(/"/g, '\\"')}"\ncreated: ${date}\ntags: []\n---\n\n${clean}`
  return wikiCommits.run(projectPath, async (commit) => {
    const [page] = await publishGeneratedPages(
      commit,
      [{ title, dir: "queries", pageType: "query", date, fileName, pageContent }],
      (pages) => `- ${date}: Saved query page \`${pages[0].fileName}\``,
    )
    return { ...page, filePath: `${normalizePath(projectPath).replace(/\/+$/, "")}/${page.path}` }
  })
}
export async function saveGeneratedReviewPages(
  projectPath: string,
  drafts: readonly ReviewPageDraft[],
  description: string,
) {
  return wikiCommits.run(projectPath, async (commit) => {
    const prepared = []
    const reserved = new Set<string>()
    for (const draft of drafts) {
      const { date, fileName } = await availableReviewPageFileName(draft.title, (candidate) => {
        const path = `wiki/${draft.dir}/${candidate}`
        return reserved.has(path) ? Promise.resolve(true) : commit.exists(path)
      })
      reserved.add(`wiki/${draft.dir}/${fileName}`)
      const frontmatter = `---\ntype: ${draft.pageType}\ntitle: "${draft.title.replace(/"/g, '\\"')}"\ncreated: ${date}\ntags: []\nrelated: []\n---\n\n`
      prepared.push({
        ...draft,
        date,
        fileName,
        pageContent: `${frontmatter}# ${draft.title}\n\n${description}\n`,
      })
    }
    const pages = await publishGeneratedPages(commit, prepared, (created) => {
      const names = created.map((page) => `\`${page.fileName}\``).join(", ")
      return `- ${created[0]?.date}: Created ${created.length} page${created.length === 1 ? "" : "s"} from review: ${names}`
    })
    return pages.map((page) => ({
      ...page,
      filePath: `${normalizePath(projectPath).replace(/\/+$/, "")}/${page.path}`,
    }))
  })
}
