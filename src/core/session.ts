import {TextPatch} from './patch';
import {HistoryEvent,HistoryLimits,TransactionController} from './history';
import {fingerprint} from './fingerprint';
import {ObjectLocator} from './locator';

export type ContentState='clean'|'dirty'|'conflict'|'missing';
export type OperationState='idle'|'saving'|'merging';
export type DraftStatus='pending'|'writing'|'saved'|'failed'|'disabled';

export interface SaveOutcome {result:'written'|'conflict'|'missing'|'io-error'|'clean'|'blocked'}

// 宿主 IO 适配：process 对应 vault.process 语义——读取当前磁盘文本后由 decide 决定
// 写入内容；decide 返回 null 表示磁盘与基准不一致，不写入。读不到文件由适配器抛 MissingError。
export class MissingError extends Error {
 constructor(message='文件不存在'){super(message);this.name='MissingError';}
}
export interface SessionIO {
 process(decide:(currentDisk:string)=>string|null):Promise<'written'|'conflict'>;
}

export interface ApplyEditOptions {
 origin?:'edit'|'restore';
 kind?:'text'|'attribute'|'image'|'structure'|'source';
 groupingKey?:string|null;
 selectionBefore?:ObjectLocator|null;
 selectionAfter?:ObjectLocator|null;
 now?:number;
}

export const CONFLICT_SENTINEL=Symbol('html-atelier-conflict');

// 每文件内容会话（报告 §12.2/12.4）：
// - workingSource 是唯一内容真相；dirty = workingSource !== baseSource（保持"改回原文即 clean"）；
// - contentState 与 operation 分开存储：保存失败不吞掉 dirty/conflict；
// - conflict 是确认状态：继续编辑/撤销/重做/备份允许，普通保存禁用，
//   撤销到旧 Base 或改回原文都不会自动解除；
// - 普通保存更新 baseSource/baseHash，保留 workingSource、revision、epoch 与 undo/redo。
export class DocumentSession {
 readonly controller:TransactionController;
 parsedRevision=-1;
 contentState:ContentState='clean';
 operation:OperationState='idle';
 lastError:{action:string; message:string}|null=null;
 draftStatus:DraftStatus='disabled';
 index:unknown=null;
 baseHash:string;
 private pendingExternal=false;
 // 保存/合并期间收到过外部变化时为 true；宿主必须在操作结束后读取磁盘并补发 externalChange。
 get hasQueuedExternal(){return this.pendingExternal;}

 constructor(readonly filePath:string,public baseSource:string,public workingSource:string,
  limits?:HistoryLimits,nowRevision=0){
  this.controller=new TransactionController(workingSource,limits);
  this.controller.revision=nowRevision;
  this.baseHash=fingerprint(baseSource);
 }

 get dirty(){return this.workingSource!==this.baseSource;}
 get revision(){return this.controller.revision;}
 get historyEpoch(){return this.controller.epoch;}
 get source(){return this.workingSource;}

 private recomputeContentState(){
  if(this.contentState==='conflict'||this.contentState==='missing')return;
  this.contentState=this.workingSource===this.baseSource?'clean':'dirty';
 }

 // 内容编辑入口（可视化与源码编辑共用）。operation 非 idle 时拒绝（保存/合并窗口内禁改）。
 applyEdit(patches:TextPatch[],opts:ApplyEditOptions={}):TextPatch[] {
  if(this.operation!=='idle')throw new Error('当前正在保存或合并，内容修改暂时禁用');
  if(this.contentState==='missing')throw new Error('原文件已删除，内容只读；请使用另存恢复');
  const {source}=this.controller.apply(patches,{origin:opts.origin,kind:opts.kind,groupingKey:opts.origin==='restore'?null:opts.groupingKey,
   selectionBefore:opts.selectionBefore,selectionAfter:opts.selectionAfter,now:opts.now});
  this.workingSource=source;
  this.recomputeContentState();
  return patches;
 }

 undo(){return this.guardedMove(()=>this.controller.undo());}
 redo(){return this.guardedMove(()=>this.controller.redo());}
 private guardedMove(move:()=>{source:string}){
  if(this.operation!=='idle')throw new Error('当前正在保存或合并，撤销/重做暂时禁用');
  if(this.contentState==='missing')throw new Error('原文件已删除，历史不可用');
  const result=move();
  this.workingSource=result.source;
  this.recomputeContentState();
  return result;
 }

 endInputGroup(){this.controller.endGroupPublic();}

 // 解析结果登记：只有匹配当前 revision 的解析结果可开放可视化编辑。
 setParsed(index:unknown){this.index=index;this.parsedRevision=this.revision;}
 canUseVisualEdits(){return this.parsedRevision===this.revision;}

 // 普通保存（§12.4）：串行化由宿主保证（每文件一次）；compositionend 由宿主先行处理。
 async save(io:SessionIO):Promise<SaveOutcome> {
  if(this.operation!=='idle')return {result:'blocked'};
  // 无论后续是否被阻止,保存尝试都关闭当前输入分组(§12.2.1)
  this.controller.endGroupPublic();
  if(this.contentState==='conflict')return {result:'blocked'};
  if(this.contentState==='missing')return {result:'missing'};
  if(!this.dirty)return {result:'clean'};
  this.operation='saving';this.lastError=null;
  try{
   const outcome=await io.process(current=>current===this.baseSource?this.workingSource:null);
   if(outcome==='written'){
    this.baseSource=this.workingSource;this.baseHash=fingerprint(this.baseSource);
    this.contentState='clean';this.lastError=null;
   }else this.contentState='conflict';
   return {result:outcome};
  }catch(e){
   if(e instanceof MissingError){this.contentState='missing';return {result:'missing'};}
   this.lastError={action:'save',message:e instanceof Error?e.message:String(e)};
   return {result:'io-error'};
  }finally{
   this.operation='idle';
   // 注意:这里**不能**清 pendingExternal。保存期间排队的外部变化必须由宿主在保存
   // 结束后读取磁盘补发;在此清除会让"排队"实际上被丢弃,会话随后自认与磁盘同步,
   // 下一次保存就把对方版本覆盖掉(审计 round4 BUG 21)。
  }
 }

 // 宿主在补发完排队的外部变化后调用,清掉标记。
 consumeQueuedExternal(){this.pendingExternal=false;}

 // 外部变化（vault modify）。operation 非 idle 时排队，由保存结束后宿主补发。
 // 干净内容的外部更新：采用磁盘版本，递增 revision 并开启新 epoch（旧历史丢弃并返回）。
 // 有本地改动：进入 conflict，Local 保留，普通保存禁用。
 externalChange(diskSource:string):{adopted:boolean; droppedHistory:HistoryEvent[]}|null {
  if(this.operation!=='idle'){this.pendingExternal=true;return null;}
  if(diskSource===this.baseSource)return null;
  if(this.workingSource===this.baseSource){
   const dropped=this.controller.resetForExternalLoad(diskSource);
   this.workingSource=diskSource;this.baseSource=diskSource;this.baseHash=fingerprint(diskSource);
   this.contentState='clean';
   return {adopted:true,droppedHistory:dropped};
  }
  this.contentState='conflict';
  return {adopted:false,droppedHistory:[]};
 }

 markMissing(){if(this.operation==='idle')this.contentState='missing';}

 // 冲突解除路径一：采用磁盘版本（"使用磁盘版本"）。
 // 保存或合并进行中时拒绝:此时 workingSource/baseSource 正被事务占用,竞态调用会留下
 // "base 指向旧内容、dirty 谎报为 false"的永久冲突状态(audit/core S5)。
 adoptRemote(diskSource:string):HistoryEvent[] {
  if(this.operation!=='idle')throw new Error('正在保存或合并,不能采用磁盘版本;请稍后重试');
  const dropped=this.controller.resetForExternalLoad(diskSource);
  this.workingSource=diskSource;this.baseSource=diskSource;this.baseHash=fingerprint(diskSource);
  this.contentState='clean';this.lastError=null;
  return dropped;
 }

 // 冲突解除路径二：应用三方合并结果（§11.1）。base 设为本次 Remote，working 设为合并稿。
 // 新历史段；旧 Local 由调用方通过返回值交草稿层做"恢复合并前草稿"检查点。
 applyMergeResult(mergedSource:string,remoteBase:string):HistoryEvent[] {
  if(this.operation!=='idle'&&this.operation!=='merging')throw new Error('正在保存,不能应用合并结果;请稍后重试');
  const dropped=this.controller.resetForExternalLoad(mergedSource);
  this.workingSource=mergedSource;this.baseSource=remoteBase;this.baseHash=fingerprint(remoteBase);
  this.contentState=mergedSource===remoteBase?'clean':'dirty';
  this.lastError=null;
  return dropped;
 }
}
