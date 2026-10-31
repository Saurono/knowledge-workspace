/**
 * Public parse entry point. Given one stream-json line from claude's
 * stdout, returns any assistant text it contains (or null for events
 * that carry no user-visible text: session init, tool_use, result, etc.).
 *
 * State is carried in a small closure because `assistant` events ship
 * the full in-progress message on every emission (NOT incremental), but
 * `stream_event` passthrough (emitted when --verbose is on) carries
 * real token-level deltas. To avoid double-counting, we prefer deltas
 * when they arrive and skip the fat `assistant` events after seeing one.
 */
export function createClaudeCodeStreamParser() {
  let sawDelta = false
  // Track the running text we have emitted for the current assistant
  // turn via `assistant` events so we can diff new content off the end
  // and only emit what wasn't already streamed.
  let emittedFromAssistant = ""

  return function parseLine(rawLine: string): string | null {
    const line = rawLine.trim()
    if (!line) return null

    let evt: unknown
    try {
      evt = JSON.parse(line)
    } catch {
      return null
    }

    if (!evt || typeof evt !== "object") return null
    const obj = evt as Record<string, unknown>
    const type = obj.type

    // Real streaming deltas (passthrough from Anthropic API when
    // --verbose is active on newer claude CLI versions).
    if (type === "stream_event") {
      const event = obj.event as Record<string, unknown> | undefined
      if (event?.type === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          sawDelta = true
          return delta.text
        }
      }
      return null
    }

    // Full assistant message (older CLI versions or when deltas are
    // unavailable). Ship only the portion we haven't already emitted
    // via stream_event deltas, so streaming still works smoothly.
    if (type === "assistant") {
      const message = obj.message as Record<string, unknown> | undefined
      const content = message?.content
      if (!Array.isArray(content)) return null
      const text = content
        .map((c) => {
          const cc = c as Record<string, unknown>
          return cc.type === "text" && typeof cc.text === "string" ? cc.text : ""
        })
        .join("")
      if (!text) return null

      if (sawDelta) {
        // Deltas already covered this turn; skip the fat assistant event.
        return null
      }
      if (text.startsWith(emittedFromAssistant)) {
        const novel = text.slice(emittedFromAssistant.length)
        emittedFromAssistant = text
        return novel || null
      }
      // Non-prefix change: cli sent something different than expected.
      // Reset tracker and emit the new text wholesale.
      emittedFromAssistant = text
      return text
    }

    // Ignore session init, tool_use, result summary, unknown types.
    return null
  }
}

export function extractClaudeCodeStructuredError(rawLine: string): string | null {
  const line = rawLine.trim()
  if (!line) return null
  try {
    const value = JSON.parse(line) as unknown
    if (!value || typeof value !== "object") return null
    const event = value as Record<string, unknown>
    if (event.type === "result" && event.is_error === true) {
      for (const key of ["result", "error", "message"] as const) {
        if (typeof event[key] === "string" && event[key].trim()) return event[key].trim()
      }
      return "Claude Code CLI returned an unspecified error result."
    }
    if (event.type === "error") {
      for (const key of ["error", "message", "result"] as const) {
        const field = event[key]
        if (typeof field === "string" && field.trim()) return field.trim()
        if (field && typeof field === "object") {
          const nested = field as Record<string, unknown>
          if (typeof nested.message === "string" && nested.message.trim()) {
            return nested.message.trim()
          }
        }
      }
    }
  } catch {
    return null
  }
  return null
}

export function shouldCaptureClaudeDiagnostic(rawLine: string): boolean {
  const line = rawLine.trim()
  if (!line) return false
  try {
    const value = JSON.parse(line) as unknown
    if (!value || typeof value !== "object") return true
    const event = value as Record<string, unknown>
    return (
      event.is_error === true ||
      (typeof event.type === "string" && event.type.toLowerCase().includes("error")) ||
      extractClaudeCodeStructuredError(line) !== null
    )
  } catch {
    return true
  }
}

export function createBoundedDiagnosticBuffer(capacity = 4096) {
  let buffer = ""
  return {
    append(line: string) {
      const trimmed = line.trim()
      if (!trimmed || capacity <= 0) return
      const incomingCharacters = Array.from(trimmed)
      const incoming =
        incomingCharacters.length > capacity
          ? incomingCharacters.slice(incomingCharacters.length - capacity).join("")
          : trimmed
      const combined = buffer ? `${buffer}\n${incoming}` : incoming
      const characters = Array.from(combined)
      buffer =
        characters.length > capacity
          ? characters.slice(characters.length - capacity).join("")
          : combined
    },
    value() {
      return buffer
    },
  }
}

/**
 * Translate `claude` CLI exit-with-stderr into an actionable error
 * message for the user. The bare "exited with code N: <stderr>"
 * we used to throw was correct but unactionable — users had to
 * read JSON-shaped stderr text to figure out what to do.
 *
 * Three diagnostic sources, used in priority order:
 *   1. stderr — the canonical place. The most common content is
 *      `Unauthenticated:` from Claude Code itself, meaning the
 *      user's ~/.claude OAuth token expired / was revoked / they
 *      logged out. We surface that case explicitly because users
 *      otherwise mis-diagnose it as an LLM Wiki bug.
 *   2. unparsedStdout — stdout lines the parser didn't recognize
 *      (non-JSON, unknown event types, the stream-json `error`
 *      event shape). Used as a fallback when stderr is empty —
 *      claude sometimes writes its real diagnostic to stdout via
 *      the stream-json channel, and our parser silently drops
 *      anything it doesn't classify, leaving users with no info
 *      at all.
 *   3. Neither — silent exit. We can't help much here other than
 *      telling the user to reproduce in a terminal where they can
 *      see whatever output the CLI does produce.
 */
export function buildExitError(code: number, stderr: string, unparsedStdout: string = ""): string {
  const diagnostic = [stderr, unparsedStdout].filter(Boolean).join("\n")
  if (
    /unauthenticated|failed\s+to\s+authenticate|please.*log\s*in|authentication.*failed|oauth.*(?:expired|revoked)/i.test(
      diagnostic,
    )
  ) {
    return [
      "Claude Code CLI is not authenticated.",
      "Please open a terminal and run `claude` to complete the OAuth login,",
      "then retry. (LLM Wiki only spawns the binary — it can't run the",
      "login flow on your behalf.)",
      diagnostic ? `\n\n— diagnostic —\n${diagnostic}` : "",
    ]
      .join(" ")
      .trim()
  }
  if (stderr) {
    return `claude CLI exited with code ${code}: ${stderr}`
  }
  if (unparsedStdout.trim()) {
    return [
      `claude CLI exited with code ${code} (no stderr).`,
      "Captured stdout output that LLM Wiki couldn't parse — pasting it",
      "here so you can see what the CLI actually emitted:\n",
      unparsedStdout.trim(),
    ].join(" ")
  }
  return [
    `claude CLI exited silently with code ${code}.`,
    "No stdout or stderr was captured — try running `claude -p` in a",
    "terminal with the same prompt to see what's wrong, or switch to",
    "the official Anthropic API in Settings.",
  ].join(" ")
}
