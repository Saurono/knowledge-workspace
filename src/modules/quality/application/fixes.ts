import { stubRelativePathFromBrokenTarget, stubTitleFromBrokenTarget } from "../domain/fixes"
import { inferWikiTypeFromPath, makeQuerySlug } from "@/modules/wiki/domain"
export interface StubPorts {
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
  create(projectPath: string, path: string, content: string): Promise<boolean>
  today(): string
}
export function createStubService(ports: StubPorts) {
  async function ensureBrokenLinkStub(
    projectPath: string,
    brokenTarget: string,
  ): Promise<{ fullPath: string; relativePath: string; created: boolean }> {
    const relativePath = stubRelativePathFromBrokenTarget(brokenTarget, makeQuerySlug)
    const fullPath = `${projectPath}/wiki/${relativePath}`
    if (await ports.exists(fullPath)) {
      return { fullPath, relativePath, created: false }
    }

    const parent = fullPath.split("/").slice(0, -1).join("/")
    await ports.mkdir(parent)
    const title = stubTitleFromBrokenTarget(brokenTarget)
    const date = ports.today()
    const pageType = inferWikiTypeFromPath(`wiki/${relativePath}`) ?? "query"
    const content = [
      "---",
      `type: ${pageType}`,
      `title: "${title.replace(/"/g, '\\"')}"`,
      `created: ${date}`,
      `updated: ${date}`,
      "tags: [stub, lint]",
      "related: []",
      "sources: []",
      "---",
      "",
      `# ${title}`,
      "",
      "Created by Wiki Lint as a placeholder for a missing wikilink target.",
      "",
    ].join("\n")
    const created = await ports.create(projectPath, `wiki/${relativePath}`, content)
    return { fullPath, relativePath, created }
  }
  return { ensureBrokenLinkStub, stubRelativePathFromBrokenTarget: (target: string) => stubRelativePathFromBrokenTarget(target, makeQuerySlug) }
}
