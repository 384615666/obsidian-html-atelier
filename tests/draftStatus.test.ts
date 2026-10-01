import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DocumentSession} from '../src/core/session';
import {DraftsService} from '../src/services/draftsService';
import {normalizeSettings} from '../src/settings/schema';
import type {AtelierSettings} from '../src/settings/schema';

// 草稿状态栏(draftStatus)回归:干净文件不得显示误导性草稿文案
// (2026-09-30 用户真机反馈:刚打开显示"备份已关闭"、保存后停留"待备份/草稿已备份")。
// DraftsService 对 'obsidian' 只有类型级引用(tsx 会擦除该 import),但 scheduleSave
// 用 window.setTimeout —— node 下补一个 window 指到 globalThis。
(globalThis as {window?:unknown}).window=globalThis;

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

function memAdapter(){
 const files=new Map<string,string>();
 return {
  files,
  async exists(p:string){return files.has(p);},
  async mkdir(){},
  async read(p:string){const v=files.get(p);if(v===undefined)throw new Error('ENOENT');return v;},
  async write(p:string,d:string){files.set(p,d);},
  async remove(p:string){files.delete(p);},
  async list(dir:string){return [...files.keys()].filter(k=>k.startsWith(dir+'/')).map(k=>k.slice(dir.length+1));},
 };
}

function service(drafts:Partial<AtelierSettings['drafts']>,adapter=memAdapter()){
 const base=normalizeSettings(undefined).settings;
 const settings={...base,drafts:{...base.drafts,...drafts}} as AtelierSettings;
 const app={vault:{adapter,configDir:'.obsidian'}};
 return {svc:new DraftsService(app as never,()=>settings,'dev-unknown'),adapter};
}

const draftFiles=(adapter:{files:Map<string,string>})=>[...adapter.files.keys()].filter(k=>k.endsWith('.json'));

test('草稿状态:新会话初始为 idle(不显示任何草稿文案)',()=>{
 const s=new DocumentSession('a.html','<p>a</p>','<p>a</p>');
 assert.equal(s.draftStatus,'idle');
});

test('草稿状态:编辑→pending→落盘 saved;clearDraft 后回 idle 且草稿删除',async()=>{
 const {svc,adapter}=service({debounceMs:50,maxWaitMs:50});
 const s=new DocumentSession('a.html','<p>a</p>','<p>a</p>');
 s.applyEdit([{start:3,end:4,expected:'a',replacement:'b'}]);
 svc.scheduleSave(s);
 assert.equal(s.draftStatus,'pending','编辑后应显示待备份');
 await sleep(180);
 assert.equal(s.draftStatus,'saved','防抖到期落盘后应显示草稿已备份');
 assert.equal(draftFiles(adapter).length,1);
 await svc.clearDraft('a.html',s);
 assert.equal(s.draftStatus,'idle','清除草稿后干净会话应回到 idle');
 assert.equal(draftFiles(adapter).length,0);
});

test('草稿状态:防抖窗口内保存(clearDraft 取消定时器)→立即 idle,稍后不再翻转',async()=>{
 const {svc,adapter}=service({debounceMs:50,maxWaitMs:50});
 const s=new DocumentSession('a.html','<p>a</p>','<p>a</p>');
 s.applyEdit([{start:3,end:4,expected:'a',replacement:'b'}]);
 svc.scheduleSave(s);
 assert.equal(s.draftStatus,'pending');
 await svc.clearDraft('a.html',s);
 assert.equal(s.draftStatus,'idle','保存清除草稿后不得停留"待备份"');
 await sleep(180);
 assert.equal(s.draftStatus,'idle','被取消的防抖定时器不得再把状态翻回 saved');
 assert.equal(draftFiles(adapter).length,0);
});

test('草稿状态:撤销回原样后 flush → idle 并删除残留草稿',async()=>{
 const {svc,adapter}=service({debounceMs:50,maxWaitMs:50});
 const s=new DocumentSession('a.html','<p>a</p>','<p>a</p>');
 // 先落一份草稿,再撤销回原文
 const dirty=new DocumentSession('a.html','<p>a</p>','<p>a</p>');
 dirty.applyEdit([{start:3,end:4,expected:'a',replacement:'b'}]);
 await svc.flush(dirty);
 assert.equal(draftFiles(adapter).length,1);
 s.draftStatus='saved'; // 模拟撤销前状态栏已显示"草稿已备份"
 await svc.flush(s);
 assert.equal(s.draftStatus,'idle','干净会话 flush 不得显示"草稿已备份"');
 assert.equal(draftFiles(adapter).length,0);
});

test('草稿状态:设置关闭时 scheduleSave/flush/clearDraft 都显示 disabled',async()=>{
 const {svc}=service({enabled:false});
 const s=new DocumentSession('a.html','<p>a</p>','<p>a</p>');
 s.applyEdit([{start:3,end:4,expected:'a',replacement:'b'}]);
 svc.scheduleSave(s);
 assert.equal(s.draftStatus,'disabled','设置关闭时编辑应显示"备份已关闭"');
 await svc.flush(s);
 assert.equal(s.draftStatus,'disabled');
 await svc.clearDraft('a.html',s);
 assert.equal(s.draftStatus,'disabled','关闭备份时清除草稿不得显示成 idle');
});

test('草稿状态:冲突会话 flush 仍写入草稿并显示 saved(行为不变)',async()=>{
 const {svc,adapter}=service({debounceMs:50,maxWaitMs:50});
 const s=new DocumentSession('a.html','<p>a</p>','<p>a</p>');
 s.contentState='conflict';
 await svc.flush(s);
 assert.equal(s.draftStatus,'saved','冲突会话的草稿备份行为不变');
 assert.equal(draftFiles(adapter).length,1);
});

test('草稿状态:onStatusChange 在状态每次变化后被调用(面板跟随,修"停在待备份")',async()=>{
 const {svc}=service({debounceMs:50,maxWaitMs:50});
 const s=new DocumentSession('a.html','<p>a</p>','<p>a</p>');
 s.applyEdit([{start:3,end:4,expected:'a',replacement:'b'}]);
 const seen:string[]=[];
 svc.onStatusChange=()=>seen.push(s.draftStatus);
 svc.scheduleSave(s);
 await sleep(180);
 await svc.clearDraft('a.html',s);
 assert.ok(seen.includes('pending'),'scheduleSave 应触发回调: '+seen.join(','));
 assert.ok(seen.includes('saved'),'flush 落盘后应触发回调: '+seen.join(','));
 assert.ok(seen.includes('idle'),'clearDraft 后应触发回调: '+seen.join(','));
});

test('草稿状态:写入失败显示 failed(行为不变)',async()=>{
 const failing=memAdapter();
 const origWrite=failing.write.bind(failing);
 failing.write=async(p:string,d:string)=>{if(p.endsWith('.tmp')){await origWrite(p,d);throw new Error('disk error');}await origWrite(p,d);};
 const {svc}=service({debounceMs:50,maxWaitMs:50},failing);
 const s=new DocumentSession('a.html','<p>a</p>','<p>a</p>');
 s.applyEdit([{start:3,end:4,expected:'a',replacement:'b'}]);
 await svc.flush(s);
 assert.equal(s.draftStatus,'failed');
});

test('草稿状态:在途 flush 与 clearDraft 竞态——先等写入落地再删,磁盘不残留旧草稿(审计 m5)',async()=>{
 const slow=memAdapter();
 const origWrite=slow.write.bind(slow);
 slow.write=async(p:string,d:string)=>{if(p.endsWith('.json'))await sleep(80);await origWrite(p,d);};
 const {svc,adapter}=service({debounceMs:50,maxWaitMs:50},slow);
 const s=new DocumentSession('a.html','<p>a</p>','<p>a</p>');
 s.applyEdit([{start:3,end:4,expected:'a',replacement:'b'}]);
 const flushing=svc.flush(s); // saveDraft 的正式写被拖住 80ms:clearDraft 在这期间到达
 await sleep(20);
 await svc.clearDraft('a.html',s); // 竞态点:必须等在途写完再删,否则旧快照写回磁盘
 await flushing;
 assert.equal(draftFiles(adapter).length,0,'旧快照不得在删除后又写回磁盘(重启会变成幽灵冲突)');
 assert.equal(s.draftStatus,'idle');
});
