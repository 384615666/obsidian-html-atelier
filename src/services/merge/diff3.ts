import {diffHunks,tokenizeLines,DiffHunk} from './diff';

// 三方合并引擎（报告 §12.7/D0-09 的契约层）：
// - 输入 Base/Local/Remote 三方文本；输出分块结果与冲突计数；
// - 仅自动合并可证明不相交的修改；同一文本、重叠区间、相同边界插入一律保守冲突；
// - 本文件提供契约与参考实现；D0-09 选定成熟 diff3 库后经同一契约接入。

export interface MergeChunk {
 type:'same'|'local'|'remote'|'conflict';
 text:string;          // same/local/remote：合并稿中的文本；conflict：基准原文
 localText?:string;    // conflict 两侧选项
 remoteText?:string;
}
export interface MergeResult {chunks:MergeChunk[]; conflictCount:number}
export interface MergeEngine {merge(input:{base:string; local:string; remote:string}):MergeResult}

// 冲突判定（报告 §11.1：仅自动合并可证明不相交的修改）：
// - 区间严格重叠 → 冲突；
// - 任一 hunk 是零长度插入（相同边界处插入）且与对方接触 → 冲突；
// - 相邻但不重叠的替换（不同行的相邻修改）不冲突，可自动合并。
const overlaps=(groupLo:number,groupHi:number,hunk:DiffHunk)=>{
 const zero=hunk.aStart===hunk.aEnd||groupLo===groupHi;
 if(zero)return Math.max(hunk.aStart,groupLo)<=Math.min(hunk.aEnd,groupHi);
 return hunk.aStart<groupHi&&groupLo<hunk.aEnd;
};

function applyHunks(base:string[],hunks:DiffHunk[],lo:number,hi:number):string[] {
 // 将一组 hunk 应用到 base 区间 [lo,hi)：组内 hunk 均与区间接触且按升序不重叠；
 // 零长度插入（含区间端点）也要计入，否则同边界插入会被静默丢弃。
 const out:string[]=[];
 let pos=lo;
 let k=0;
 while(k<hunks.length&&hunks[k].aStart<=hi){
  const h=hunks[k];
  out.push(...base.slice(pos,h.aStart));
  out.push(...h.tokens);
  pos=Math.max(h.aEnd,h.aStart);
  k++;
 }
 out.push(...base.slice(pos,hi));
 return out;
}

export function diff3Merge(baseText:string,localText:string,remoteText:string):MergeResult {
 const base=tokenizeLines(baseText),local=tokenizeLines(localText),remote=tokenizeLines(remoteText);
 const lh=diffHunks(base,local),rh=diffHunks(base,remote);
 const chunks:MergeChunk[]=[];
 const emitSame=(tokens:string[])=>{if(tokens.length)chunks.push({type:'same',text:tokens.join('')});};
 let pos=0,i=0,j=0;
 while(i<lh.length||j<rh.length){
  const takeLocal=j>=rh.length||(i<lh.length&&lh[i].aStart<=rh[j].aStart);
  const first=takeLocal?lh[i]:rh[j];
  let lo=first.aStart,hi=first.aEnd;
  const localGroup:DiffHunk[]=[],remoteGroup:DiffHunk[]=[];
  // 收集与组区间重叠（含相同边界）的所有 hunk；组区间扩展后继续吸收
  let grew=true;
  while(grew){
   grew=false;
   while(i<lh.length&&overlaps(lo,hi,lh[i])){localGroup.push(lh[i]);hi=Math.max(hi,lh[i].aEnd);lo=Math.min(lo,lh[i].aStart);i++;grew=true;}
   while(j<rh.length&&overlaps(lo,hi,rh[j])){remoteGroup.push(rh[j]);hi=Math.max(hi,rh[j].aEnd);lo=Math.min(lo,rh[j].aStart);j++;grew=true;}
  }
  emitSame(base.slice(pos,lo));
  const localTokens=applyHunks(base,localGroup,lo,hi);
  const remoteTokens=applyHunks(base,remoteGroup,lo,hi);
  if(remoteGroup.length===0)chunks.push({type:'local',text:localTokens.join('')});
  else if(localGroup.length===0)chunks.push({type:'remote',text:remoteTokens.join('')});
  else if(localTokens.join('')===remoteTokens.join(''))chunks.push({type:'same',text:localTokens.join('')});
  else chunks.push({type:'conflict',text:base.slice(lo,hi).join(''),localText:localTokens.join(''),remoteText:remoteTokens.join('')});
  pos=hi;
 }
 emitSame(base.slice(pos));
 const conflictCount=chunks.filter(c=>c.type==='conflict').length;
 return {chunks,conflictCount};
}

// 参考引擎实例。assemble 把未解决的冲突块以基准文本呈现（仅供预览），
// 真正的合并稿必须由用户对每个冲突块选择后组装。
export const referenceMergeEngine:MergeEngine={
 merge:({base,local,remote})=>diff3Merge(base,local,remote),
};

export function assemble(chunks:MergeChunk[],resolve:(chunk:MergeChunk)=>string):string {
 return chunks.map(c=>c.type==='conflict'?resolve(c):c.text).join('');
}
