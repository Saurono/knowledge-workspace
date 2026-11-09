import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

const cdpUrl = process.env.KW_NATIVE_CDP_URL
if (!cdpUrl) {
  console.error('NOT RUN: KW_NATIVE_CDP_URL is not set; connect to the isolated Tauri executable over WebView CDP.')
  process.exitCode = 2
} else {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
  const tempRoot = await mkdtemp(join(tmpdir(), 'kw-native-domains-'))
  let browser
  let page
  let activeCreatedProjectPath = null
  let activeCreatedProjectName = null
  try {
    browser = await chromium.connectOverCDP(cdpUrl)
    const pages = browser.contexts().flatMap(context => context.pages())
    for (const candidate of pages) {
      if (await candidate.evaluate(() => typeof window.__TAURI_INTERNALS__?.invoke === 'function').catch(() => false)) { page = candidate; break }
    }
    if (!page) throw new Error('Connected CDP endpoint has no Tauri WebView exposing __TAURI_INTERNALS__.invoke')
    const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
    const clickIcon = async (className) => {
      const icon = page.locator(`svg.${className}`).first()
      await icon.waitFor({ state: 'visible', timeout: 10_000 })
      await icon.locator('xpath=..').click()
    }
    const openCreateDialog = async () => {
      const dialogInput = page.locator('#name')
      if (await dialogInput.isVisible().catch(() => false)) return
      if (await page.getByRole('button', { name: /new project|新建项目/i }).count()) {
        await page.getByRole('button', { name: /new project|新建项目/i }).click()
      } else {
        await clickIcon('lucide-arrow-left-right')
        await page.getByRole('button', { name: /new project|新建项目/i }).click()
      }
      await page.locator('#name').waitFor({ state: 'visible' })
    }
    const createProject = async (name, parent) => {
      await openCreateDialog()
      await page.locator('#name').fill(name)
      await page.locator('#path').fill(parent)
      const language = page.locator('#language')
      const options = await language.locator('option').evaluateAll(items => items.map(option => option.value).filter(Boolean))
      assert.ok(options.length, 'create project requires a real output language selection')
      await language.selectOption(options[0])
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: /create|创建/i }).click()
      await dialog.waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {})
      await page.getByText(name, { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
      const expectedPath = join(parent, name)
      const rawProject = await invoke('open_project', { path: expectedPath })
      assert.equal(rawProject.name, name, 'native open_project must confirm the UI-created project name')
      assert.equal(rawProject.path.replace(/\\/g, '/'), expectedPath.replace(/\\/g, '/'), 'native open_project must confirm the actual project path created by the UI')
      const projectPath = rawProject.path
      assert.equal((await stat(projectPath)).isDirectory(), true, 'native-confirmed temporary project must exist on disk')
      activeCreatedProjectPath = projectPath
      activeCreatedProjectName = rawProject.name
      return projectPath
    }
    const sourceNames = ['src-alpha.md', 'src-beta.md', 'src-both.md', 'src-open.md']
    const wikiNames = ['wiki-alpha.md', 'wiki-beta.md', 'wiki-both.md', 'wiki-open.md']
    const sourceFileButton = (name) => page.getByRole('button', { name: new RegExp(`^${name.replaceAll('.', '\\.')}([\\s]|$)`) })
    const seedProject = async (projectPath) => {
      await mkdir(join(projectPath, 'raw', 'sources'), { recursive: true })
      await mkdir(join(projectPath, 'wiki', 'concepts'), { recursive: true })
      for (const name of sourceNames) await writeFile(join(projectPath, 'raw', 'sources', name), `# ${name}\n\nSynthetic native UI smoke content.\n`, 'utf8')
      for (const name of wikiNames) await writeFile(join(projectPath, 'wiki', 'concepts', name), `---\ntype: concept\ntitle: ${name.replace('.md', '')}\ntags: []\nrelated: []\n---\n\n# ${name}\nSynthetic native UI smoke content commonprobe.\n`, 'utf8')
    }
    const addDomainInPreview = async (name, sourceName) => {
      await sourceFileButton(sourceName).click()
      const editor = page.locator('div.border-b.p-3.text-xs').last()
      const input = editor.getByRole('textbox')
      await input.waitFor({ state: 'visible' })
      await input.fill(name)
      await editor.getByRole('button', { name: /add|添加/i }).click()
      await editor.getByRole('checkbox', { name, exact: true }).waitFor({ state: 'visible' })
      await clickIcon('lucide-folder-open')
      await sourceFileButton(sourceName).waitFor({ state: 'visible' })
    }
    const assignResource = async (resourceName, domainNames) => {
      const summary = page.locator(`summary[aria-label="设置领域归类：${resourceName}"]`)
      await summary.click()
      const menu = summary.locator('xpath=..')
      for (const name of ['Alpha', 'Beta']) {
        if (!await menu.evaluate(element => element.open)) await summary.click()
        const checkbox = menu.getByRole('checkbox', { name: `${resourceName}：${name}`, exact: true })
        const shouldCheck = domainNames.includes(name)
        if (await checkbox.isChecked() !== shouldCheck) {
          await checkbox.click()
          const deadline = Date.now() + 8_000
          while (Date.now() < deadline && await checkbox.isChecked() !== shouldCheck) await page.waitForTimeout(100)
          assert.equal(await checkbox.isChecked(), shouldCheck, `${resourceName} ${name} category checkbox must persist the requested state`)
        }
      }
      if (await menu.evaluate(element => element.open)) await summary.click()
      assert.equal(await menu.evaluate(element => element.open), false, `${resourceName} domain assignment details must close before the next row`)
      await page.waitForTimeout(300)
    }
    const setDomainFilter = async ({ domains = [], unclassified = false, match = 'any' }) => {
      const candidates = await page.locator('fieldset').all()
      const visibleCandidates = []
      for (const candidate of candidates) {
        if (!await candidate.isVisible()) continue
        const label = await candidate.locator('legend').innerText().catch(() => '')
        if (label.trim() === '按领域筛选') visibleCandidates.push(candidate)
      }
      const fieldset = visibleCandidates.at(-1)
      assert.ok(fieldset, 'current visible view must expose its domain filter')
      for (const name of ['Alpha', 'Beta', '未分类']) {
        const checkbox = fieldset.getByRole('checkbox', { name, exact: true })
        const shouldCheck = name === '未分类' ? unclassified : domains.includes(name)
        await checkbox.setChecked(shouldCheck)
      }
      await fieldset.getByLabel('领域匹配方式').selectOption(match)
    }
    const visibleLabels = async (names) => {
      const result = []
      for (const name of names) {
        const row = page.locator(`summary[aria-label="设置领域归类：${name}"]`)
        if (await row.isVisible().catch(() => false)) result.push(name)
      }
      return result
    }
    const visibleSearchTitles = async () => {
      const chatWorkspace = page.getByRole('tablist', { name: /retrieval mode|检索模式/i }).locator('xpath=ancestor::section[1]')
      const cards = await chatWorkspace.locator('button.w-full.rounded-lg.border.p-3.text-left.text-sm').all()
      const texts = []
      for (const card of cards) if (await card.isVisible()) texts.push(await card.innerText())
      return wikiNames.map(name => name.replace('.md', '')).filter(title => texts.some(card => card.includes(title)))
    }

    const parentA = join(tempRoot, 'project-a')
    await mkdir(parentA)
    const projectA = await createProject('Native Domain A', parentA)
    await seedProject(projectA)
    await clickIcon('lucide-folder-open')
    await page.locator('button[aria-label="Refresh folder"], button[aria-label="刷新文件夹"]').first().click()
    await sourceFileButton('src-alpha.md').waitFor({ state: 'visible', timeout: 15_000 })
    await addDomainInPreview('Alpha', 'src-alpha.md')
    await addDomainInPreview('Beta', 'src-beta.md')

    const sourceAssignments = [
      ['src-alpha.md', ['Alpha']], ['src-beta.md', ['Beta']],
      ['src-both.md', ['Alpha', 'Beta']], ['src-open.md', []],
    ]
    for (const [name, ids] of sourceAssignments) await assignResource(name, ids)
    await setDomainFilter({ domains: ['Alpha'], match: 'any' })
    assert.deepEqual(await visibleLabels(sourceNames), ['src-alpha.md', 'src-both.md'], 'Sources ANY Alpha must show Alpha and both')
    await setDomainFilter({ domains: ['Alpha', 'Beta'], match: 'all' })
    assert.deepEqual(await visibleLabels(sourceNames), ['src-both.md'], 'Sources ALL Alpha+Beta must show only both')
    await setDomainFilter({ unclassified: true })
    assert.deepEqual(await visibleLabels(sourceNames), ['src-open.md'], 'Sources unclassified filter must show the unclassified source')
    const timeRow = page.getByText(/source received|source ingested|received|接收|摄取/).first()
    assert.ok(await timeRow.count(), 'source rows must show source time labels (unknown is valid without ingest evidence)')

    await clickIcon('lucide-file-text')
    await page.getByRole('button', { name: 'wiki-alpha', exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
    const wikiAssignments = [
      ['wiki-alpha', ['Alpha']], ['wiki-beta', ['Beta']],
      ['wiki-both', ['Alpha', 'Beta']], ['wiki-open', []],
    ]
    for (const [name, ids] of wikiAssignments) await assignResource(name, ids)
    await setDomainFilter({ domains: ['Alpha'], match: 'any' })
    assert.deepEqual(await visibleLabels(wikiNames.map(name => name.replace('.md', ''))), ['wiki-alpha', 'wiki-both'], 'Wiki ANY Alpha must show Alpha and both')
    await setDomainFilter({ domains: ['Alpha', 'Beta'], match: 'all' })
    assert.deepEqual(await visibleLabels(wikiNames.map(name => name.replace('.md', ''))), ['wiki-both'], 'Wiki ALL Alpha+Beta must show only both')
    await setDomainFilter({ unclassified: true })
    assert.deepEqual(await visibleLabels(wikiNames.map(name => name.replace('.md', ''))), ['wiki-open'], 'Wiki unclassified filter must show the unclassified page')

    // The local search surface is a normal ChatWorkspace tab backed by the
    // native search_project command; this synthetic query needs no LLM call.
    await clickIcon('lucide-message-square')
    await page.getByRole('tab', { name: /local search|本地搜索/i }).click()
    const chatWorkspace = page.getByRole('tablist', { name: /retrieval mode|检索模式/i }).locator('xpath=ancestor::section[1]')
    const searchInput = chatWorkspace.locator('input[type="text"]')
    await searchInput.fill('commonprobe')
    await searchInput.press('Enter')
    await page.waitForFunction(() => {
      const tablist = [...document.querySelectorAll('[role="tablist"]')].find(node => /retrieval mode|检索模式/i.test(node.getAttribute('aria-label') ?? ''))
      const section = tablist?.closest('section')
      return (section?.querySelectorAll('button.w-full.rounded-lg.border.p-3.text-left.text-sm').length ?? 0) >= 4
    }, null, { timeout: 15_000 })
    assert.deepEqual(await visibleSearchTitles(), wikiNames.map(name => name.replace('.md', '')), 'native local search must return all four synthetic Wiki pages for the shared term')
    await setDomainFilter({ domains: ['Alpha'], match: 'any' })
    assert.deepEqual(await visibleSearchTitles(), ['wiki-alpha', 'wiki-both'], 'local search ANY Alpha must show Alpha and both')
    await setDomainFilter({ domains: ['Alpha', 'Beta'], match: 'all' })
    assert.deepEqual(await visibleSearchTitles(), ['wiki-both'], 'local search ALL Alpha+Beta must show only both')
    await setDomainFilter({ unclassified: true })
    assert.deepEqual(await visibleSearchTitles(), ['wiki-open'], 'local search unclassified filter must show the unclassified page')

    await clickIcon('lucide-arrow-left-right')
    activeCreatedProjectPath = null
    activeCreatedProjectName = null
    await page.getByRole('button', { name: /new project|新建项目/i }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: /new project|新建项目/i }).click()
    const parentB = join(tempRoot, 'project-b')
    await mkdir(parentB)
    const projectB = await createProject('Native Domain B', parentB)
    await clickIcon('lucide-folder-open')
    await page.locator('button[aria-label="Refresh folder"], button[aria-label="刷新文件夹"]').first().click()
    const newProjectSourceLabels = await visibleLabels(sourceNames)
    assert.deepEqual(newProjectSourceLabels, [], 'switching project must clear prior source tree/filter state')
    assert.equal(await page.getByRole('checkbox', { name: 'Alpha', exact: true }).count(), 0, 'domains from the prior project must not leak into the new project')
    const visibleMatchModeSelects = await page.getByLabel('领域匹配方式').all()
    let activeMatchModeSelect = null
    for (const select of visibleMatchModeSelects) if (await select.isVisible()) activeMatchModeSelect = select
    assert.ok(activeMatchModeSelect, 'current Sources view must expose its domain match selector')
    assert.equal(await activeMatchModeSelect.inputValue(), 'any', 'domain match mode must reset when switching projects')
    await clickIcon('lucide-message-square')
    await page.getByRole('tab', { name: /local search|本地搜索/i }).click()
    const nextChatWorkspace = page.getByRole('tablist', { name: /retrieval mode|检索模式/i }).locator('xpath=ancestor::section[1]')
    assert.equal(await nextChatWorkspace.locator('input[type="text"]').inputValue(), '', 'project switch must clear local search query')
    assert.deepEqual(await visibleSearchTitles(), [], 'project switch must clear local search results')
    console.log(JSON.stringify({ status: 'passed', checks: ['native-project-create-ui', 'real-filesystem-source-and-wiki-seed', 'domain-create-and-resource-assignment-ui', 'sources-any-all-unclassified', 'wiki-any-all-unclassified', 'native-local-search-any-all-unclassified', 'source-time-labels-present', 'project-switch-clears-filter-domain-and-search-state'], temporaryProjects: [projectA, projectB], sourceTimes: 'labels verified; displayed values may be unknown because synthetic files have no ingest receipt' }, null, 2))
  } catch (error) {
    console.error(`FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    if (page) {
      try {
        console.error(`UI_DIAGNOSTICS url=${await page.url()}`)
        const visibleText = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '')
        console.error(`UI_VISIBLE_TEXT_BEGIN\n${visibleText.slice(0, 6_000)}\nUI_VISIBLE_TEXT_END`)
      } catch (diagnosticError) {
        console.error(`UI_DIAGNOSTICS_UNAVAILABLE: ${diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)}`)
      }
      const screenshotPath = process.env.KW_NATIVE_UI_FAILURE_SCREENSHOT
      if (screenshotPath) {
        if (!isAbsolute(screenshotPath)) {
          console.error('UI_SCREENSHOT_SKIPPED: KW_NATIVE_UI_FAILURE_SCREENSHOT must be an absolute path')
        } else {
          try {
            await mkdir(dirname(screenshotPath), { recursive: true })
            await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 5_000 })
            console.error(`UI_FAILURE_SCREENSHOT=${screenshotPath}`)
          } catch (screenshotError) {
            console.error(`UI_SCREENSHOT_FAILED: ${screenshotError instanceof Error ? screenshotError.message : String(screenshotError)}`)
          }
        }
      }
    }
    process.exitCode = 1
  } finally {
    try {
      if (activeCreatedProjectPath && activeCreatedProjectName && browser && page) {
        const currentProjectStillOwned = await page.getByText(activeCreatedProjectName, { exact: true }).isVisible().catch(() => false)
        if (currentProjectStillOwned) await page.evaluate(() => window.__TAURI_INTERNALS__?.invoke('stop_project_file_watcher', {})).catch(() => {})
      }
    } finally {
      try { if (browser) await browser.close() } finally { await rm(tempRoot, { recursive: true, force: true }) }
    }
  }
}
