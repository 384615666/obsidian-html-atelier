// TextPatch 是全部内容修改的唯一载体（报告 §12.2/12.3）：
// 区间基于当前事务基准 workingSource 的 UTF-16 偏移，expected 防止旧区间误写。
// 一个事务内补丁区间不得重叠，按倒序应用；逆向补丁基于应用后的输出内容坐标。
export interface TextPatch {start:number; end:number; expected:string; replacement:string}

export type PatchErrorCode='invalid-range'|'expected-mismatch'|'overlap'|'empty';
export class PatchError extends Error {
 constructor(public code:PatchErrorCode,message:string){super(message);this.name='PatchError';}
}

export function validatePatches(source:string,patches:TextPatch[]):void {
 if(!patches.length)throw new PatchError('empty','事务不包含任何补丁');
 let lastEnd=-1;
 let prevRisky=false;
 for(const p of [...patches].sort((a,b)=>a.start-b.start)){
  if(!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.start<0||p.end<p.start||p.end>source.length)
   throw new PatchError('invalid-range',`非法区间 [${p.start},${p.end})，当前长度 ${source.length}`);
  if(p.start<lastEnd)throw new PatchError('overlap',`补丁区间重叠：${p.start} < ${lastEnd}`);
  if(source.slice(p.start,p.end)!==p.expected)
   throw new PatchError('expected-mismatch',`区间 [${p.start},${p.end}) 内容已变化，拒绝应用`);
  // 相邻边界歧义防护（audit/core FINDINGS #1）：零长度或变长补丁与相邻补丁共享边界时，
  // 输出坐标中的逆向区间可能等起点，应用顺序不再无歧义，可能静默产出错误文本。
  // 源码中"相邻且都非空等长"的常规字段编辑不受影响；真正的相邻变更由调用方合并为单补丁。
  const risky=(p.start===p.end)||(p.replacement.length!==p.expected.length);
  if(p.start===lastEnd&&(risky||prevRisky))
   throw new PatchError('overlap',`零长度或变长区间不得与相邻区间共享边界 ${p.start}，请合并为单个补丁`);
  lastEnd=Math.max(lastEnd,p.end);
  prevRisky=risky;
 }
}

export function applyPatches(source:string,patches:TextPatch[]):string {
 validatePatches(source,patches);
 let out=source;
 for(const p of [...patches].sort((a,b)=>b.start-a.start)){
  // 纵深防御：应用前逐补丁复验，逆向/组合补丁的任何错位都变为显式拒绝而非静默破坏。
  if(out.slice(p.start,p.end)!==p.expected)
   throw new PatchError('expected-mismatch',`应用时区间 [${p.start},${p.end}) 内容已变化，拒绝应用`);
  out=out.slice(0,p.start)+p.replacement+out.slice(p.end);
 }
 return out;
}

// 计算一组补丁在其输出内容坐标上的逆向补丁。
// 输入补丁必须通过 validatePatches（含相邻歧义防护）；逆向区间与正向一一对应。
export function computeInverse(patches:TextPatch[]):TextPatch[] {
 const sorted=[...patches].sort((a,b)=>a.start-b.start);
 let delta=0;
 return sorted.map(p=>{
  const inv:TextPatch={start:p.start+delta,end:p.start+delta+p.replacement.length,expected:p.replacement,replacement:p.expected};
  delta+=p.replacement.length-p.expected.length;
  return inv;
 });
}
