import { createClaudeCodeStreamParser, extractClaudeCodeStructuredError, shouldCaptureClaudeDiagnostic, createBoundedDiagnosticBuffer, buildExitError } from "../domain"
import type { CliMessage, CliModelConfig } from "../domain"
import type { CliCallbacks, CliOverrides, CliTransportPorts } from "./ports"
export function createClaudeCliTransport(ports: CliTransportPorts) {
  type SpawnPayload = Record<string, unknown> & {
    streamId: string
    model: string
    messages: CliMessage[]
    isolateLocalConfig: boolean
    workingDirectory: string
  }

  /**
   * Subprocess equivalent of the HTTP path in streamChat. Obeys the same
   * CliCallbacks contract so chat-panel code doesn't need to know
   * which transport it's talking to.
   */
  async function streamClaudeCodeCli(
    config: CliModelConfig,
    messages: CliMessage[],
    callbacks: CliCallbacks,
    signal?: AbortSignal,
    overrides?: CliOverrides,
  ): Promise<void> {
    const { onToken, onDone, onError } = callbacks

    // Sampling knobs aren't wired through the Claude Code CLI (no flag
    // equivalents for temperature/top_p/max_tokens/stop). Warn loudly in
    // dev so a caller wiring these up doesn't silently wonder why they
    // don't take effect; keep quiet in prod so regular users aren't
    // alarmed by a reasonable default.
    if (ports.development && overrides) {
      for (const key of ["temperature", "top_p", "top_k", "max_tokens", "stop"] as const) {
        if (overrides[key] !== undefined) {
          // eslint-disable-next-line no-console
          console.warn(
            `[claude-code] ignoring unsupported override "${key}": CLI has no equivalent flag`,
          )
        }
      }
    }

    const streamId = ports.createId()
    const parse = createClaudeCodeStreamParser()

    let unlistenData: (() => void) | undefined
    let unlistenDone: (() => void) | undefined
    let finished = false
    let aborted = signal?.aborted ?? false
    // Track whether any assistant text was received — used to detect the
    // silent-exit case where the CLI exits 0 but emits no content.
    let emittedToken = false
    let structuredError = ""
    // Completion promise: resolves when finishWith() fires so the caller
    // awaits the full round-trip rather than returning after spawn.
    let resolveCompletion: () => void = () => {}
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve
    })

    // Keep only protocol-level errors and non-JSON diagnostics. Normal lifecycle
    // and hook events are intentionally excluded so they cannot crowd the real
    // exit error out of this bounded tail buffer.
    const diagnosticBuffer = createBoundedDiagnosticBuffer()

    const cleanup = () => {
      unlistenData?.()
      unlistenDone?.()
    }

    const finishWith = (cb: () => void) => {
      if (finished) return
      finished = true
      cleanup()
      cb()
      resolveCompletion()
    }

    const abortListener = () => {
      aborted = true
      void ports.process.kill(streamId).catch(() => {
        // Kill is best-effort; if the process already exited, the Rust
        // side returns Ok and the done handler fires normally.
      })
      finishWith(onDone)
    }
    if (aborted) {
      finishWith(onDone)
      return
    }
    signal?.addEventListener("abort", abortListener)

    try {
      const workingDirectory = ports.workingDirectory()
      if (!workingDirectory) {
        throw new Error("Claude Code CLI requires an active project working directory")
      }

      // Listen FIRST so we don't miss the very first event on fast CLIs.
      // The active-project guard above is intentionally earlier: without
      // a valid project CWD we will not spawn, so no CLI events can race.
      unlistenData = await ports.events.listen<string>(`claude-cli:${streamId}`, (event) => {
        if (finished || aborted) return
        const eventError = extractClaudeCodeStructuredError(event.payload)
        if (eventError) structuredError = eventError
        const token = parse(event.payload)
        if (token !== null) {
          emittedToken = true
          onToken(token)
        } else if (!eventError && shouldCaptureClaudeDiagnostic(event.payload)) {
          // Preserve the newest diagnostic in case stderr is empty.
          diagnosticBuffer.append(event.payload)
        }
      })
      if (aborted || finished) {
        cleanup()
        return
      }

      unlistenDone = await ports.events.listen<{ code: number | null; stderr: string }>(
        `claude-cli:${streamId}:done`,
        (event) => {
          if (finished || aborted) return
          const code = event.payload?.code
          const stderr = event.payload?.stderr?.trim() ?? ""
          if (code !== null && code !== undefined && code !== 0) {
            finishWith(() =>
              onError(
                new Error(buildExitError(code, stderr, structuredError || diagnosticBuffer.value())),
              ),
            )
          } else if (structuredError) {
            finishWith(() => onError(new Error(buildExitError(code ?? 1, stderr, structuredError))))
          } else if (!emittedToken) {
            // CLI exited successfully but produced no assistant text.
            // Surface this as an explicit error so the ingest pipeline
            // retries rather than silently writing an empty stub page.
            const details = stderr || diagnosticBuffer.value()
            finishWith(() =>
              onError(
                new Error(
                  details
                    ? `Claude Code CLI completed but returned no content:\n${details}`
                    : "Claude Code CLI completed but returned no content. Try running `claude -p` in a terminal to inspect the output, or switch to the Anthropic API in Settings.",
                ),
              ),
            )
          } else {
            finishWith(onDone)
          }
        },
      )
      if (aborted || finished) {
        cleanup()
        return
      }

      const payload: SpawnPayload = {
        streamId,
        model: config.model,
        messages,
        isolateLocalConfig: config.localCliIsolation === true,
        workingDirectory,
      }
      await ports.process.spawn(payload)
      if (aborted || signal?.aborted) {
        aborted = true
        await ports.process.kill(streamId).catch(() => {})
        finishWith(onDone)
        return
      }
      // Wait for the done event to be processed before returning.
      // Without this await the caller sees an empty analysis buffer
      // because streamClaudeCodeCli() resolves immediately after spawn
      // while the CLI subprocess is still running. (Same race that was
      // fixed for the Codex CLI transport in #238.)
      await completion
    } catch (err) {
      finishWith(() => {
        const message = err instanceof Error ? err.message : String(err)
        // Surface the classic "CLI not installed" case as an actionable
        // message — the Rust side returns a plain string from
        // spawn-failed, but users need to know to install claude.
        if (/not found|No such file|executable file not found/i.test(message)) {
          onError(
            new Error(
              "Claude Code CLI not found. Install `claude` (https://www.anthropic.com/claude-code) or pick a different provider.",
            ),
          )
        } else {
          onError(err instanceof Error ? err : new Error(message))
        }
      })
    } finally {
      signal?.removeEventListener("abort", abortListener)
    }
  }
  return { streamClaudeCodeCli }
}
