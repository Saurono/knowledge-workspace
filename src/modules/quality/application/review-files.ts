export interface ReviewFilePort { read(path: string): Promise<string>; remove(path: string): Promise<void> }
const normalize = (path: string) => path.replace(/\\/g, "/")
function owned(root: string, path: string) {
  const prefix = `${normalize(root).replace(/\/+$/, "")}/`, normalized = normalize(path)
  if (!normalized.startsWith(prefix)) throw new Error("Review file is outside its project")
  const relative = normalized.slice(prefix.length)
  if (relative.split("/").some(part => !part || part === "." || part === "..") || relative.includes("\0")) throw new Error("Invalid review file path")
  return normalized
}
export function createReviewFiles(port: ReviewFilePort) {
  return {
    async open(root: string, page: string) {
      const project = normalize(root).replace(/\/+$/, ""), path = normalize(page)
      const absolute = path.startsWith("/") || /^[a-z]:\//i.test(path)
      const candidates = absolute ? [owned(root, path)]
        : path.startsWith("wiki/") || path.startsWith("raw/")
          ? [owned(root, `${project}/${path}`), owned(root, `${project}/${path}.md`)]
          : [owned(root, `${project}/wiki/${path}`), owned(root, `${project}/wiki/${path}.md`)]
      for (const path of candidates) {
        try { return { path, content: await port.read(path) } }
        catch { /* Preserve resolver fallback for missing/unreadable candidates. */ }
      }
      return null
    },
    remove: (root: string, path: string) => port.remove(owned(root, path)),
  }
}
