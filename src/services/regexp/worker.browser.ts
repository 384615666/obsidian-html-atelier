import {runRegexpSearch,RegexpInputError} from './regexpCore';
import type {WorkerReply} from './protocol';

// 浏览器 Worker 入口（报告 §12.7）：构建期独立打包、运行时经 Blob URL 创建；
// 是否允许该创建方式由 D0-08 实测确定。本文件不 import 任何宿主模块。
const ctx=self as unknown as {
 onmessage:(event:MessageEvent)=>void;
 postMessage:(msg:WorkerReply)=>void;
};
ctx.onmessage=(event:MessageEvent)=>{
 const raw=event.data as unknown;
 if(typeof raw!=='object'||raw===null)return;
 const req=raw as Record<string,unknown>;
 if(req.type!=='regexp-search'||typeof req.requestId!=='number')return;
 let reply:WorkerReply;
 try{
  const result=runRegexpSearch(String(req.text),String(req.pattern),String(req.flags),
   typeof req.maxMatches==='number'?req.maxMatches:5000,
   typeof req.maxIterations==='number'?req.maxIterations:2000000);
  reply={requestId:req.requestId,ok:true,result:{...result,revision:req.revision}};
 }catch(e){
  reply={requestId:req.requestId,ok:false,
   error:e instanceof RegexpInputError?e.message:`worker 错误：${e instanceof Error?e.message:String(e)}`};
 }
 ctx.postMessage(reply);
};
