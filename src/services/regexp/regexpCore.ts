import {RegexpMatch,RegexpSearchResult} from './protocol';

// 纯正则搜索核心：worker 入口与单元测试共用。
// 零长度匹配按 Unicode 字符边界前进（报告 §12.7），并有迭代硬上限防止异常输入下的超长循环。
// 超时保护不在此处：主线程 setTimeout 无法中止执行中的 RegExp，必须由宿主终止 Worker。
export class RegexpInputError extends Error {
 constructor(message:string){super(message);this.name='RegexpInputError';}
}

const ALLOWED_FLAGS=/[dgimsuvy]/g;

export function sanitizeFlags(flags:string):string {
 const chars=[...new Set(flags.match(ALLOWED_FLAGS)??[])];
 if(!chars.includes('g'))chars.push('g');
 return chars.sort().join('');
}

export function compileRegex(pattern:string,flags:string):RegExp {
 if(pattern.length>10000)throw new RegexpInputError('正则表达式过长');
 const clean=sanitizeFlags(flags);
 try{return new RegExp(pattern,clean);}
 catch(e){throw new RegexpInputError(`无效正则表达式：${e instanceof Error?e.message:String(e)}`);}
}

export function runRegexpSearch(text:string,pattern:string,flags:string,maxMatches:number,maxIterations:number):RegexpSearchResult {
 // NaN 会同时骗过上下界比较,让 maxMatches/maxIterations 静默失效(无上限地收集命中)
 // 审计复检 §4.2:这里必须显式要求整数。
 if(!Number.isInteger(maxMatches)||maxMatches<1||maxMatches>100000)throw new RegexpInputError('maxMatches 超出范围');
 if(!Number.isInteger(maxIterations)||maxIterations<1||maxIterations>1_000_000_000)throw new RegexpInputError('maxIterations 非法');
 const regex=compileRegex(pattern,flags);
 const matches:RegexpMatch[]=[];
 let iterations=0;
 let truncated=false;
 regex.lastIndex=0;
 let m:RegExpExecArray|null;
 while((m=regex.exec(text))!==null){
  if(++iterations>maxIterations)throw new RegexpInputError('迭代次数超限，已中止');
  const start=m.index;
  const end=start+m[0].length;
  matches.push({start,end,text:m[0],groups:m.slice(1).map(g=>g??'')});
  if(matches.length>=maxMatches){
   // 恰好用满上限 ≠ 还有更多命中:必须再探一次,否则"正好 N 个"会被报成"已截断"
   // (审计 round4 BUG 30)。零长匹配的推进方式与主循环保持一致。
   if(m[0].length===0){
    const cp=text.codePointAt(start)??0;
    regex.lastIndex=start+(cp>0xffff?2:1);
   }
   truncated=regex.lastIndex<=text.length&&regex.exec(text)!==null;
   break;
  }
  if(m[0].length===0){
   const cp=text.codePointAt(start)??0;
   regex.lastIndex=start+(cp>0xffff?2:1);
   if(regex.lastIndex>text.length)break;
  }
 }
 return {matches,truncated};
}
