import { readFile, listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { parseFrontmatter } from "@/lib/frontmatter"
import { createRetrievalGraphService } from "@/modules/retrieval/application"
export const { buildRetrievalGraph, calculateRelevance, getRelatedNodes, clearGraphCache } = createRetrievalGraphService({
  read: path => readFile(path), list: path => listDirectory(path), normalizePath, parseFrontmatter,
})
