/** Real standalone service + Web UI, isolated temporary data and ephemeral credentials. */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core')
const directory=mkdtempSync(join(tmpdir(),'kw-shared-browser-')),token=randomBytes(32).toString('hex')
const port=14331,origin=`http://127.0.0.1:${port}`
const service=spawn(process.execPath,['dist-service/server.mjs'],{cwd:process.cwd(),env:{...process.env,KW_SERVICE_TOKEN:token,KW_SERVICE_DATA:directory,KW_SERVICE_PORT:String(port)},stdio:['ignore','pipe','pipe']})
let browser
try {
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Standalone service startup timed out')),15000)
  service.stdout.on('data',data=>{if(String(data).includes('listening')){clearTimeout(timer);resolve()}})
  service.once('exit',code=>{clearTimeout(timer);reject(new Error('Standalone service exited: '+code))})
 })
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
 const errors=[],context=await browser.newContext({viewport:{width:1440,height:1100}})
 const connect=async()=>{
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))
  await page.goto(origin);await page.getByLabel('服务访问密钥',{exact:true}).fill(token);await page.getByRole('button',{name:'连接服务',exact:true}).click()
  await page.getByLabel('当前项目',{exact:true}).waitFor()
  if(await page.evaluate(()=>!!window.__TAURI_INTERNALS__))throw new Error('Web UI must use the API without a mock native runtime')
  return page
 }
 const first=await connect()
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
 await first.getByRole('tab',{name:'文档',exact:true}).click()
 await first.getByLabel('上传原始文档',{exact:true}).setInputFiles({name:'浏览器资料.md',mimeType:'text/markdown',buffer:Buffer.from('Actual uploaded document')})
 await first.getByText('浏览器资料.md',{exact:true}).waitFor()
 await first.getByRole('tab',{name:'知识领域',exact:true}).click()
 await first.getByLabel('新增领域标签',{exact:true}).fill('跨端验证领域')
 await first.getByRole('button',{name:'添加',exact:true}).click()
 await first.getByRole('button',{name:'删除 跨端验证领域',exact:true}).waitFor()
 await first.getByRole('tab',{name:'记忆库',exact:true}).click()
 await first.getByRole('button',{name:'新建记忆',exact:true}).click()
 await first.getByLabel('标题',{exact:true}).fill('共享记忆浏览器验证')
 await first.getByLabel('内容',{exact:true}).fill('Stored through the shared workspace API')
 await first.getByRole('checkbox',{name:'跨端验证领域',exact:true}).check()
 await first.getByRole('button',{name:'保存',exact:true}).click()
 await first.getByRole('button',{name:/共享记忆浏览器验证/}).waitFor()
 const data=await (await fetch(origin+'/api/v1/projects',{headers:{Authorization:`Bearer ${token}`}})).json()
 const project=data.data[0].id
 const workspace=await (await fetch(`${origin}/api/v1/projects/${project}/workspace`,{headers:{Authorization:`Bearer ${token}`}})).json()
 if(workspace.data.data.memories[0]?.title!=='共享记忆浏览器验证')throw new Error('Memory was not persisted on the service')
 const stored=await (await fetch(`${origin}/api/v1/projects/${project}/wiki/page?path=wiki/concepts/browser-shared.md`,{headers:{Authorization:`Bearer ${token}`}})).json()
 if(!stored.data.data.content.includes('Authoritative second version'))throw new Error('Conflict overwrote the authoritative version')
 const files=await (await fetch(`${origin}/api/v1/projects/${project}/documents`,{headers:{Authorization:`Bearer ${token}`}})).json()
 if(files.data[0]?.data.status!=='received'||files.data[0].data.sourceIngestedAt!==null)throw new Error('Upload misreported ingestion completion')
 if(errors.length)throw new Error(errors.join('\n'))
 console.log(JSON.stringify({result:'passed',pageErrors:errors,checks:['standalone service static Web entry','real API with no native mock','project/Wiki persistence','two-client revision conflict preserves draft','authenticated SSE','binary document upload stays received','domain and memory API writes']}))
} finally {
 if(browser)await browser.close()
 service.kill('SIGTERM')
 await new Promise(resolve=>{if(service.exitCode!==null)resolve();else{service.once('exit',resolve);setTimeout(()=>{service.kill('SIGKILL');resolve()},3000).unref()}})
 rmSync(directory,{recursive:true,force:true})
}
