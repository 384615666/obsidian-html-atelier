import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Worker} from 'node:worker_threads';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {runRegexpSearch,sanitizeFlags,compileRegex,RegexpInputError} from '../src/services/regexp/regexpCore';
import {TaskHost,TaskTimeoutError,WorkerTransport} from '../src/services/regexp/workerHost';
import {RegExpSearchAdapter} from '../src/services/regexp/regexpSearch';

test('A17 正则核心：零长度匹配按 Unicode 字符边界前进',()=>{
 const r=runRegexpSearch('bab','a*','',100,10000);
 // 命中：空@0、a@1、空@2、空@3 —— 不死循环
 assert.equal(r.matches.length,4);
 assert.deepEqual(r.matches.map(m=>[m.start,m.end]),[[0,0],[1,2],[2,2],[3,3]]);
 // 代理对：零长度前进跨过完整码点
 const r2=runRegexpSearch('\ud83d\ude00x','\ud83d\ude00*','',100,10000);
 assert.ok(r2.matches.every(m=>m.text===''||m.text==='\ud83d\ude00'));
});

test('A17 正则核心：匹配数与迭代上限；非法表达式与非法旗标拒绝',()=>{
 const capped=runRegexpSearch('aaaa','a','',2,10000);
 assert.equal(capped.matches.length,2);
 assert.equal(capped.truncated,true);
 // 迭代上限按 exec 调用计数；进程内无法中止单次 exec 的灾难性回溯（由 Worker 超时终止防护）
 assert.throws(()=>runRegexpSearch('x'.repeat(1000),'x*?','',5000,500),RegexpInputError);
 assert.throws(()=>compileRegex('([',''),RegexpInputError);
 assert.equal(sanitizeFlags('ggimq'),'gim'); // 非法旗标字符被剔除
 const r=runRegexpSearch('Hello hello','hello','i',100,10000);
 assert.equal(r.matches.length,2);
});

test('A17 迭代超限抛出错误而不是无限循环',()=>{
 assert.throws(()=>runRegexpSearch('x'.repeat(2000),'x*?','',5000,300),RegexpInputError);
});

// —— Worker 通道（真实子进程）——
interface MockClient {handler:(msg:unknown)=>void; post:(msg:unknown)=>void}

test('A17 Worker 通道：搜索成功、修订号回显、结构校验',async()=>{
 mkdirSync('test-results',{recursive:true});
 await build({entryPoints:['src/services/regexp/worker.node.ts'],outfile:'test-results/regexp-worker-node.cjs',bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
 const workerPath=resolve('test-results/regexp-worker-node.cjs');
 const factory=():WorkerTransport=>{
  const w=new Worker(workerPath);
  return {post:m=>w.postMessage(m),terminate:()=>void w.terminate(),onMessage:cb=>w.on('message',cb)};
 };
 const host=new TaskHost(factory,{timeoutMs:3000});
 const adapter=new RegExpSearchAdapter(host);
 try{
  const r=await adapter.search({text:'中文 abc 中文','pattern':'中文',flags:'g',revision:7});
  assert.equal(r.revision,7);
  assert.equal(r.matches.length,2);
  assert.deepEqual([r.matches[0].start,r.matches[0].end],[0,2]);
  // 无效正则不进入 worker
  await assert.rejects(()=>adapter.search({text:'x','pattern':'([',flags:'',revision:1}),RegexpInputError);
 }finally{host.dispose();}
});

test('A17 修订号不一致的旧结果被拒绝（mock 通道）',async()=>{
 let client:MockClient|null=null;
 const factory=():WorkerTransport=>{
  const c:MockClient={handler:()=>{},post:()=>{}};
  client=c;
  return {post:()=>{},terminate:()=>{},onMessage:cb=>{c.handler=cb;}};
 };
 const host=new TaskHost(factory,{timeoutMs:2000});
 const adapter=new RegExpSearchAdapter(host);
 try{
  const p=adapter.search({text:'x',pattern:'x',flags:'',revision:5});
  // 模拟 worker 回显了过期修订号
  client?.handler({requestId:1,ok:true,result:{matches:[{start:0,end:1,text:'x',groups:[]}],truncated:false,revision:4}});
  await assert.rejects(()=>p,/修订号/);
 }finally{host.dispose();}
});

test('A17 灾难性回溯由超时终止 Worker，终止后新任务正常',async()=>{
 const workerPath=resolve('test-results/regexp-worker-node.cjs');
 const factory=():WorkerTransport=>{
  const w=new Worker(workerPath);
  return {post:m=>w.postMessage(m),terminate:()=>void w.terminate(),onMessage:cb=>w.on('message',cb)};
 };
 const host=new TaskHost(factory,{timeoutMs:250});
 try{
  const started=Date.now();
  await assert.rejects(()=>host.run({type:'regexp-search',text:'a'.repeat(42)+'b',pattern:'(a+)+$',flags:'',maxMatches:10,maxIterations:2_000_000,revision:1}),TaskTimeoutError);
  const elapsed=Date.now()-started;
  assert.ok(elapsed<2000,`超时应及时终止，实际 ${elapsed}ms`);
  assert.equal(host.activeTaskCount,0);
  // Worker 已被终止：下一个任务重新创建并正常完成
  const ok=await host.run({type:'regexp-search',text:'abc','pattern':'b',flags:'',maxMatches:10,maxIterations:1000,revision:2});
  assert.equal((ok as {matches:{start:number}[]}).matches[0].start,1);
 }finally{host.dispose();}
});

test('A17 取消任务后延迟到达的旧结果被丢弃',async()=>{
 // 可控的 mock 传输：手动投递回复
 let client:MockClient|null=null;
 const factory=():WorkerTransport=>{
  const c:MockClient={handler:()=>{},post:()=>{}};
  client=c;
  return {post:()=>{},terminate:()=>{},onMessage:cb=>{c.handler=cb;}};
 };
 const host=new TaskHost(factory,{timeoutMs:5000});
 const p1=host.run({type:'regexp-search',text:'x','pattern':'x',flags:'',maxMatches:1,maxIterations:10,revision:1}).catch(e=>e);
 host.cancelAll('切换视图');
 assert.equal((await p1 as Error).message,'切换视图');
 assert.equal(host.activeTaskCount,0);
 // 延迟回复（旧 requestId=1）应被丢弃而不影响后续任务
 client?.handler({requestId:1,ok:true,result:{matches:[],truncated:false,revision:1}});
 const p2=host.run({type:'regexp-search',text:'abc','pattern':'c',flags:'',maxMatches:1,maxIterations:10,revision:2});
 client?.handler({requestId:2,ok:true,result:{matches:[{start:2,end:3,text:'c',groups:[]}],truncated:false,revision:2}});
 assert.equal((await p2).matches[0].text,'c');
 host.dispose();
});

test('A17 audit 回归:cancelAll 终止 Worker,后续任务不被灾难任务饿死(audit/services rx2#10)',async()=>{
 const workerPath=resolve('test-results/regexp-worker-node.cjs');
 const factory=():WorkerTransport=>{
  const w=new Worker(workerPath);
  return {post:m=>w.postMessage(m),terminate:()=>void w.terminate(),onMessage:cb=>w.on('message',cb)};
 };
 const host=new TaskHost(factory,{timeoutMs:2000});
 try{
  const catastrophic=host.run({type:'regexp-search',text:'a'.repeat(42)+'b',pattern:'(a+)+$',flags:'',maxMatches:10,maxIterations:2_000_000,revision:1}).catch(e=>e);
  await new Promise(r=>setTimeout(r,100)); // 让灾难任务进入执行
  host.cancelAll('切换视图');
  assert.match(String(await catastrophic),/切换视图/);
  // 若 cancelAll 未终止 worker,灾难任务仍在占用通道,下一个任务会饿到超时
  const next=await host.run({type:'regexp-search',text:'abc','pattern':'b',flags:'',maxMatches:10,maxIterations:1000,revision:2},500);
  assert.equal((next as {matches:{start:number}[]}).matches[0].start,1);
 }finally{host.dispose();}
});
