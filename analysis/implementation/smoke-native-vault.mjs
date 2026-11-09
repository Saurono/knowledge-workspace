import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cdpUrl = process.env.KW_NATIVE_CDP_URL
if (!cdpUrl) {
  console.error('NOT RUN: KW_NATIVE_CDP_URL is not set; start the isolated Tauri executable with WebView remote debugging enabled.')
  process.exitCode = 2
} else {
  const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'playwright-core'
  const { chromium } = await import(playwrightModule).catch(() => { throw new Error(`Cannot load ${playwrightModule}; set PLAYWRIGHT_MODULE to the installed Playwright module`) })
  let browser
  const tempRoot = await mkdtemp(join(tmpdir(), 'kw-native-vault-receipt-'))
  try {
    browser = await chromium.connectOverCDP(cdpUrl)
    const pages = browser.contexts().flatMap(context => context.pages())
    let page
    for (const candidate of pages) {
      if (await candidate.evaluate(() => typeof window.__TAURI_INTERNALS__?.invoke === 'function').catch(() => false)) { page = candidate; break }
    }
    if (!page) throw new Error('Connected CDP endpoint has no Tauri WebView exposing __TAURI_INTERNALS__.invoke')
    const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
    const vault = join(tempRoot, 'selected-vault'), movedVault = join(tempRoot, 'moved-vault'), external = join(tempRoot, 'external')
    await mkdir(join(vault, '.obsidian'), { recursive: true })
    await mkdir(external)
    const source = join(vault, 'raw', 'human-note.md'), originalNote = '# Human note\n\nKeep this content unchanged.\n'
    await mkdir(join(vault, 'raw'), { recursive: true }); await writeFile(source, originalNote, 'utf8')
    const sourceHash = createHash('sha256').update(await readFile(source)).digest('hex')
    const args = { vaultPath: vault, fileName: 'source-a-revision-b.json', contents: '{"schemaVersion":2,"revision":1}' }
    const first = await invoke('write_vault_receipt', args)
    assert.equal(first, args.contents, 'command must return the read-back JSON')
    const target = join(vault, 'kb-ingest-records', args.fileName)
    assert.equal(await readFile(target, 'utf8'), args.contents)
    const replacement = '{"schemaVersion":2,"revision":2,"updated":true}'
    assert.equal(await invoke('write_vault_receipt', { ...args, contents: replacement }), replacement, 'second write must atomically replace and read back')
    assert.equal(await readFile(target, 'utf8'), replacement)
    assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'), sourceHash, 'source note hash must not change')

    await rename(vault, movedVault)
    let oldPathFailed = false
    try { await invoke('write_vault_receipt', args) } catch { oldPathFailed = true }
    assert.ok(oldPathFailed, 'a moved Vault must fail at its old path')
    await assert.rejects(readFile(target), 'old Vault path must not be recreated')
    assert.equal(await readdir(tempRoot).then(names => names.includes('selected-vault')), false, 'old Vault root must stay absent')
    const relocated = { ...args, vaultPath: movedVault, fileName: 'after-reconnect.json', contents: '{"reconnected":true}' }
    assert.equal(await invoke('write_vault_receipt', relocated), relocated.contents, 'explicitly selecting the moved Vault path must reconnect successfully')
    assert.equal(await readFile(join(movedVault, 'kb-ingest-records', relocated.fileName), 'utf8'), relocated.contents)

    const linkVault = join(tempRoot, 'linked-vault')
    await mkdir(join(linkVault, '.obsidian'), { recursive: true })
    await symlink(external, join(linkVault, 'kb-ingest-records'), process.platform === 'win32' ? 'junction' : 'dir')
    let linkRejected = false
    try { await invoke('write_vault_receipt', { ...args, vaultPath: linkVault, fileName: 'must-not-escape.json', contents: '{"external":true}' }) } catch { linkRejected = true }
    assert.ok(linkRejected, 'symlink/junction receipt directory must be rejected')
    assert.deepEqual(await readdir(external), [], 'external target must remain untouched')

    const projectPath = join(tempRoot, 'd09-probe-project')
    const sourceVault = join(projectPath, 'raw', 'sources', 'vault')
    const receiptDir = join(sourceVault, 'kb-ingest-records')
    await mkdir(join(projectPath, 'raw', 'sources'), { recursive: true })
    const scanConfig = {
      enabled: true,
      autoIngest: true,
      includeExtensions: ['md', 'json'],
      excludeExtensions: [],
      excludeDirs: [],
      excludeGlobs: [],
      maxFileSizeMb: 100,
    }
    const rescan = () => invoke('rescan_project_files', {
      projectId: 'd09-probe', projectPath, sourceWatchConfig: scanConfig, watchRootsOnly: false,
    })
    await rescan() // Establish the empty-tree snapshot before introducing files.
    await mkdir(join(sourceVault, '.obsidian'), { recursive: true })
    await mkdir(receiptDir, { recursive: true })
    await writeFile(join(sourceVault, 'source-note.md'), '# Existing vault note\n', 'utf8')
    await writeFile(join(receiptDir, 'result.json'), replacement, 'utf8')
    await writeFile(join(receiptDir, 'result.md'), '# Receipt sidecar\n', 'utf8')
    const rescanResult = await rescan()
    const changedPaths = (rescanResult.changedTasks ?? []).map(task => String(task.path).replace(/\\/g, '/'))
    const noteRelativePath = 'raw/sources/vault/source-note.md'
    const noteDiscovered = changedPaths.some(path => path === noteRelativePath || path.endsWith(`/${noteRelativePath}`))
    assert.ok(noteDiscovered, `rescan must discover the existing Vault note; changedPaths=${JSON.stringify(changedPaths)}`)
    assert.ok(!changedPaths.some(path => path.includes('/kb-ingest-records/')), 'receipt JSON and Markdown must never become import tasks')

    // Observe the native changed event: completed queue tasks are intentionally
    // removed quickly, so polling get_file_change_queue alone can miss them.
    await page.evaluate(() => {
      window.__nativeFileSyncEvents = []
      window.__nativeFileSyncListenId = window.__TAURI_INTERNALS__.transformCallback(event => {
        window.__nativeFileSyncEvents.push(event.payload)
      })
    })
    await invoke('plugin:event|listen', {
      event: 'file-sync://changed',
      target: { kind: 'Any' },
      handler: await page.evaluate(() => window.__nativeFileSyncListenId),
    })
    let watcherStarted = false
    try {
      await invoke('start_project_file_watcher', {
        projectId: 'd09-probe', projectPath, sourceWatchConfig: scanConfig,
      })
      watcherStarted = true
      const nativeNote = join(sourceVault, 'native-created.md')
      const nativeNoteRel = 'raw/sources/vault/native-created.md'
      await writeFile(nativeNote, '# Native watcher create\n', 'utf8')
      const waitForNativePath = async (relativePath, expectedKind, priorCount, timeoutMs = 10_000) => {
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
          const events = await page.evaluate(() => window.__nativeFileSyncEvents)
          const tasks = events.slice(priorCount).flatMap(event => event.tasks ?? [])
          if (tasks.some(task => String(task.path).replace(/\\/g, '/') === relativePath && String(task.kind).toLowerCase() === expectedKind)) return events.length
          await new Promise(resolve => setTimeout(resolve, 200))
        }
        const events = await page.evaluate(() => window.__nativeFileSyncEvents)
        throw new Error(`native watcher did not report ${relativePath}; events=${JSON.stringify(events)}`)
      }
      const createdEvents = await waitForNativePath(nativeNoteRel, 'created', 0)
      const beforeModify = (await page.evaluate(() => window.__nativeFileSyncEvents)).length
      await writeFile(nativeNote, '# Native watcher modified\n', 'utf8')
      const modifiedEvents = await waitForNativePath(nativeNoteRel, 'modified', beforeModify)
      // The two receipt formats are inside the watched source tree, but must
      // remain excluded from native import tasks as well as explicit rescans.
      await writeFile(join(receiptDir, 'native.json'), '{"schemaVersion":2,"native":true}', 'utf8')
      await writeFile(join(receiptDir, 'native.md'), '# Native receipt\n', 'utf8')
      await new Promise(resolve => setTimeout(resolve, 1_500))
      const nativeEvents = await page.evaluate(() => window.__nativeFileSyncEvents)
      const nativeTasks = nativeEvents.flatMap(event => event.tasks ?? [])
      assert.ok(nativeTasks.some(task => String(task.path).replace(/\\/g, '/') === nativeNoteRel), 'native watcher changed event must include the normal source')
      assert.ok(!nativeTasks.some(task => String(task.path).replace(/\\/g, '/').includes('/kb-ingest-records/')), 'native watcher must not queue JSON or Markdown receipts')
      console.log(JSON.stringify({ status: 'passed', checks: ['atomic-overwrite-readback', 'source-note-hash-preserved', 'moved-vault-not-recreated', 'explicit-new-path-reconnect', 'external-link-rejected', 'receipt-directory-excluded-from-rescan', 'native-watcher-create-and-modify-detected', 'receipt-directory-excluded-from-native-watcher'], nativeWatcher: { eventCount: nativeEvents.length, createObservedAtEventCount: createdEvents, modifyObservedAtEventCount: modifiedEvents, periodicRescan: 'not exercised; native interval is 60 seconds on Windows/macOS' } }, null, 2))
    } finally {
      if (watcherStarted) await invoke('stop_project_file_watcher', {}).catch(() => {})
    }
  } catch (error) {
    console.error(`FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exitCode = 1
  } finally {
    try { if (browser) await browser.close() } finally { await rm(tempRoot, { recursive: true, force: true }) }
  }
}
