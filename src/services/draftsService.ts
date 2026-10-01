import {App, TFile} from 'obsidian';
import {DocumentSession} from '../core/session';
import {fingerprint} from '../core/fingerprint';
import {DraftStore} from '../drafts/store';
import type {AtelierSettings} from '../settings/schema';

// 草稿服务(F23/F25):DocumentSession 的内容变更 → v2 草稿记录
// 防抖写 drafts.debounceMs / 最长 maxWaitMs;保存成功/会话结束立即 flush。
// 设备 ID:localStorage(应用级,跨库共享同一设备标识,D0-05 实测可用)。

export function getDeviceId():string {
 try{
  let id=localStorage.getItem('html-atelier-device-id');
  if(!id){
   id='dev-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
   localStorage.setItem('html-atelier-device-id',id);
  }
  return id;
 }catch{return 'dev-unknown';}
}

export class DraftsService {
 private store:DraftStore;
 private timers=new Map<string,{timer:number; firstAt:number}>();
 // 每个"进行中的 saveDraft 写入"。clearDraft/干净分支的 flush 在删草稿前先等它落地:
 // 否则防抖到期的 flush 正在 await store.saveDraft(记录已按保存前内容快照)时,保存成功
 // 的 clearDraft 先删、旧快照后写回,磁盘残留保存前草稿,重启被 recover 判成幽灵冲突(审计 m5)
 private inflight=new Map<string,Promise<void>>();
 // 状态栏跟随(2026-09-30 复查):flush/清除草稿多在防抖定时器里异步改 draftStatus,
 // 面板不会自己知道,改字后状态栏一直停在"待备份"。宿主注册此回调(接到 refreshPanels)。
 onStatusChange:(()=>void)|null=null;
 private emitStatus(){this.onStatusChange?.();}

 constructor(private app:App,private settings:()=>AtelierSettings,deviceId:string){
  this.store=new DraftStore(this.app.vault.adapter,`${this.app.vault.configDir}/plugins/html-atelier/drafts`,deviceId);
 }

 get storeRef(){return this.store;}

 // 会话内容变更后调用:内存即时,落盘防抖
 scheduleSave(session:DocumentSession){
  const st=this.settings().drafts;
  if(!st.enabled){session.draftStatus='disabled';this.emitStatus();return;}
  session.draftStatus='pending';this.emitStatus();
  const existing=this.timers.get(session.filePath);
  const now=Date.now();
  const firstAt=existing?.firstAt??now;
  if(existing)window.clearTimeout(existing.timer);
  const flush=()=>{this.timers.delete(session.filePath);void this.flush(session);};
  const timer=window.setTimeout(flush,Math.max(50,st.debounceMs-(now-firstAt)>=0?st.debounceMs-(now-firstAt):50));
  this.timers.set(session.filePath,{timer,firstAt});
  // 已达最长等待:立即落盘,同时必须cancel掉刚武装的定时器,否则它稍后还会再写一次
  // (审计复检 §3.24 F1:双写。当前 settings 归一化强制 maxWaitMs ≥ debounceMs 使其
  // 不可达,但这是真实缺陷,边界一改就会活过来)
  if(now-firstAt>=st.maxWaitMs){window.clearTimeout(timer);this.timers.delete(session.filePath);void this.flush(session);}
 }

 // 等待该文件在途的草稿写入完成(失败也算落地:clearDraft 随后会把残留删掉)
 private async settleInflight(filePath:string){
  const p=this.inflight.get(filePath);
  if(p)await p.catch(()=>{});
 }

 // 立即写草稿(临时→校验→正式在 DraftStore 内部)
 async flush(session:DocumentSession){
  if(!this.settings().drafts.enabled){session.draftStatus='disabled';this.emitStatus();return;}
  // 干净且无冲突 = 没有草稿可写(撤销回原样会走到这里):删掉残留草稿后回到 idle。
  // 此前设成 'saved',状态栏在干净文件上谎报"草稿已备份"。
  if(!session.dirty&&session.contentState!=='conflict'){
   await this.settleInflight(session.filePath);
   this.store.removeDraft(session.filePath).catch(()=>{});
   session.draftStatus='idle';this.emitStatus();return;
  }
  session.draftStatus='writing';this.emitStatus();
  const write=(async()=>{
   try{
    await this.store.saveDraft({
     schemaVersion:2,deviceId:getDeviceId(),filePath:session.filePath,
     baseSource:session.baseSource,baseHash:fingerprint(session.baseSource),
     workingSource:session.workingSource,revision:session.revision,updatedAt:Date.now(),
    });
    session.draftStatus='saved';
   }catch{
    session.draftStatus='failed'; // 状态栏持续展示,不逐次弹通知(报告 §11.3)
   }
   this.emitStatus();
  })();
  this.inflight.set(session.filePath,write);
  await write;
  if(this.inflight.get(session.filePath)===write)this.inflight.delete(session.filePath);
 }

 // 会话恢复:读取草稿;若磁盘已变化则进入冲突
 async recover(file:TFile):Promise<{workingSource:string; conflict:boolean; revision:number}|null>{
  const record=await this.store.loadDraft(file.path).catch(()=>null);
  if(!record)return null;
  const disk=await this.app.vault.read(file);
  const conflict=disk!==record.baseSource;
  // revision 一并返回:新会话必须从它继续,否则草稿层的单调 revision 守卫会连续拒绝写入
  // (审计 round4 BUG 3)
  return {workingSource:record.workingSource,conflict,revision:record.revision};
 }

 // 保存成功后清除草稿。传入 session 时同步 draftStatus:草稿已不存在,干净会话
 // 回到 idle(此前状态停在保存前的 'pending'/'saved',保存后一直显示"待备份/草稿已备份")。
 async clearDraft(filePath:string,session?:DocumentSession){
  const t=this.timers.get(filePath);
  if(t){window.clearTimeout(t.timer);this.timers.delete(filePath);}
  // 先让在途写入落地再删:顺序反了会把已删除的旧草稿又写回磁盘(见 inflight 注释)
  await this.settleInflight(filePath);
  await this.store.removeDraft(filePath).catch(()=>{});
  if(session){session.draftStatus=this.settings().drafts.enabled?'idle':'disabled';this.emitStatus();}
 }

 // F23:草稿清单
 async list(){return this.store.listDrafts();}

 // F23:批量丢弃(只删草稿,不删原文件)
 async discardMany(paths:string[]):Promise<{ok:string[]; failed:string[]}>{
  const ok:string[]=[];const failed:string[]=[];
  for(const p of paths){
   try{await this.store.removeDraft(p);ok.push(p);}
   catch{failed.push(p);}
  }
  return {ok,failed};
 }
}
