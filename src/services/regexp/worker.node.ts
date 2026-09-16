import {parentPort} from 'node:worker_threads';
import {runRegexpSearch,RegexpInputError} from './regexpCore';

// Node worker_threads 入口：仅用于 Node 测试环境（报告 §12.7 的浏览器入口为 worker.browser.ts，
// 由构建打包为独立脚本经 Blob URL 加载，见 D0-08 验证）。
if(!parentPort)throw new Error('worker.node.ts 只能在 worker_threads 环境运行');
parentPort.on('message',(raw:unknown)=>{
 const port=parentPort!;
 if(typeof raw!=='object'||raw===null)return;
 const req=raw as Record<string,unknown>;
 if(req.type!=='regexp-search'||typeof req.requestId!=='number')return;
 try{
  const result=runRegexpSearch(String(req.text),String(req.pattern),String(req.flags),
   typeof req.maxMatches==='number'?req.maxMatches:5000,
   typeof req.maxIterations==='number'?req.maxIterations:2000000);
  port.postMessage({requestId:req.requestId,ok:true,result:{...result,revision:req.revision}});
 }catch(e){
  port.postMessage({requestId:req.requestId,ok:false,
   error:e instanceof RegexpInputError?e.message:`worker 错误：${e instanceof Error?e.message:String(e)}`});
 }
});
