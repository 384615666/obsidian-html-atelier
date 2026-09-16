import {TaskHost,WorkerTaskError} from './workerHost';
import {compileRegex,RegexpInputError} from './regexpCore';
import type {RegexpSearchResult} from './protocol';

// RegExpSearchAdapter（F13 的执行通道）：正文与源码正则搜索一律不在主线程执行。
// 输入长度、匹配数与迭代次数设上限；错误表达式在主线程仅做编译校验，不执行搜索。
export interface RegexpSearchLimits {maxMatches:number; maxIterations:number; maxInputLength:number; timeoutMs:number}
export const DEFAULT_REGEXP_LIMITS:RegexpSearchLimits={maxMatches:5000,maxIterations:2_000_000,maxInputLength:5_000_000,timeoutMs:1000};

export class RegExpSearchAdapter {
 constructor(private host:TaskHost,private limits:RegexpSearchLimits=DEFAULT_REGEXP_LIMITS){}

 async search(input:{text:string; pattern:string; flags:string; revision?:number; timeoutMs?:number}):Promise<RegexpSearchResult> {
  if(input.text.length>this.limits.maxInputLength)
   throw new RegexpInputError(`输入过长（${input.text.length} > ${this.limits.maxInputLength}），请缩小范围`);
  // 主线程只编译校验（捕获语法错误），不执行搜索
  compileRegex(input.pattern,input.flags);
  const result=await this.host.run<RegexpSearchResult>({
   type:'regexp-search',
   text:input.text,
   pattern:input.pattern,
   flags:input.flags,
   maxMatches:this.limits.maxMatches,
   maxIterations:this.limits.maxIterations,
   revision:input.revision,
  },input.timeoutMs);
  // 返回结果先验结构再校验修订号（报告 §12.7）
  if(!result||!Array.isArray(result.matches))throw new WorkerTaskError('结果结构非法');
  if(input.revision!==undefined&&result.revision!==input.revision)
   throw new Error('结果修订号过期，已丢弃');
  return result;
 }

 dispose(){this.host.dispose();}
}
