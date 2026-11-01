import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { readFile, writeFileAtomic } from "@/commands/fs"
import { startProjectFileWatcher, stopProjectFileWatcher } from "@/commands/file-sync"
import { configureObsidianVault, deliverObsidianReceipt } from "@/app/obsidian/service"
import { createLocalPlatform } from "@/modules/platform/application"
import type { LocalProject, LocalFileEvent } from "@/modules/platform/domain"
let watcherOwner: symbol | undefined
let watcherQueue: Promise<unknown> = Promise.resolve()
function coordinate<T>(operation: () => Promise<T>) {
  const work = watcherQueue.then(operation); watcherQueue = work.catch(() => {}); return work
}
export function desktopPlatform(project: LocalProject) {
  const owner = Symbol("project-watcher")
  return createLocalPlatform(project, {
    read: path => readFile(path), write: (path, content) => writeFileAtomic(path, content),
    listen: handler => listen<LocalFileEvent>("file-sync://changed", event => handler(event.payload)),
    startWatch: project => coordinate(async () => {
      if (watcherOwner && watcherOwner !== owner) await stopProjectFileWatcher()
      watcherOwner = owner
      try { return await startProjectFileWatcher(project.id, project.path) }
      catch (error) { if (watcherOwner === owner) watcherOwner = undefined; throw error }
    }),
    stopWatch: () => coordinate(async () => { if (watcherOwner === owner) { await stopProjectFileWatcher(); watcherOwner = undefined } }),
    shell: (project, input) => invoke("platform_shell_exec", { projectPath: project.path, ...input }),
    configureVault: configureObsidianVault, deliverReceipt: deliverObsidianReceipt,
  })
}
