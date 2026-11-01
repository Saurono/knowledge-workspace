/** Explicit preview sandbox only. Do not run against a real workspace. */
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core')
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}})
 page.setDefaultTimeout(15000)
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.route('**/*',route=>{
  const url=new URL(route.request().url())
  if(['127.0.0.1','localhost'].includes(url.hostname)&&url.port==='1420'||['data:','blob:'].includes(url.protocol))return route.continue()
  return route.fulfill({contentType:'application/json',body:'{}'})
 })
 await page.goto(process.env.WORKSPACE_BASE_URL||'http://127.0.0.1:1420/preview.html')
 await page.getByText('交互预览',{exact:true}).waitFor()
 const labels=await page.evaluate(async()=>{
  const {default:i18n}=await import('/src/i18n/index.ts')
  return {wiki:i18n.t('workspace.graph_wiki'),memory:i18n.t('workspace.graph_memory'),node:i18n.t('workspace.selectNode'),checks:i18n.t('workspace.checks'),selectAll:i18n.t('lint.selectAll'),fix:i18n.t('lint.fixSelected'),about:i18n.t('settings.categories.about')}
 })
 const selector=page.getByRole('combobox',{name:labels.node,exact:true})
 await page.waitForFunction(label=>document.querySelector(`select[aria-label="${label}"]`)?.options.length>1,labels.node)
 const wikiCount=await selector.locator('option').count()
 await page.getByRole('tab',{name:labels.memory,exact:true}).click()
 await page.waitForFunction(label=>document.querySelector(`select[aria-label="${label}"]`)?.options.length===65,labels.node)
 await page.getByRole('tab',{name:labels.wiki,exact:true}).click()
 await page.waitForFunction(({label,count})=>document.querySelector(`select[aria-label="${label}"]`)?.options.length===count,{label:labels.node,count:wikiCount})
 await page.evaluate(async()=>{
  const {useWikiStore}=await import('/src/stores/wiki-store.ts')
  const {useLintStore}=await import('/src/stores/lint-store.ts')
  const {writeFile}=await import('/src/commands/fs.ts')
  const root=useWikiStore.getState().project.path
  await writeFile(root+'/wiki/concepts/b16-fix.md','# Browser grouped repair')
  const original=window.__TAURI_INTERNALS__.invoke
  window.__groupedWrites=0
  window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
   if(['write_file','write_file_atomic'].includes(command)&&args.path===root+'/wiki/concepts/b16-fix.md')++window.__groupedWrites
   return original(command,args)
  }
  useLintStore.getState().setItems(['one','two'].map(id=>({id:'b16-'+id,type:'no-outlinks',severity:'info',page:'concepts/b16-fix.md',suggestedTarget:'browser-target-'+id,detail:'Synthetic browser repair fixture',createdAt:Date.now()})))
  useWikiStore.getState().setActiveView('wiki')
 })
 await page.getByRole('button',{name:labels.checks,exact:true}).click()
 await page.getByRole('checkbox',{name:labels.selectAll,exact:true}).check()
 await page.getByRole('button',{name:labels.fix,exact:true}).click()
 await page.waitForFunction(async()=>{
  const {useLintStore}=await import('/src/stores/lint-store.ts')
  return useLintStore.getState().items.length===0
 })
 const saved=await page.evaluate(async()=>{
  const {useWikiStore}=await import('/src/stores/wiki-store.ts')
  const {readFile}=await import('/src/commands/fs.ts')
  return {body:await readFile(useWikiStore.getState().project.path+'/wiki/concepts/b16-fix.md'),writes:window.__groupedWrites}
 })
 if(saved.writes!==1||!saved.body.includes('[[browser-target-one]]')||!saved.body.includes('[[browser-target-two]]'))throw new Error('Grouped UI repair did not preserve both transforms in one write')
 await page.evaluate(async()=>{const {useWikiStore}=await import('/src/stores/wiki-store.ts');useWikiStore.getState().setActiveView('settings')})
 await page.getByRole('button',{name:labels.about,exact:true}).click()
 await page.getByText('交互预览：文件、Vault 与本机工具使用模拟环境。',{exact:true}).waitFor()
 if(errors.length)throw new Error(errors.join('\n'))
 console.log(JSON.stringify({result:'passed',pageErrors:errors,checks:['Wiki graph query','memory scene 64 points','mode switch restores Wiki graph','grouped repair one write','settings preview capability']}))
} finally {await browser.close()}
