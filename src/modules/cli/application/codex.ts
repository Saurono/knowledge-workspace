import { parseCodexCliLine, buildPrompt } from "../domain"
import type { CliMessage, CliModelConfig } from "../domain"
import type { CliCallbacks, CliOverrides, CliTransportPorts } from "./ports"
export function createCodexCliTransport(ports: CliTransportPorts) {
  type SpawnPayload = Record<string, unknown> & {
    streamId: string
    model: string
    prompt: string
    isolateLocalConfig: boolean
    timeoutMinutes?: number
    workingDirectory?: string
  }

  async function streamCodexCli(
    config: CliModelConfig,
    messages: CliMessage[],
    callbacks: CliCallbacks,
    signal?: AbortSignal,
    overrides?: CliOverrides,
  ): Promise<void> {
    const { onToken, onDone, onError } = callbacks

    if (ports.development && overrides) {
      for (const key of ["temperature", "top_p", "top_k", "max_tokens", "stop"] as const) {
        if (overrides[key] !== undefined) {
          // eslint-disable-next-line no-console
          console.warn(
            `[codex-cli] ignoring unsupported override "${key}": CLI has no equivalent flag`,
          )
        }
      }
    }

    const streamId = ports.createId()
    let unlistenData: (() => void) | undefined
    let unlistenDone: (() => void) | undefined
    let finished = false
    let aborted = signal?.aborted ?? false
    let emittedAgentMessage = false
    let resolveCompletion: () => void = () => {}
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve
    })

    const unparsedLines: string[] = []
    let unparsedSize = 0
    function captureUnparsed(line: string) {
      if (unparsedSize >= 4096) return
      const trimmed = line.trim()
      if (!trimmed) return
      unparsedLines.push(line)
      unparsedSize += line.length + 1
    }

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

    const replayAgentMessagesFromStdout = (stdout: string | undefined) => {
      if (!stdout) return

      for (const line of stdout.split(/\r?\n/)) {
        const token = parseCodexCliLine(line)
        if (token !== null) {
          emittedAgentMessage = true
          onToken(token)
        }
      }
    }

    const abortListener = () => {
      aborted = true
      void ports.process.kill(streamId).catch(() => {})
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
        throw new Error("Codex CLI requires an active project working directory")
      }

      unlistenData = await ports.events.listen<string>(`codex-cli:${streamId}`, (event) => {
        if (finished || aborted) return
        const token = parseCodexCliLine(event.payload)
        if (token !== null) {
          emittedAgentMessage = true
          onToken(token)
        } else {
          captureUnparsed(event.payload)
        }
      })
      if (aborted || finished) {
        cleanup()
        return
      }

      unlistenDone = await ports.events.listen<{
        code: number | null
        stderr: string
        stdout?: string
        timedOut?: boolean
        timeoutMinutes?: number
      }>(`codex-cli:${streamId}:done`, (event) => {
        if (finished || aborted) return
        const code = event.payload?.code
        const stderr = event.payload?.stderr?.trim() ?? ""
        const stdout = event.payload?.stdout ?? ""
        // Checked before `code`, and before the agent_message branch below.
        // The timeout task takes the child handle away in order to kill it, so
        // `code` is null here regardless of how the process ended. The
        // exit-code branch skips null outright, and the branch after it calls
        // onDone once any agent message has arrived, so a timeout that had
        // already produced partial output would be reported as a success.
        if (event.payload?.timedOut) {
          const minutes = event.payload.timeoutMinutes
          const limit = typeof minutes === "number" ? `${minutes} minute` : "configured"
          const details = stderr || stdout.trim()
          // Only stderr was consulted first; say which stream this actually is.
          const label = stderr ? "stderr" : "stdout"
          finishWith(() =>
            onError(
              new Error(
                [
                  `Codex CLI did not report completion within the ${limit} timeout, so LLM Wiki stopped waiting.`,
                  "Raise the Codex CLI timeout for this preset in Settings",
                  "(1-240 minutes), or shorten the prompt.",
                  details ? `\n\n— ${label} —\n${details}` : "",
                ]
                  .join(" ")
                  .trim(),
              ),
            ),
          )
          return
        }
        if (code !== null && code !== undefined && code !== 0) {
          const details = stderr || stdout.trim() || unparsedLines.join("\n")
          finishWith(() =>
            onError(
              new Error(
                details
                  ? `Codex CLI exited with code ${code}:\n${details}`
                  : `Codex CLI exited with code ${code}. Run \`codex\` in a terminal to inspect the problem.`,
              ),
            ),
          )
        } else {
          if (!emittedAgentMessage) replayAgentMessagesFromStdout(stdout)
          if (!emittedAgentMessage) {
            const details = stdout.trim() || unparsedLines.join("\n").trim()
            finishWith(() =>
              onError(
                new Error(
                  details
                    ? `Codex CLI completed but did not emit an agent_message. Raw output:\n${details}`
                    : "Codex CLI completed but did not emit an agent_message. Run `codex exec --json` in a terminal to inspect the provider output.",
                ),
              ),
            )
          } else {
            finishWith(onDone)
          }
        }
      })
      if (aborted || finished) {
        cleanup()
        return
      }

      if (aborted) return



      const payload: SpawnPayload = {
        streamId,
        model: config.model,
        prompt: buildPrompt(messages),
        isolateLocalConfig: config.localCliIsolation === true,
        timeoutMinutes: config.codexCliTimeoutMinutes,
        workingDirectory,
      }
      await ports.process.spawn(payload)
      if (aborted || signal?.aborted) {
        aborted = true
        await ports.process.kill(streamId).catch(() => {})
        finishWith(onDone)
        return
      }
      await completion
    } catch (err) {
      finishWith(() => {
        const message = err instanceof Error ? err.message : String(err)
        if (/not found|No such file|executable file not found/i.test(message)) {
          onError(
            new Error(
              "Codex CLI not found. Install `codex` with `npm install -g @openai/codex` or pick a different provider.",
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
  return { streamCodexCli }
}
