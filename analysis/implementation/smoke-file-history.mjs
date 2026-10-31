/** Browser fixtures are injected only after checking the explicit sandbox banner. */
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core')
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}})
 page.setDefaultTimeout(15000)
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(process.env.WORKSPACE_BASE_URL||'http://127.0.0.1:1420/preview.html')
 await page.getByText('交互预览',{exact:true}).waitFor()
 await page.getByRole('button',{name:'Wiki',exact:true}).click()
 const labels=await page.evaluate(async()=>{
  const {default:i18n}=await import('/src/i18n/index.ts')
  const original=window.__TAURI_INTERNALS__.invoke
  window.__historyFixture={delay:false,release:null}
  window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
   if(command==='list_file_history'){
    const value=[{id:'fixture-version',path:args.filePath,timestamp:1,author:'fixture-user',tool:'fixture-tool',content:'# History restored synthetic content'}]
    if(window.__historyFixture.delay)return new Promise(resolve=>{window.__historyFixture.release=()=>resolve(value)})
    return value
   }
   if(command==='restore_file_history'){
    const content='# History restored synthetic content'
    await original('write_file_atomic',{path:args.filePath,contents:content})
    return content
   }
   return original(command,args)
  }
  return {history:i18n.t('preview.history'),restore:i18n.t('preview.historyRestore')}
 })
 await page.getByTitle(labels.history,{exact:true}).click()
 const region=page.getByRole('region',{name:labels.history,exact:true})
 await region.getByRole('button',{name:/fixture-user/}).click()
 await region.getByRole('button',{name:labels.restore,exact:true}).click()
 await region.waitFor({state:'hidden'})
 await page.getByText('History restored synthetic content',{exact:true}).waitFor()
 await page.evaluate(()=>{window.__historyFixture.delay=true})
 await page.getByTitle(labels.history,{exact:true}).click()
 await page.waitForFunction(()=>typeof window.__historyFixture.release==='function')
 await page.evaluate(async()=>{
  const {useWikiStore}=await import('/src/stores/wiki-store.ts')
  const project=useWikiStore.getState().project
  useWikiStore.getState().setProject({id:'other',name:'Other',path:'/other'})
  useWikiStore.getState().setProject(project)
  window.__historyFixture.release()
 })
 await region.waitFor({state:'hidden'})
 if(errors.length)throw new Error(errors.join('\n'))
 console.log(JSON.stringify({result:'passed',pageErrors:errors,checks:['Wiki history entry point','select and restore','restored preview','discard delayed history after project ABA switch']}))
}finally{await browser.close()}
