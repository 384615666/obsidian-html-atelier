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

 constructor(private app:App,private settings:()=>AtelierSettings,deviceId:string){
  this.store=new DraftStore(this.app.vault.adapter,`${this.app.vault.configDir}/plugins/html-atelier/drafts`,deviceId);
 }

 get storeRef(){return this.store;}

 // 会话内容变更后调用:内存即时,落盘防抖
 scheduleSave(session:DocumentSession){
  const st=this.settings().drafts;
  if(!st.enabled)return;
  session.draftStatus='pending';
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

 // 立即写草稿(临时→校验→正式在 DraftStore 内部)
 async flush(session:DocumentSession){
  if(!this.settings().drafts.enabled){session.draftStatus='disabled';return;}
  if(!session.dirty&&session.contentState!=='conflict'){this.store.removeDraft(session.filePath).catch(()=>{});session.draftStatus='saved';return;}
  session.draftStatus='writing';
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

 // 保存成功后清除草稿
 async clearDraft(filePath:string){
  const t=this.timers.get(filePath);
  if(t){window.clearTimeout(t.timer);this.timers.delete(filePath);}
  await this.store.removeDraft(filePath).catch(()=>{});
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
