import { realpath, readFile, stat } from "node:fs/promises"
import { resolve, extname, sep } from "node:path"
import type { ServerResponse } from "node:http"
export async function serveWeb(root: string, pathname: string, response: ServerResponse) {
  let decoded: string
  try { decoded = decodeURIComponent(pathname) } catch { return false }
  if (decoded.includes("\0") || decoded.includes("\\")) return false
  try {
    const base = await realpath(root), target = await realpath(resolve(base, "." + (decoded === "/" ? "/web.html" : decoded)))
    if (!target.startsWith(base + sep) || !(await stat(target)).isFile()) return false
    const type: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml" }
    const body = await readFile(target)
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' http://127.0.0.1:*; base-uri 'none'; frame-ancestors 'none'")
    response.writeHead(200, { "Content-Type": type[extname(target)] ?? "application/octet-stream" }); response.end(body); return true
  } catch { return false }
}
