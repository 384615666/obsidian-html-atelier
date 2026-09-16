import {TextPatch,applyPatches,computeInverse,validatePatches} from './patch';
import {fingerprint} from './fingerprint';
import {ObjectLocator} from './locator';

export interface AppliedTransaction {
 id:string;
 fromRevision:number;
 toRevision:number;
 origin:'edit'|'undo'|'redo'|'restore';
 kind:'text'|'attribute'|'image'|'structure'|'source';
 patches:TextPatch[];
 inversePatches:TextPatch[];
 selectionBefore:ObjectLocator|null;
 selectionAfter:ObjectLocator|null;
 timestamp:number;
}

export interface HistoryEvent {
 id:string;
 epoch:string;
 firstRevision:number;
 lastRevision:number;
 beforeFingerprint:string;
 afterFingerprint:string;
 steps:AppliedTransaction[];
}

export interface HistoryLimits {maxEvents:number; maxBytes:number; mergeDelayMs:number}
export const DEFAULT_HISTORY_LIMITS:HistoryLimits={maxEvents:200,maxBytes:32*1024*1024,mergeDelayMs:800};

export type HistoryErrorCode='no-undo'|'no-redo'|'epoch-changed'|'fingerprint-mismatch'|'top-changed'|'revision-changed';
export class HistoryError extends Error {
 constructor(public code:HistoryErrorCode,message:string){super(message);this.name='HistoryError';}
}

export interface ApplyOptions {
 origin?:AppliedTransaction['origin'];
 kind?:AppliedTransaction['kind'];
 groupingKey?:string|null;
 selectionBefore?:ObjectLocator|null;
 selectionAfter?:ObjectLocator|null;
 now?:number;
}
export interface ApplyResult {source:string; transaction:AppliedTransaction}
export interface MoveResult {source:string; event:HistoryEvent; fromRevision:number; toRevision:number}

let uidCounter=0;
const uid=(prefix:string)=>`${prefix}-${Date.now().toString(36)}-${(++uidCounter).toString(36)}-${Math.random().toString(36).slice(2,8)}`;

const eventBytes=(e:HistoryEvent)=>{
 let n=0;
 for(const s of e.steps)for(const p of s.patches)if(p.expected===p.replacement)n+=p.expected.length*2;else n+=(p.expected.length+p.replacement.length)*2;
 for(const s of e.steps)for(const p of s.inversePatches)n+=(p.expected.length+p.replacement.length)*2;
 return n;
};

// 统一事务历史（报告 §12.2.1）：
// - 每次应用以当时的当前 revision 发起新操作，expected 校验原文，revision 单调递增；
// - 连续输入按 groupingKey 与合并窗口归入同一 HistoryEvent，各步骤保留自己的坐标；
// - 撤销/重做基于栈顶事件的逆向/正向步骤在临时缓冲中重放，指纹与 revision 双重校验后
//   原子提交；任何校验失败都不落地、不移动栈；
// - 普通保存不产生内容变更，仅关闭输入分组，undo/redo 保留。
export class TransactionController {
 source:string;
 revision=0;
 epoch:string;
 private undoStack:HistoryEvent[]=[];
 private redoStack:HistoryEvent[]=[];
 private currentGroup:HistoryEvent|null=null;
 private lastGroupKey:string|null=null;
 private lastGroupAt=-Infinity;
 private bytes=0;
 private epochCounter=0;

 constructor(source:string,public limits:HistoryLimits=DEFAULT_HISTORY_LIMITS){this.source=source;this.epoch=`e${++this.epochCounter}`;}

 get undoDepth(){return this.undoStack.length;}
 get redoDepth(){return this.redoStack.length;}
 get historyBytes(){return this.bytes;}

 private endGroup(){this.currentGroup=null;this.lastGroupKey=null;this.lastGroupAt=-Infinity;}

 // 外部重载或应用合并后调用：新 epoch，历史不跨基准重放；返回被丢弃的事件供检查点另存。
 resetForExternalLoad(newSource:string):HistoryEvent[] {
  this.endGroup();
  const dropped=[...this.undoStack,...this.redoStack];
  this.undoStack=[];this.redoStack=[];this.bytes=0;
  this.source=newSource;this.revision++;
  this.epoch=`e${++this.epochCounter}-${uid('epoch')}`;
  return dropped;
 }

 // 普通保存成功：不递增 revision、不重置 epoch，只关闭输入分组。
 checkpointSave(){this.endGroup();}

 // 供会话在保存/切换对象/批量操作前结束当前输入分组。
 endGroupPublic(){this.endGroup();}

 apply(patches:TextPatch[],opts:ApplyOptions={}):ApplyResult {
  const now=opts.now??Date.now();
  const origin=opts.origin??'edit';
  const kind=opts.kind??'text';
  const before=this.source;
  const merging=origin==='edit'&&!!opts.groupingKey&&opts.groupingKey===this.lastGroupKey
   &&this.currentGroup!==null&&this.currentGroup.epoch===this.epoch
   &&now-this.lastGroupAt<=this.limits.mergeDelayMs;
  if(!merging)this.endGroup();

  validatePatches(before,patches);
  const out=applyPatches(before,patches);
  const tx:AppliedTransaction={
   id:uid('tx'),fromRevision:this.revision,toRevision:this.revision+1,origin,kind,
   patches,inversePatches:computeInverse(patches),
   selectionBefore:opts.selectionBefore??null,selectionAfter:opts.selectionAfter??null,timestamp:now,
  };
  this.source=out;this.revision++;

  if(merging&&this.currentGroup){
   this.currentGroup.steps.push(tx);
   this.currentGroup.lastRevision=tx.toRevision;
   this.currentGroup.afterFingerprint=fingerprint(out);
   this.lastGroupAt=now;
   this.bytes+=eventBytes({id:'',epoch:'',firstRevision:0,lastRevision:0,beforeFingerprint:'',afterFingerprint:'',steps:[tx]});
  }else{
   const event:HistoryEvent={id:uid('ev'),epoch:this.epoch,firstRevision:tx.fromRevision,lastRevision:tx.toRevision,
    beforeFingerprint:fingerprint(before),afterFingerprint:fingerprint(out),steps:[tx]};
   this.undoStack.push(event);
   this.bytes+=eventBytes(event);
   this.currentGroup=origin==='edit'&&opts.groupingKey?event:null;
   this.lastGroupKey=opts.groupingKey??null;
   this.lastGroupAt=now;
  }
  // 出现新修改即清空 redo 分支（撤销后的新编辑）。
  // 必须退还这些事件占用的字节：只清数组不退账会留下"幽灵字节"，trim() 随后按虚高
  // 的预算驱逐真实撤销历史（审计复检 §3.4：5 轮"撤销+继续编辑"即清空全部历史）。
  if(this.redoStack.length){
   let reclaimed=0;
   for(const dropped of this.redoStack)reclaimed+=eventBytes(dropped);
   this.bytes-=reclaimed;
   this.redoStack=[];
  }
  this.trim();
  return {source:out,transaction:tx};
 }

 private trim(){
  while(this.bytes>this.limits.maxBytes||(this.undoStack.length+this.redoStack.length)>this.limits.maxEvents){
   const victim=this.undoStack.length?this.undoStack:this.redoStack;
   if(!victim.length)break;
   const removed=victim.shift()!;
   this.bytes-=eventBytes(removed);
   if(victim===this.undoStack&&this.currentGroup===removed)this.endGroup();
  }
 }

 // 撤销（§12.2.1 算法）：结束分组 → 校验 epoch 与栈顶 afterFingerprint →
 // 临时缓冲倒序应用逆向步骤并逐步校验 expected → 校验 beforeFingerprint → 原子提交。
 undo():MoveResult {
  this.endGroup();
  const top=this.undoStack[this.undoStack.length-1];
  if(!top)throw new HistoryError('no-undo','没有可撤销的历史');
  const startRevision=this.revision,startEpoch=this.epoch;
  if(top.epoch!==startEpoch)throw new HistoryError('epoch-changed','历史事件属于旧基准，不能直接重放');
  if(top.afterFingerprint!==fingerprint(this.source))
   throw new HistoryError('fingerprint-mismatch','当前内容与栈顶事件的输出不一致，拒绝撤销');
  let buffer=this.source;
  try{
   for(let i=top.steps.length-1;i>=0;i--)buffer=applyPatches(buffer,top.steps[i].inversePatches);
  }catch(e){
   throw new HistoryError('fingerprint-mismatch',`撤销步骤校验失败：${e instanceof Error?e.message:String(e)}`);
  }
  if(top.beforeFingerprint!==fingerprint(buffer))
   throw new HistoryError('fingerprint-mismatch','撤销结果与事件起点不一致，拒绝提交');
  if(this.revision!==startRevision||this.epoch!==startEpoch||this.undoStack[this.undoStack.length-1]!==top)
   throw new HistoryError('top-changed','撤销计算期间内容或历史已变化，临时结果不落地');
  this.undoStack.pop();this.redoStack.push(top);
  this.source=buffer;this.revision++;
  return {source:buffer,event:top,fromRevision:startRevision,toRevision:this.revision};
 }

 // 重做（对称）：校验 beforeFingerprint → 正序应用正向步骤 → 校验 afterFingerprint → 原子提交。
 redo():MoveResult {
  this.endGroup();
  const top=this.redoStack[this.redoStack.length-1];
  if(!top)throw new HistoryError('no-redo','没有可重做的历史');
  const startRevision=this.revision,startEpoch=this.epoch;
  if(top.epoch!==startEpoch)throw new HistoryError('epoch-changed','历史事件属于旧基准，不能直接重放');
  if(top.beforeFingerprint!==fingerprint(this.source))
   throw new HistoryError('fingerprint-mismatch','当前内容与栈顶事件的输入不一致，拒绝重做');
  let buffer=this.source;
  try{
   for(const step of top.steps)buffer=applyPatches(buffer,step.patches);
  }catch(e){
   throw new HistoryError('fingerprint-mismatch',`重做步骤校验失败：${e instanceof Error?e.message:String(e)}`);
  }
  if(top.afterFingerprint!==fingerprint(buffer))
   throw new HistoryError('fingerprint-mismatch','重做结果与事件终点不一致，拒绝提交');
  if(this.revision!==startRevision||this.epoch!==startEpoch||this.redoStack[this.redoStack.length-1]!==top)
   throw new HistoryError('top-changed','重做计算期间内容或历史已变化，临时结果不落地');
  this.redoStack.pop();this.undoStack.push(top);
  this.source=buffer;this.revision++;
  return {source:buffer,event:top,fromRevision:startRevision,toRevision:this.revision};
 }
}
