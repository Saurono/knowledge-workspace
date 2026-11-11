import fs from 'node:fs/promises';

import ts from 'typescript';
import assert from 'node:assert/strict';
// Transpile the actual service; resolve its sole runtime dependency without a build artifact.
const root = new URL('../', import.meta.url);
const source = await fs.readFile(new URL('src/modules/retrieval/application/search.ts', root), 'utf8');
const model = await fs.readFile(new URL("src/modules/retrieval/domain/model.ts", root), "utf8");
const normalizer = model.split(/\r?\n/).find(line => line.startsWith("export const normalizeRetrievalPath"));
assert.ok(normalizer, 'real normalizer located');
const js = ts.transpileModule(source.replace('import { normalizeRetrievalPath } from "../domain"', normalizer), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const { createRetrievalService } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const dir = new URL('analysis/evaluation/fixtures/retrieval-corpus/', root);
const docs = [];
for (const name of (await fs.readdir(dir)).filter(n=>n.endsWith('.md')).sort()) {
 const content = await fs.readFile(new URL(name,dir),'utf8');
 const meta = Object.fromEntries([...content.matchAll(/^(id|lang|domain|projectId): (.+)$/gm)].map(m=>[m[1],m[2]]));
 docs.push({...meta,content:content.split('---')[2],path:name});
}
// Deterministic two-dimensional fake embedding; no provider calls.
const embed = text => [text.length, [...text].reduce((sum,c)=>sum+c.codePointAt(0),0)%997];
let lastRequest;
const index = {async search(input) {
 lastRequest=input;
 const query=input.query.toLowerCase(); const vector=embed(query);
 const results=docs.filter(d=>!input.domainFilter || input.domainFilter.includes(d.domain)).map(d=>{
 const title=d.content.match(/# (.+)/)[1];
 const score=query.includes(title.toLowerCase())?10:0;
 return {...d,title,snippet:d.content,images:[],titleMatch:score>0,score,vectorScore:1/(1+Math.abs(embed(d.content)[0]-vector[0]))};
 }).filter(d=>d.score>0).sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id,'en')).slice(0,input.topK);
 return {mode:'hybrid',results,tokenHits:results.length,vectorHits:results.length};
}};
const service=createRetrievalService(index);
const queries=JSON.parse(await fs.readFile(new URL('queries.json',dir),'utf8'));
let r5=0,r10=0,citations=0,positive=0,empty=0,falsePositive=0,unauthorized=0;
for(const q of queries){
 const options={topK:10,...(q.accessScope?{accessScope:q.accessScope}:{}),...(q.domainFilter?{domainFilter:q.domainFilter}:{})};
 const result=await service.evidence('/fixture',q.query,options);
 assert.deepEqual(lastRequest.accessScope,q.accessScope,`${q.id}: scope forwarding`);
 assert.deepEqual(lastRequest.domainFilter,q.domainFilter,`${q.id}: domain forwarding`);
 if(q.expectedDeniedCount!==undefined) assert.equal(result.deniedCount,q.expectedDeniedCount,`${q.id}: deniedCount`);
 unauthorized+=result.results.filter(d=>q.accessScope && !q.accessScope.allowedProjectIds.includes(d.projectId)).length;
 const ids=result.results.map(d=>d.id);
 if(q.expectedDocIds.length){positive++; r5+=q.expectedDocIds.filter(id=>ids.slice(0,5).includes(id)).length/q.expectedDocIds.length;r10+=q.expectedDocIds.filter(id=>ids.includes(id)).length/q.expectedDocIds.length;citations+=q.expectedDocIds.filter(id=>result.evidence.some(e=>e.id===id && e.citation>0 && e.text.length>0)).length/q.expectedDocIds.length;}else{empty++;falsePositive+=ids.length>0?1:0;}
}
console.log(JSON.stringify({'recall@5':r5/positive,'recall@10':r10/positive,citationHitRate:citations/positive,emptyFalsePositiveRate:falsePositive/empty,unauthorizedReturnCount:unauthorized,documents:docs.length,queries:queries.length},null,2));
if(unauthorized>0) process.exitCode=1;

