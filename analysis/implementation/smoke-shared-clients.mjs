/** Actual CLI subprocess + MCP stdio client, temporary SQLite and ephemeral credentials only. */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createServer} from 'node:net'
import {pathToFileURL} from 'node:url'
const {Client}=await import(pathToFileURL(resolve('mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')).href)
const {StdioClientTransport}=await import(pathToFileURL(resolve('mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')).href)
const pick=createServer(); await new Promise(done=>pick.listen(0,'127.0.0.1',done));const port=pick.address().port;await new Promise(done=>pick.close(done))
const directory=mkdtempSync(join(tmpdir(),'kw-clients-')),key=randomBytes(32).toString('hex'),password=randomBytes(24).toString('hex'),origin=`http://127.0.0.1:${port}`
let service=spawn(process.execPath,['dist-service/server.mjs'],{env:{...process.env,KW_BOOTSTRAP_KEY:key,KW_SERVICE_DATA:directory,KW_SERVICE_PORT:String(port)},stdio:['ignore','pipe','pipe']})
let cookie='',mcp
try {
 await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Service startup timeout')),15000);service.stdout.on('data',chunk=>{if(String(chunk).includes('listening')){clearTimeout(timer);done()}});service.once('exit',()=>{clearTimeout(timer);reject(new Error('Service exited'))})})
 const request=async(path,method='GET',body,extra={})=>{const response=await fetch(origin+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie,'X-KW-CSRF':'1'}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});const json=await response.json();assert.ok(response.ok,JSON.stringify(json.error));return {response,data:json.data}}
 await request('/auth/bootstrap','POST',{handle:'admin',displayName:'Admin',password},{'X-KW-Setup-Key':key})
 cookie=(await request('/auth/login','POST',{handle:'admin',password})).response.headers.get('set-cookie').split(';')[0]
 const project=(await request('/projects','POST',{name:'Client smoke'})).data
 let state=(await request('/admin/accounts')).data
 state=(await request('/admin/accounts','POST',{revision:state.revision,handle:'robot',displayName:'Robot',kind:'agent'})).data
 const agent=state.catalog.accounts.find(account=>account.kind==='agent')
 await request(`/projects/${project.id}/members`,'PUT',{revision:state.revision,accountId:agent.id,permissionRole:'editor',workRoleIds:[]})
 const mint=async permissions=>(await request('/auth/tokens','POST',{accountId:agent.id,projectId:project.id,label:'Smoke',workRoleId:null,permissions,expiresAt:new Date(Date.now()+86400000).toISOString()})).data
 const writer=await mint(['project.read','wiki.read','wiki.write']),reader=await mint(['project.read','wiki.read']),memoryReader=await mint(['project.read','wiki.read','memory.read'])
 const cli=(token,operation,input)=>new Promise((done,reject)=>{const child=spawn(process.execPath,['dist-service/cli.mjs',project.id,operation],{env:{...process.env,KW_API_URL:origin,KW_AGENT_TOKEN:token},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.once('error',reject);child.once('exit',code=>done({code,stdout,stderr}));child.stdin.end(JSON.stringify(input))})
 assert.equal((await cli(writer.secret,'wiki.write',{path:'wiki/cli.md',content:'CLI persisted evidence',expectedRevision:null})).code,0)
 assert.match((await cli(reader.secret,'wiki.read',{path:'wiki/cli.md'})).stdout,/CLI persisted evidence/)
 const denied=await cli(reader.secret,'wiki.write',{path:'wiki/cli.md',content:'denied',expectedRevision:1});assert.equal(denied.code,1);assert.ok(!denied.stderr.includes(reader.secret))
 const noMemory=await cli(reader.secret,'memory.summaries',{limit:5});assert.equal(noMemory.code,1);assert.ok(!noMemory.stderr.includes(reader.secret))
 assert.equal((await cli(memoryReader.secret,'memory.summaries',{limit:5})).code,0)
 const submitted=await cli(writer.secret,'proposal.submit',{target:{kind:'memory',memoryId:null,payload:{title:'CLI proposal',content:'pending only'}},idempotencyKey:'smoke-cli-proposal',evidence:[{source:'doc',ref:'smoke'}]});assert.equal(submitted.code,0)
 const listed=await cli(memoryReader.secret,'proposal.list',{});assert.equal(listed.code,0);assert.match(listed.stdout,/"status":"pending"/)
 mcp=new Client({name:'kw-client-smoke',version:'1.0.0'})
 await mcp.connect(new StdioClientTransport({command:process.execPath,args:[resolve('mcp-server/dist/src/shared.js')],env:{...process.env,KW_API_URL:origin,KW_AGENT_TOKEN:memoryReader.secret,KW_PROJECT_ID:project.id},stderr:'pipe'}))
 assert.equal((await mcp.listTools()).tools.length,11)
 const summaries=await mcp.callTool({name:'kw_memory_summaries',arguments:{limit:5}});assert.ok(!summaries.isError);assert.ok(Array.isArray(JSON.parse(summaries.content[0].text).items))
 const proposals=await mcp.callTool({name:'kw_proposal_list',arguments:{}});assert.ok(!proposals.isError);assert.match(proposals.content[0].text,/"status":"pending"/)
 const submitDenied=await mcp.callTool({name:'kw_proposal_submit',arguments:{target:{kind:'memory',memoryId:null,payload:{title:'MCP denied',content:'denied'}},idempotencyKey:'smoke-mcp-denied',evidence:[{source:'doc',ref:'x'}]}});assert.equal(submitDenied.isError,true)
 const read=await mcp.callTool({name:'kw_wiki_read',arguments:{path:'wiki/cli.md'}});assert.ok(!read.isError);assert.match(read.content[0].text,/CLI persisted evidence/)
 const write=await mcp.callTool({name:'kw_wiki_write',arguments:{path:'wiki/cli.md',content:'denied',expectedRevision:1}});assert.equal(write.isError,true)
 const cross=await mcp.callTool({name:'kw_wiki_read',arguments:{projectId:'other',path:'wiki/cli.md'}});assert.equal(cross.isError,true)
 await request('/auth/tokens/'+memoryReader.token.id,'DELETE')
 assert.equal((await mcp.callTool({name:'kw_wiki_read',arguments:{path:'wiki/cli.md'}})).isError,true)
 await mcp.close();mcp=undefined
 service.kill('SIGTERM');await new Promise(done=>service.once('exit',done))
 const restartedEnv={...process.env,KW_SERVICE_DATA:directory,KW_SERVICE_PORT:String(port)};delete restartedEnv.KW_BOOTSTRAP_KEY;delete restartedEnv.KW_SERVICE_TOKEN
 service=spawn(process.execPath,['dist-service/server.mjs'],{env:restartedEnv,stdio:['ignore','pipe','pipe']})
 await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Restart without initialization key timed out')),15000);service.stdout.on('data',chunk=>{if(String(chunk).includes('listening')){clearTimeout(timer);done()}});service.once('exit',()=>{clearTimeout(timer);reject(new Error('Restarted service exited'))})})
 assert.match((await cli(writer.secret,'wiki.read',{path:'wiki/cli.md'})).stdout,/CLI persisted evidence/)
 const persistedAudit=await request(`/projects/${project.id}/audit?limit=100`)
 assert.ok(persistedAudit.data.items.some(entry=>entry.action==='POST /api/v1/projects/:id/mcp'))
 console.log(JSON.stringify({result:'passed',checks:['real CLI write/read','CLI readonly denial without secret echo','CLI memory.summaries permission split','CLI proposal.submit then proposal.list pending','MCP stdio handshake and 11 tools','MCP memory.summaries read','MCP proposal.list pending','MCP proposal.submit denied without wiki.write','MCP read/write scope','MCP project pin','revocation while connected','service restart without bootstrap key','session Token content and audit persistence']}))
} finally {await mcp?.close();service.kill('SIGTERM');await new Promise(done=>{if(service.exitCode!==null||service.signalCode!==null)done();else service.once('exit',done)});rmSync(directory,{recursive:true,force:true})}
