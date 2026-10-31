import { useRef, useEffect, useMemo, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"
import { ChevronRight, ChevronDown } from "lucide-react"
import { detectLanguage } from "@/lib/detect-language"
import { getHtmlLang, getTextDirection } from "@/lib/language-metadata"
import { MermaidDiagram, unwrapMermaidPre } from "@/components/mermaid-diagram"
import { useTranslation } from "react-i18next"
/** Separate <think>/<thinking> blocks from main content */
function separateThinking(text: string): { thinking: string; answer: string } {
  // Match <think>...</think> or <thinking>...</thinking>
  const thinkRegex = /^<think(?:ing)?>([\s\S]*?)(?:<\/think(?:ing)?>|$)/i
  const match = text.match(thinkRegex)
  if (match) {
    const thinking = match[1].trim()
    const rest = text.slice(match[0].length).trim()
    return { thinking, answer: rest }
  }
  return { thinking: "", answer: text }
}

export function SynthesisBlock({
  synthesis,
  isStreaming,
}: {
  synthesis: string
  isStreaming: boolean
}) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const { thinking, answer } = useMemo(() => separateThinking(synthesis), [synthesis])
  const renderLanguage = useMemo(() => detectLanguage(answer || synthesis), [answer, synthesis])
  const direction = getTextDirection(renderLanguage)
  const htmlLang = getHtmlLang(renderLanguage)
  const [thinkingCollapsed, setThinkingCollapsed] = useState(false)

  // Auto-collapse thinking when answer starts appearing
  useEffect(() => {
    if (answer.length > 0 && thinking.length > 0 && !thinkingCollapsed) {
      setThinkingCollapsed(true)
    }
  }, [answer, thinking, thinkingCollapsed])

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [synthesis, isStreaming])

  return (
    <div className="mb-2 flex flex-col min-h-0">
      <div className="mb-1 font-medium text-muted-foreground">{t("research.synthesis")}</div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded bg-muted/30 p-2 prose prose-xs prose-invert max-w-none"
        dir={direction}
        lang={htmlLang}
        style={{ maxHeight: "calc(100vh - 400px)", minHeight: "120px", textAlign: "start" }}
      >
        {thinking && (
          <div className="mb-2">
            <button
              onClick={() => setThinkingCollapsed((v) => !v)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {thinkingCollapsed ? (
                <ChevronRight className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              {t("research.thinking")}
              {isStreaming && !answer ? "..." : ""}
            </button>
            {!thinkingCollapsed && (
              <div className="mt-1 rounded border border-muted px-2 py-1 text-[10px] text-muted-foreground opacity-70 leading-relaxed whitespace-pre-wrap">
                {isStreaming && !answer ? thinking.split("\n").slice(-5).join("\n") : thinking}
              </div>
            )}
          </div>
        )}
        {answer && (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              table: ({ children, ...props }) => (
                <div className="my-2 overflow-x-auto rounded border border-border">
                  <table className="w-full border-collapse text-xs" {...props}>
                    {children}
                  </table>
                </div>
              ),
              thead: ({ children, ...props }) => (
                <thead className="bg-muted" {...props}>
                  {children}
                </thead>
              ),
              th: ({ children, ...props }) => (
                <th
                  className="border border-border/80 px-3 py-1.5 text-start font-semibold bg-muted"
                  {...props}
                >
                  {children}
                </th>
              ),
              td: ({ children, ...props }) => (
                <td className="border border-border/60 px-3 py-1.5" {...props}>
                  {children}
                </td>
              ),
              pre: ({ children, ...props }) => {
                const mermaid = unwrapMermaidPre(children)
                if (mermaid) return <>{mermaid}</>
                return (
                  <pre dir="ltr" style={{ textAlign: "left" }} {...props}>
                    {children}
                  </pre>
                )
              },
              code: ({ className, children, ...props }) => {
                const lang = className?.replace("language-", "")
                const codeText = String(children).replace(/\n$/, "")
                if (lang === "mermaid") return <MermaidDiagram code={codeText} />
                return (
                  <code dir="ltr" className={className} {...props}>
                    {children}
                  </code>
                )
              },
            }}
          >
            {answer}
          </ReactMarkdown>
        )}
        {isStreaming && <span className="animate-pulse">▊</span>}
      </div>
    </div>
  )
}
