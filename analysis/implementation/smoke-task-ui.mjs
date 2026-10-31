/** Vite preview-only smoke. Never connect this fixture injector to a real knowledge base. */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']})
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(process.env.WORKSPACE_BASE_URL || 'http://127.0.0.1:1420/preview.html')
  // Refuse to seed application state unless the explicit sandbox banner exists.
  await page.getByText('交互预览',{exact:true}).waitFor()
  await page.getByRole('button',{name:'任务管理器',exact:true}).click()
  await page.getByRole('tab',{name:'深度研究任务',exact:true}).click()
  const labels=await page.evaluate(async()=>{
    const {useWikiStore}=await import('/src/stores/wiki-store.ts')
    const {useResearchStore}=await import('/src/stores/research-store.ts')
    const {default:i18n}=await import('/src/i18n/index.ts')
    const base={id:'smoke-research',projectPath:useWikiStore.getState().project.path,topic:'Controlled research smoke',status:'done',webResults:[{title:'Fixture source',url:'https://example.com',snippet:'Fixture',source:'site'}],synthesis:'Rendered body for task migration [1]',savedPath:null,error:null,createdAt:Date.now()}
    useResearchStore.setState({tasks:[base,{...base,id:'smoke-rerun',topic:'Queued rerun smoke',rerunOfTaskId:base.id,status:'queued',synthesis:''}]})
    return {rerun:i18n.t('research.rerun'),remove:i18n.t('research.remove')}
  })
  await page.getByRole('button',{name:/Controlled research smoke/}).first().click()
  await page.getByText('Rendered body for task migration [1]',{exact:true}).waitFor()
  if(!await page.getByRole('button',{name:labels.rerun,exact:true}).isDisabled())throw new Error('Active rerun guard lost')
  const remove=page.getByRole('button',{name:labels.remove,exact:true})
  await remove.focus()
  await page.evaluate(async()=>{
    const {useResearchStore}=await import('/src/stores/research-store.ts')
    useResearchStore.getState().updateTask('smoke-research',{synthesis:'Rendered body for task migration [1] updated'})
  })
  if(!await remove.evaluate(node=>node===document.activeElement))throw new Error('Adapter remounted focused action control')
  await remove.click()
  const exists=await page.evaluate(async()=>{
    const {useResearchStore}=await import('/src/stores/research-store.ts')
    return useResearchStore.getState().tasks.some(task=>task.id==='smoke-research')
  })
  if(exists)throw new Error('Controlled remove action was not forwarded')
  for(const name of ['文档导入任务','Wiki 检查与纠错任务','深度研究任务'])await page.getByRole('tab',{name,exact:true}).click()
  if(errors.length)throw new Error(errors.join('\n'))
  console.log(JSON.stringify({result:'passed',pageErrors:errors,checks:['research render slot','rerun guard','action focus survives update','remove callback','three task tabs']}))
} finally {await browser.close()}
