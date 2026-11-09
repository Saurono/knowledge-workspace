/** Real standalone service + Web UI, isolated temporary data and ephemeral credentials. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core')
const directory=mkdtempSync(join(tmpdir(),'kw-shared-browser-')),token=randomBytes(32).toString('hex'),password=randomBytes(24).toString('hex')
const port=14331,origin=`http://127.0.0.1:${port}`
const service=spawn(process.execPath,['dist-service/server.mjs'],{cwd:process.cwd(),env:{...process.env,KW_BOOTSTRAP_KEY:token,KW_SERVICE_DATA:directory,KW_SERVICE_PORT:String(port)},stdio:['ignore','pipe','pipe']})
let browser
try {
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Standalone service startup timed out')),15000)
  service.stdout.on('data',data=>{if(String(data).includes('listening')){clearTimeout(timer);resolve()}})
  service.once('exit',code=>{clearTimeout(timer);reject(new Error('Standalone service exited: '+code))})
 })
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
 const errors=[]
 const connect=async(handle='admin',setup=false)=>{
  const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))
  await page.goto(origin)
  if(setup){await page.getByLabel('初始化密钥',{exact:true}).fill(token);await page.getByLabel('显示名称',{exact:true}).fill('浏览器管理员')}
  await page.getByLabel('账号',{exact:true}).fill(handle);await page.getByLabel('密码',{exact:true}).fill(password)
  if(setup)await page.getByLabel('确认密码',{exact:true}).fill(password)
  await page.getByRole('button',{name:setup?'创建管理员并登录':'登录',exact:true}).click()
  await page.getByLabel('当前项目',{exact:true}).waitFor()
  if(await page.evaluate(()=>!!window.__TAURI_INTERNALS__))throw new Error('Web UI must use the API without a mock native runtime')
  return page
 }
 const first=await connect('admin',true)
 await first.getByLabel('新项目名称',{exact:true}).fill('真实 Web 服务验证')
 await first.getByRole('button',{name:'创建项目',exact:true}).click()
 await first.getByLabel('Wiki 路径',{exact:true}).fill('wiki/concepts/browser-shared.md')
 await first.getByLabel('Wiki 正文',{exact:true}).fill('# Persistent browser page\n\nFirst version')
 await first.getByRole('button',{name:'保存 Wiki',exact:true}).click()
 await first.getByText('版本 1',{exact:true}).waitFor()
 await first.getByText('事件连接：已连接',{exact:true}).waitFor()
 const second=await connect()
 await second.getByRole('button',{name:'wiki/concepts/browser-shared.md',exact:true}).click()
 await second.getByText('版本 1',{exact:true}).waitFor()
 await first.getByLabel('Wiki 正文',{exact:true}).fill('# Persistent browser page\n\nAuthoritative second version')
 await first.getByRole('button',{name:'保存 Wiki',exact:true}).click()
 await first.getByText('版本 2',{exact:true}).waitFor()
 await second.getByLabel('Wiki 正文',{exact:true}).fill('Unsaved stale client draft')
 await second.getByRole('button',{name:'保存 Wiki',exact:true}).click()
 await second.getByText('资源已由其他客户端修改。草稿已保留，请复制草稿后刷新再合并。',{exact:true}).waitFor()
 if(await second.getByLabel('Wiki 正文',{exact:true}).inputValue()!=='Unsaved stale client draft')throw new Error('Stale draft was lost')

 const savePage=async(path,body)=>{
  await first.getByRole('button',{name:'新建 Wiki',exact:true}).click()
  await first.getByLabel('Wiki 路径',{exact:true}).fill(path)
  await first.getByLabel('Wiki 正文',{exact:true}).fill(body)
  await first.getByRole('button',{name:'保存 Wiki',exact:true}).click()
  await first.getByText('版本 1',{exact:true}).waitFor()
 }
 await savePage('wiki/concepts/browser-any-all.md','# ANY and ALL classification target')
 await savePage('wiki/concepts/browser-unclassified.md','# Unclassified filter target')
 await first.getByRole('tab',{name:'文档',exact:true}).click()
 const uploadResponse=first.waitForResponse(response=>response.request().method()==='POST'&&response.url().includes('/documents'))
 await first.getByLabel('上传原始文档',{exact:true}).setInputFiles({name:'浏览器资料.md',mimeType:'text/markdown',buffer:Buffer.from('Actual uploaded document')})
 await first.getByText('浏览器资料.md',{exact:true}).waitFor()
 const uploaded=await (await uploadResponse).json(),sourceId=uploaded.data.data.sourceId
 assert.match(sourceId,/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/)
 await first.getByRole('tab',{name:'知识领域',exact:true}).click()
 const addDomain=async name=>{
  await first.getByLabel('新增领域标签',{exact:true}).fill(name)
  await first.getByRole('button',{name:'添加',exact:true}).click()
  await first.getByRole('button',{name:'删除 '+name,exact:true}).waitFor()
 }
 await addDomain('跨端验证领域')
 await addDomain('第二领域')
 const wikiKey=(value)=>`wiki/concepts/${value}.md`
 const saveDomain=async action=>{const pending=first.waitForResponse(r=>r.request().method()==='PUT'&&r.url().includes('/workspace'));await action();const response=await pending;if(!response.ok())throw Error('domain assignment failed: '+response.status())}
 await first.getByRole('tab',{name:'Wiki',exact:true}).click()
 await first.getByLabel('设置领域归类：'+wikiKey('browser-shared')).click()
 await saveDomain(()=>first.getByRole('checkbox',{name:wikiKey('browser-shared')+'：跨端验证领域',exact:true}).check())
 await first.getByLabel('设置领域归类：'+wikiKey('browser-shared')).click()
 await first.getByLabel('设置领域归类：'+wikiKey('browser-any-all')).click()
 await saveDomain(()=>first.getByRole('checkbox',{name:wikiKey('browser-any-all')+'：跨端验证领域',exact:true}).check())
 await saveDomain(()=>first.getByRole('checkbox',{name:wikiKey('browser-any-all')+'：第二领域',exact:true}).check())
 await first.getByLabel('设置领域归类：'+wikiKey('browser-any-all')).click()
 await first.getByRole('tab',{name:'文档',exact:true}).click()
 await first.getByLabel('设置领域归类：浏览器资料.md').click()
 await saveDomain(()=>first.getByRole('checkbox',{name:'浏览器资料.md：第二领域',exact:true}).check())
 await first.getByLabel('设置领域归类：浏览器资料.md').click()

 // A genuine stale workspace CAS keeps the attempted assignment visible as a draft.
 await second.reload()
 await second.getByLabel('当前项目',{exact:true}).waitFor()
 await second.getByRole('tab',{name:'Wiki',exact:true}).waitFor()
 const projectBeforeCas=(await (await first.request.get(origin+'/api/v1/projects')).json()).data.find(item=>item.name==='真实 Web 服务验证').id
 let releaseCas,signalCas
 const casGate=new Promise(resolve=>{releaseCas=resolve}),casStarted=new Promise(resolve=>{signalCas=resolve})
 const workspaceUrl=`**/api/v1/projects/${projectBeforeCas}/workspace`
 await second.route(workspaceUrl,async route=>{if(route.request().method()==='PUT'){signalCas();await casGate}await route.continue()})
 await second.getByLabel('设置领域归类：'+wikiKey('browser-shared')).click()
 const staleAssignment=second.getByRole('checkbox',{name:wikiKey('browser-shared')+'：第二领域',exact:true}).check()
 await casStarted
 await first.getByRole('tab',{name:'知识领域',exact:true}).click()
 await addDomain('并发后新增领域')
 releaseCas()
 await staleAssignment
 await second.getByText('资源已由其他客户端修改。草稿已保留，请复制草稿后刷新再合并。',{exact:true}).waitFor()
 if(!await second.getByRole('checkbox',{name:wikiKey('browser-shared')+'：第二领域',exact:true}).isChecked())throw new Error('CAS conflict discarded the pending domain assignment draft')
 await second.getByLabel('设置领域归类：'+wikiKey('browser-shared')).click()
 await second.unroute(workspaceUrl)

 // Exercise real server-side Wiki filtering for ANY, ALL, unclassified, and clear.
 await first.getByRole('tab',{name:'Wiki',exact:true}).click()
 const waitCount=async(name,count)=>first.waitForFunction(({name,count})=>Array.from(document.querySelectorAll('button')).filter(button=>button.textContent?.trim()===name).length===count,{name,count})
 await first.getByRole('checkbox',{name:'跨端验证领域',exact:true}).check()
 await waitCount(wikiKey('browser-shared'),1);await waitCount(wikiKey('browser-any-all'),1);await waitCount(wikiKey('browser-unclassified'),0)
 await first.getByRole('checkbox',{name:'第二领域',exact:true}).check()
 await waitCount(wikiKey('browser-shared'),1);await waitCount(wikiKey('browser-any-all'),1)
 await first.getByLabel('领域匹配方式',{exact:true}).selectOption('all')
 await waitCount(wikiKey('browser-shared'),0);await waitCount(wikiKey('browser-any-all'),1);await waitCount(wikiKey('browser-unclassified'),0)
 await first.getByRole('button',{name:'清除筛选',exact:true}).click()
 await waitCount(wikiKey('browser-shared'),1);await waitCount(wikiKey('browser-any-all'),1);await waitCount(wikiKey('browser-unclassified'),1)
 await first.getByRole('checkbox',{name:'未分类',exact:true}).check()
 await waitCount(wikiKey('browser-shared'),0);await waitCount(wikiKey('browser-any-all'),0);await waitCount(wikiKey('browser-unclassified'),1)
 await first.getByRole('button',{name:'清除筛选',exact:true}).click()

 // Revisions of one source keep the same canonical domain assignment.
 const revisionResponse=await first.request.post(`${origin}/api/v1/projects/${projectBeforeCas}/documents`,{headers:{Origin:origin,'X-KW-CSRF':'1','Content-Type':'text/markdown','X-File-Name':encodeURIComponent('浏览器资料.md'),'Idempotency-Key':'d03c-'+randomBytes(12).toString('hex'),'X-Source-Id':sourceId},data:Buffer.from('Actual second source revision')})
 assert.equal(revisionResponse.status(),201)
 const storedWorkspace=(await (await first.request.get(`${origin}/api/v1/projects/${projectBeforeCas}/workspace`)).json()).data.data
 assert.deepEqual(storedWorkspace.resourceDomains[`raw/documents/${sourceId}`],[''+storedWorkspace.domains.find(domain=>domain.name==='第二领域').id])
 const filteredDocuments=await (await first.request.get(`${origin}/api/v1/projects/${projectBeforeCas}/documents?domainId=${encodeURIComponent(storedWorkspace.domains.find(domain=>domain.name==='第二领域').id)}&domainMatch=any&unclassified=0`)).json()
 assert.ok(filteredDocuments.data.some(record=>record.data.sourceId===sourceId),'stable source filter omitted its later revision')
 await first.reload()
 await first.getByLabel('当前项目',{exact:true}).waitFor()
 await first.getByRole('tab',{name:'文档',exact:true}).click()
 await first.getByRole('checkbox',{name:'第二领域',exact:true}).check()
 const sourceRevisionRows=first.getByText('浏览器资料.md',{exact:true})
 assert.equal(await sourceRevisionRows.count(),2,'both revisions of the stable source should appear in the filtered list')

 // Removing a selected domain prunes the stale filter and refetches the list.
 await first.getByRole('tab',{name:'知识领域',exact:true}).click()
 await first.getByRole('button',{name:'删除 第二领域',exact:true}).click()
 await first.getByRole('tab',{name:'文档',exact:true}).click()
 await first.getByRole('status').filter({hasText:'已删除领域已从筛选中移除'}).waitFor()
 if(await first.getByRole('checkbox',{name:'第二领域',exact:true}).count())throw new Error('Deleted domain remained in the active filter')

 // Switching projects clears selections without carrying IDs into another workspace.
 await first.getByRole('tab',{name:'Wiki',exact:true}).click()
 await first.getByRole('checkbox',{name:'跨端验证领域',exact:true}).check()
 await first.getByLabel('新项目名称',{exact:true}).fill('过滤切换验证项目')
 await first.getByRole('button',{name:'创建项目',exact:true}).click()
 await first.getByLabel('当前项目',{exact:true}).selectOption({label:'过滤切换验证项目'})
 await first.getByRole('checkbox',{name:'未分类',exact:true}).waitFor()
 if(await first.getByLabel('领域匹配方式',{exact:true}).inputValue()!=='any')throw new Error('Project switch retained the previous match mode')
 await first.getByLabel('当前项目',{exact:true}).selectOption({label:'真实 Web 服务验证'})
 await first.getByRole('checkbox',{name:'跨端验证领域',exact:true}).waitFor()
 if(await first.getByRole('checkbox',{name:'跨端验证领域',exact:true}).isChecked())throw new Error('Project switch retained the previous domain selection')

 await first.getByRole('tab',{name:'记忆库',exact:true}).click()
 await first.getByRole('button',{name:'新建记忆',exact:true}).click()
 await first.getByLabel('标题',{exact:true}).fill('共享记忆浏览器验证')
 await first.getByLabel('内容',{exact:true}).fill('Stored through the shared workspace API')
 await first.getByRole('checkbox',{name:'跨端验证领域',exact:true}).check()
 await first.getByRole('button',{name:'保存',exact:true}).click()
 await first.getByRole('button',{name:/共享记忆浏览器验证/}).waitFor()
 const data=await (await first.request.get(origin+'/api/v1/projects')).json()
 const project=data.data.find(item=>item.name==='真实 Web 服务验证').id
 const workspace=await (await first.request.get(`${origin}/api/v1/projects/${project}/workspace`)).json()
 if(workspace.data.data.memories[0]?.title!=='共享记忆浏览器验证')throw new Error('Memory was not persisted on the service')
 const stored=await (await first.request.get(`${origin}/api/v1/projects/${project}/wiki/page?path=wiki/concepts/browser-shared.md`)).json()
 if(!stored.data.data.content.includes('Authoritative second version'))throw new Error('Conflict overwrote the authoritative version')
 const files=await (await first.request.get(`${origin}/api/v1/projects/${project}/documents`)).json()
 if(files.data[0]?.data.status!=='received'||files.data[0].data.sourceIngestedAt!==null)throw new Error('Upload misreported ingestion completion')
 // Real identity management, role switching and audit UI.
 await first.getByRole('button',{name:'身份与授权',exact:true}).click()
 const createAccount=async(handle,kind)=>{
  await first.getByRole('tab',{name:'账号管理',exact:true}).click()
  await first.getByLabel('新账号',{exact:true}).fill(handle)
  await first.getByLabel('账号类型',{exact:true}).selectOption(kind)
  if(kind!=='agent')await first.getByLabel('初始密码',{exact:true}).fill(password)
  await first.getByRole('button',{name:'创建账号',exact:true}).click()
  await first.getByRole('button',{name:'停用 '+handle,exact:true}).waitFor()
 }
 await createAccount('alice','user');await createAccount('robot','agent')
 await first.getByRole('tab',{name:'工作角色',exact:true}).click()
 await first.getByLabel('角色名称',{exact:true}).fill('审阅者')
 await first.getByRole('button',{name:'保存工作角色',exact:true}).click()
 await first.getByRole('tab',{name:'项目成员',exact:true}).click()
 await first.getByLabel('成员账号',{exact:true}).selectOption({label:'alice · user'})
 await first.getByLabel('成员权限',{exact:true}).selectOption('editor')
 await first.getByRole('checkbox',{name:'审阅者',exact:true}).check()
 await first.getByRole('button',{name:'保存项目成员',exact:true}).click()
 await first.getByText('alice · editor · active',{exact:true}).waitFor()
 await first.getByLabel('成员账号',{exact:true}).selectOption({label:'robot · agent'})
 await first.getByLabel('成员权限',{exact:true}).selectOption('editor')
 await first.getByRole('button',{name:'保存项目成员',exact:true}).click()
 await first.getByText('robot · editor · active',{exact:true}).waitFor()
 await first.getByRole('tab',{name:'Agent Token',exact:true}).click()
 await first.getByLabel('Agent 账号',{exact:true}).selectOption({label:'robot'})
 await first.getByLabel('Token 名称',{exact:true}).fill('browser-reader')
 await first.getByRole('button',{name:'创建 Agent Token',exact:true}).click()
 const raw=await first.getByLabel('一次性 Token',{exact:true}).inputValue();assert.match(raw,/^kwt_/)
 const publicTokens=await (await first.request.get(origin+'/api/v1/auth/tokens')).json();assert.ok(!JSON.stringify(publicTokens).includes(raw))
 assert.equal(await first.evaluate(()=>Object.keys(localStorage).length+Object.keys(sessionStorage).length),0)
 await first.getByRole('button',{name:'我已保存，隐藏',exact:true}).click();assert.equal(await first.getByLabel('一次性 Token',{exact:true}).count(),0)
 const tokenHeaders={Authorization:`Bearer ${raw}`,'Content-Type':'application/json','If-None-Match':'*'}
 assert.equal((await fetch(`${origin}/api/v1/projects/${project}/wiki/page?path=wiki/no.md`,{method:'PUT',headers:tokenHeaders,body:JSON.stringify({content:'denied'})})).status,403)
 const alice=await connect('alice')
 await alice.getByRole('button',{name:wikiKey('browser-shared'),exact:true}).waitFor()
 await alice.getByLabel('Wiki 正文',{exact:true}).fill('Unsaved role-switch draft')
 alice.once('dialog',dialog=>dialog.dismiss())
 await alice.getByLabel('有效身份与工作角色',{exact:true}).selectOption({label:'alice · 审阅者'})
 assert.equal(await alice.getByLabel('Wiki 正文',{exact:true}).inputValue(),'Unsaved role-switch draft')
 alice.once('dialog',dialog=>dialog.accept())
 await alice.getByLabel('有效身份与工作角色',{exact:true}).selectOption({label:'alice · 审阅者'})
 await alice.getByText('当前权限：project.read · wiki.read',{exact:true}).waitFor()
 assert.equal(await alice.getByRole('button',{name:'保存 Wiki',exact:true}).isDisabled(),true)
 if(await alice.getByLabel('设置领域归类：'+wikiKey('browser-shared'),{exact:true}).count())throw new Error('Read-only identity saw a writable Wiki domain assignment control')
 const accounts=await (await first.request.get(origin+'/api/v1/admin/accounts')).json(),aliceId=accounts.data.catalog.accounts.find(account=>account.handle==='alice').id
 const delegationResponse=await first.request.post(`${origin}/api/v1/projects/${project}/delegations`,{headers:{'X-KW-CSRF':'1'},data:{granteeId:aliceId,permissions:['project.read','wiki.read','wiki.write'],expiresAt:new Date(Date.now()+86400000).toISOString()}});assert.equal(delegationResponse.status(),201)
 await alice.getByRole('button',{name:'刷新身份授权',exact:true}).click()
 await alice.getByLabel('有效身份与工作角色',{exact:true}).selectOption({label:'浏览器管理员 · 获授权身份'})
 await alice.getByText(/真实操作者：alice.*有效身份：浏览器管理员/).waitFor()
 await alice.getByLabel('Wiki 路径',{exact:true}).fill('wiki/queries/delegated.md')
 await alice.getByLabel('Wiki 正文',{exact:true}).fill('Created through explicitly delegated identity')
 await alice.getByRole('button',{name:'保存 Wiki',exact:true}).click();await alice.getByText('版本 1',{exact:true}).waitFor()
 await first.getByRole('tab',{name:'授权审计',exact:true}).click()
 await first.getByRole('button',{name:'查询审计',exact:true}).click()
 await first.getByRole('cell',{name:'PUT /api/v1/projects/:id/wiki/page',exact:true}).first().waitFor()
 const audit=await (await first.request.get(`${origin}/api/v1/projects/${project}/audit?limit=100`)).json()
 assert.ok(audit.data.items.some(entry=>entry.actorId===aliceId&&entry.effectiveAccountId!==aliceId&&entry.action==='PUT /api/v1/projects/:id/wiki/page'))
 assert.ok(!JSON.stringify(audit).includes(raw));assert.ok(!JSON.stringify(audit).includes(password))
 await first.screenshot({path:'/tmp/kw-c10-authenticated.png',fullPage:false})
 await first.getByRole('tab',{name:'Agent Token',exact:true}).click();await first.getByRole('button',{name:'吊销 browser-reader',exact:true}).click()
 assert.equal((await fetch(origin+'/api/v1/auth/me',{headers:{Authorization:`Bearer ${raw}`}})).status,401)
 await alice.getByRole('button',{name:'退出登录',exact:true}).click();await alice.getByRole('button',{name:'登录',exact:true}).waitFor()
 assert.equal((await alice.request.get(origin+'/api/v1/auth/me')).status(),401)
 await first.reload();await first.getByLabel('当前项目',{exact:true}).waitFor()
 if(errors.length)throw new Error(errors.join('\n'))
 console.log(JSON.stringify({result:'passed',pageErrors:errors,checks:['admin initialization and cookie login','independent browser sessions and restore','real API without native mock','Wiki persistence and CAS draft preservation','authenticated SSE and real binary uploads','domain and memory writes','account role membership management UI','one-time Token mint conceal and revocation','role-switch draft cancel and readonly scope','explicit delegated identity UI and write','actual/effective audit without secrets','logout invalidation']}))
} finally {
 if(browser)await browser.close()
 service.kill('SIGTERM')
 await new Promise(resolve=>{if(service.exitCode!==null)resolve();else{service.once('exit',resolve);setTimeout(()=>{service.kill('SIGKILL');resolve()},3000).unref()}})
 rmSync(directory,{recursive:true,force:true})
}
