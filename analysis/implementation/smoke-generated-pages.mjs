/** Vite sandbox only: never seed these fixtures into a production workspace. */
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core')
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}})
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
 await page.evaluate(async()=>{
  const {useWikiStore}=await import('/src/stores/wiki-store.ts')
  const {useChatStore}=await import('/src/stores/chat-store.ts')
  const original=window.__TAURI_INTERNALS__.invoke
  window.__generatedWrites=[]
  window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
   if(['write_file','write_file_atomic'].includes(command)&&String(args.path).includes('/wiki/'))window.__generatedWrites.push({path:args.path,content:args.contents})
   return original(command,args)
  }
  useWikiStore.getState().setLlmConfig({...useWikiStore.getState().llmConfig,provider:'openai',apiKey:'',model:''})
  useWikiStore.getState().setActiveView('chat')
  const store=useChatStore.getState(),id=store.createConversation()
  store.addMessageToConversation(id,'assistant','# Browser C3 Chat\n\nBrowser generation commit fixture.')
 })
 await page.getByRole('tab',{name:'LLM 对话检索',exact:true}).click()
 await page.getByText('Browser generation commit fixture.',{exact:true}).hover()
 await page.getByRole('button',{name:'保存到 Wiki',exact:true}).click()
 await page.waitForFunction(()=>window.__generatedWrites.some(write=>write.path.includes('/queries/browser-c3-chat-')))
 await page.evaluate(async()=>{
  const {useWikiStore}=await import('/src/stores/wiki-store.ts')
  const {useReviewStore}=await import('/src/stores/review-store.ts')
  useReviewStore.getState().setItems([{id:'c3-review-save',type:'confirm',title:'Browser review save',description:'Only a preview fixture',options:[{label:'保存生成测试',action:'save:'+btoa(encodeURIComponent('# Browser C3 Review\n\nReview commit fixture.'))}],resolved:false,createdAt:Date.now()}])
  useWikiStore.getState().setActiveView('review')
 })
 await page.getByRole('button',{name:'保存生成测试',exact:true}).click()
 await page.waitForFunction(()=>window.__generatedWrites.some(write=>write.path.includes('/queries/browser-c3-review-')))
 await page.evaluate(async()=>{
  const {useWikiStore}=await import('/src/stores/wiki-store.ts')
  const {useReviewStore}=await import('/src/stores/review-store.ts')
  useReviewStore.getState().setItems([{id:'c3-review-create',type:'confirm',title:'Browser C3 Concept Atlas',description:'Concept commit fixture.',options:[{label:'发布审阅概念',action:'__create_page__:Create concept'}],resolved:false,createdAt:Date.now()}])
  useWikiStore.getState().setActiveView('review')
 })
 await page.getByRole('button',{name:'发布审阅概念',exact:true}).click()
 await page.waitForFunction(()=>window.__generatedWrites.some(write=>write.path.endsWith('/concepts/browser-c3-concept-atlas.md')))
 await page.waitForFunction(async()=>{
  const {useReviewStore}=await import('/src/stores/review-store.ts')
  return useReviewStore.getState().items.find(item=>item.title==='Browser C3 Concept Atlas')?.resolved
 })
 const result=await page.evaluate(async()=>{
  const {readFile}=await import('/src/commands/fs.ts')
  const {useWikiStore}=await import('/src/stores/wiki-store.ts')
  const {useReviewStore}=await import('/src/stores/review-store.ts')
  const root=useWikiStore.getState().project.path
  return {index:await readFile(root+'/wiki/index.md'),log:await readFile(root+'/wiki/log.md'),resolved:useReviewStore.getState().items.find(item=>item.title==='Browser C3 Concept Atlas')?.resolved}
 })
 for(const name of ['Browser C3 Chat','Browser C3 Review','Browser C3 Concept Atlas'])if(!result.index.includes(name))throw new Error('Navigation lost generated page: '+name)
 if(!result.log.includes('browser-c3-chat-')||!result.log.includes('browser-c3-review-')||!result.log.includes('browser-c3-concept-atlas.md'))throw new Error('Generation log entries missing')
 if(!result.resolved)throw new Error('Review was not resolved after publication')
 if(errors.length||external.length)throw new Error(JSON.stringify({errors,external}))
 console.log(JSON.stringify({result:'passed',pageErrors:errors,externalRequests:external,checks:['chat save callback','review save callback','review create stable name','combined index/log','review result state']}))
} finally {await browser.close()}
