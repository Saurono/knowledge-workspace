/** Explicit Vite sandbox only; never target a production knowledge base. */
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core')
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}})
 page.setDefaultTimeout(15000)
 const errors=[],external=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.route('**/*',route=>{
  const url=new URL(route.request().url())
  if(['127.0.0.1','localhost'].includes(url.hostname)||['data:','blob:'].includes(url.protocol))return route.continue()
  external.push(url.origin);return route.abort()
 })
 await page.goto(process.env.WORKSPACE_BASE_URL||'http://127.0.0.1:1420/preview.html')
 await page.getByText('交互预览',{exact:true}).waitFor()
 await page.waitForFunction(async()=>{const {useWikiStore}=await import('/src/stores/wiki-store.ts');return !!useWikiStore.getState().project})
 const labels=await page.evaluate(async()=>{
  const {useWikiStore}=await import('/src/stores/wiki-store.ts')
  const {writeFile}=await import('/src/commands/fs.ts')
  const {default:i18n}=await import('/src/i18n/index.ts')
  const root=useWikiStore.getState().project.path
  await writeFile(root+'/wiki/concepts/b09-late.md','---\ntitle: B09迟到\n---\n\nB09迟到的内容')
  await writeFile(root+'/wiki/concepts/b09-latest.md','---\ntitle: B09最新\n---\n\nB09最新的内容')
  const original=window.__TAURI_INTERNALS__.invoke
  window.__searchRequests=[]
  window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
   if(command==='search_project') {
    window.__searchRequests.push(args)
    if(args.query==='B09迟到')await new Promise(resolve=>{window.__releaseLate=resolve})
   }
   return original(command,args)
  }
  useWikiStore.getState().setActiveView('chat')
  return {local:i18n.t('workspace.chat_local'),placeholder:i18n.t('search.placeholderWithShortcut')}
 })
 await page.getByRole('tab',{name:labels.local,exact:true}).click()
 const input=page.getByPlaceholder(labels.placeholder,{exact:true})
 await input.fill('B09迟到');await input.press('Enter')
 await page.waitForFunction(()=>!!window.__releaseLate)
 await input.fill('B09最新');await input.press('Enter')
 await page.getByText('B09最新',{exact:true}).first().waitFor()
 await page.evaluate(()=>window.__releaseLate())
 const evidence=await page.evaluate(async()=>{
  const {retrieveWikiEvidence}=await import('/src/app/retrieval/search.ts')
  const {useWikiStore}=await import('/src/stores/wiki-store.ts')
  return retrieveWikiEvidence(useWikiStore.getState().project.path,'B09最新',{localOnly:true})
 })
 if(evidence.length!==1||evidence[0].citation!==1||!evidence[0].text.includes('B09最新'))throw new Error('Evidence was not assembled')
 if(await page.getByText('B09迟到',{exact:true}).count())throw new Error('Late result replaced the latest results')
 const payloads=await page.evaluate(()=>window.__searchRequests)
 if(payloads.some(payload=>payload.embeddingConfig!==null))throw new Error('Local retrieval sent model config')
 if(errors.length||external.length)throw new Error(JSON.stringify({errors,external}))
 console.log(JSON.stringify({result:'passed',pageErrors:errors,externalRequests:external,checks:['local search UI','late result discarded','local model isolation','evidence citation and excerpt']}))
} finally {await browser.close()}
