import {App, TFile} from 'obsidian';
import {DocumentSession} from '../core/session';
import {diff3Merge,MergeChunk,assemble} from './merge/diff3';

// 三方合并服务(F22,报告 §11.1):
// Base=会话 baseSource;Local=workingSource;Remote=打开面板时的磁盘快照。
// Local revision/epoch 或磁盘再变化会使合并过期,禁用应用;应用前再次原子校验。

export interface MergeSessionState {
 remoteSnapshot:string;
 baseAtOpen:string;
 localRevision:number;
 localEpoch:string;
 expired:boolean;
}

export class MergeService {
 constructor(private app:App){}

 async readDisk(file:TFile):Promise<string|null>{
  try{return await this.app.vault.read(file);}catch{return null;}
 }

 openState(session:DocumentSession,remote:string):MergeSessionState{
  return {remoteSnapshot:remote,baseAtOpen:session.baseSource,
   localRevision:session.revision,localEpoch:session.historyEpoch,expired:false};
 }

 isExpired(session:DocumentSession,st:MergeSessionState):boolean{
  return st.localRevision!==session.revision||st.localEpoch!==session.historyEpoch||st.baseAtOpen!==session.baseSource;
 }

 merge(base:string,local:string,remote:string){return diff3Merge(base,local,remote);}

 assemble(chunks:MergeChunk[],resolve:(c:MergeChunk)=>string){return assemble(chunks,resolve);}

 // 应用合并:短暂进入 merging,重新读盘校验 Remote 仍一致(audit §11.1);
 // 校验失败返回 null(不改 Local/Base/历史),由调用方提示重新比较。
 // 会话正忙(保存中)时返回 'busy' 而不是强行接管:此前 finally 无条件把 operation
 // 复位为 idle,等于把别人持有的保存锁抢走,写入中途的编辑被接受并落盘损坏文件
 // (审计 round4 BUG 6)。调用方必须把 'busy' 如实告知用户。
 async apply(file:TFile,session:DocumentSession,st:MergeSessionState,merged:string):
  Promise<'applied'|'expired'|'missing'|'busy'>{
  if(session.operation!=='idle')return 'busy';
  let disk:string|null=null;
  try{disk=await this.app.vault.read(file);}catch{return 'missing';}
  if(disk!==st.remoteSnapshot)return 'expired';
  if(session.operation!=='idle')return 'busy'; // 读盘期间会话可能已被占用
  session.operation='merging';
  try{
   if(session.revision!==st.localRevision||session.historyEpoch!==st.localEpoch)return 'expired';
   session.applyMergeResult(merged,disk);
   return 'applied';
  }finally{
   // 只释放自己持有的锁
   if(session.operation==='merging')session.operation='idle';
  }
 }
}
