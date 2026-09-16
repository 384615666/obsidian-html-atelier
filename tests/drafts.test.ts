import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DraftStore,DraftAdapter} from '../src/drafts/store';
import {sealDraftRecord,verifyDraftRecord} from '../src/drafts/record';
import {migrateLegacyDrafts} from '../src/drafts/migrate';
import {fingerprint} from '../src/core/fingerprint';

// 内存 adapter：模拟真实 DataAdapter 子集，可注入写失败。
function memAdapter():DraftAdapter & {files:Map<string,string>; failNextWrite:boolean; writes:number}{
 return {
  files:new Map(),failNextWrite:false,writes:0,
  async exists(p){return this.files.has(p);},
  async mkdir(p){this.files.set(p,this.files.get(p)??'');},
  async read(p){const v=this.files.get(p);if(v===undefined)throw new Error('ENOENT');return v;},
  async write(p,data){if(this.failNextWrite){this.failNextWrite=false;throw new Error('disk error');}this.writes++;this.files.set(p,data);},
  async remove(p){this.files.delete(p);},
  async list(p){return [...this.files.keys()].filter(k=>k.startsWith(p+'/')).map(k=>k.slice(p.length+1));},
 };
}

const RECORD={schemaVersion:2 as const,deviceId:'dev-1',filePath:'pages/a.html',
 baseSource:'<p>a</p>',baseHash:fingerprint('<p>a</p>'),workingSource:'<p>b</p>',revision:3,updatedAt:1};

test('A29 草稿保存走 临时文件→读回校验→正式文件，读回通过后清理临时',async()=>{
 const a=memAdapter();const s=new DraftStore(a,'drafts','dev-1');
 await s.saveDraft(RECORD);
 const list=await s.listDrafts();
 assert.equal(list.records.length,1);
 assert.equal(list.records[0].filePath,'pages/a.html');
 assert.equal([...a.files.keys()].filter(k=>k.endsWith('.tmp')).length,0);
 const loaded=await s.loadDraft('pages/a.html');
 assert.equal(loaded?.workingSource,'<p>b</p>');
 assert.equal(loaded?.revision,3);
});

test('A29 写失败时保留上一份有效快照并可继续',async()=>{
 const a=memAdapter();const s=new DraftStore(a,'drafts','dev-1');
 await s.saveDraft(RECORD);
 // 第二次保存失败：正式文件仍是第一份有效内容
 a.failNextWrite=true;
 await assert.rejects(()=>s.saveDraft({...RECORD,workingSource:'<p>c</p>',updatedAt:2}));
 const loaded=await s.loadDraft('pages/a.html');
 assert.equal(loaded?.workingSource,'<p>b</p>');
 // 恢复后可继续保存
 await s.saveDraft({...RECORD,workingSource:'<p>c</p>',updatedAt:3});
 assert.equal((await s.loadDraft('pages/a.html'))?.workingSource,'<p>c</p>');
});

test('A29 临时文件损坏 → 保存失败，正式文件保留有效快照',async()=>{
 const a=memAdapter();const s=new DraftStore(a,'drafts','dev-1');
 await s.saveDraft(RECORD);
 // 篡改写入路径：让临时文件读回时内容被截断
 const orig=a.write.bind(a);
 a.write=async(p,data)=>{
  if(p.endsWith('.tmp')){await orig(p,data.slice(0,10));return;}
  await orig(p,data);
 };
 await assert.rejects(()=>s.saveDraft({...RECORD,workingSource:'<p>x</p>',updatedAt:9}),/校验失败/);
 assert.equal((await s.loadDraft('pages/a.html'))?.workingSource,'<p>b</p>');
});

test('A29 校验和损坏的记录按无草稿处理；路径哈希碰撞被 filePath 校验拒绝',async()=>{
 const a=memAdapter();const s=new DraftStore(a,'drafts','dev-1');
 await s.saveDraft(RECORD);
 const finalFile=()=>[...a.files.keys()].find(k=>k.startsWith('drafts/')&&k.endsWith('.json')&&!k.endsWith('.tmp'))!;
 // 篡改正式文件内容 → checksum 不匹配
 const sealed=JSON.parse(a.files.get(finalFile())!);
 sealed.workingSource='<p>篡改</p>';
 a.files.set(finalFile(),JSON.stringify(sealed));
 assert.equal(await s.loadDraft('pages/a.html'),null);
 // 伪造碰撞：文件名对应 pages/a.html，但记录内路径是别的文件 → 拒绝返回
 await s.saveDraft(RECORD);
 const forged=sealDraftRecord({...RECORD,filePath:'other/path.html'});
 a.files.set(finalFile(),JSON.stringify(forged));
 assert.equal(await s.loadDraft('pages/a.html'),null);
 assert.equal(verifyDraftRecord(JSON.parse(a.files.get(finalFile())!))?.filePath,'other/path.html');
});

test('A33 v1→v2 迁移：文字草稿重建 workingSource，结构幂等',()=>{
 const legacy={
  drafts:{
   'demo/studio.html':{source:'<h1>标题</h1><p>段落</p>',changes:[['t1','新段落内容']]},
   '中文 目录/页 面.html':{source:'<p>你好</p>',changes:[]},
  },
 };
 const r1=migrateLegacyDrafts(legacy,'dev-1',1000);
 assert.equal(r1.records.length,2);
 assert.equal(r1.manual.length,0);
 const rec=r1.records.find(x=>x.filePath==='demo/studio.html')!;
 assert.equal(rec.workingSource,'<h1>标题</h1><p>新段落内容</p>');
 assert.equal(rec.baseSource,'<h1>标题</h1><p>段落</p>');
 assert.equal(rec.baseHash,fingerprint(rec.baseSource));
 assert.equal(rec.deviceId,'dev-1');
 assert.equal(rec.schemaVersion,2);
 // 幂等：同样输入两次结果一致
 const r2=migrateLegacyDrafts(legacy,'dev-1',1000);
 assert.deepEqual(r2.records.map(x=>x.checksum),r1.records.map(x=>x.checksum));
 // 中文/空格路径保留完整库内路径
 assert.ok(r1.records.some(x=>x.filePath==='中文 目录/页 面.html'));
});

test('A33 无法解释的旧草稿保留原始数据为“需手动恢复”',()=>{
 const r=migrateLegacyDrafts({
  drafts:{
   'a.html':{source:'<p>x</p>',changes:[['t0','y']]},
   'bad.html':{foo:'not a draft'},
   'worse.html':'string',
  },
 },'dev-1',0);
 assert.equal(r.records.length,1);
 assert.deepEqual(r.manual.map(m=>m.filePath),['bad.html','worse.html']);
 assert.deepEqual(r.manual[0].raw,{foo:'not a draft'});
});

test('A33 迁移记录可直接写入 v2 存储并读回',async()=>{
 const legacy={drafts:{'p/a.html':{source:'<p>旧</p>',changes:[['t0','旧改']]}},};
 const {records}=migrateLegacyDrafts(legacy,'dev-1',12345);
 const a=memAdapter();const s=new DraftStore(a,'drafts','dev-1');
 await s.saveDraft(records[0]);
 const loaded=await s.loadDraft('p/a.html');
 assert.equal(loaded?.workingSource,'<p>旧改</p>');
 assert.equal(loaded?.updatedAt,12345);
});

test('A29 audit 回归:首次保存正式写丢失时从 .tmp 回退(audit/drafts 2.1)',async()=>{
 const a=memAdapter();const s=new DraftStore(a,'drafts','dev-1');
 const orig=a.write.bind(a);
 a.write=async(p,data)=>{if(p.endsWith('.tmp'))await orig(p,data);}; // 正式写静默丢失(进程崩溃)
 a.remove=async()=>{/* 崩溃同样跳过了临时清理 */};
 await s.saveDraft(RECORD);
 const loaded=await s.loadDraft('pages/a.html');
 assert.equal(loaded?.workingSource,'<p>b</p>');
 assert.equal(loaded?.revision,3);
});

test('A29 audit 回归:正式文件撕裂时回退 .tmp 中较新的有效快照(audit/drafts 2.2)',async()=>{
 const a=memAdapter();const s=new DraftStore(a,'drafts','dev-1');
 await s.saveDraft(RECORD); // final=rev3
 // 第二次保存:tmp 校验通过后进程崩溃,正式写未发生;随后正式文件被撕裂写损坏
 const orig=a.write.bind(a);
 a.write=async(p,data)=>{if(p.endsWith('.tmp'))await orig(p,data);};
 const noRemove=a.remove.bind(a);
 a.remove=async()=>{/* 模拟崩溃跳过清理 */};
 await s.saveDraft({...RECORD,workingSource:'<p>new</p>',revision:4,updatedAt:2});
 const finalKey=[...a.files.keys()].find(k=>k.startsWith('drafts/')&&k.endsWith('.json')&&!k.endsWith('.tmp'))!;
 a.files.set(finalKey,'torn{');
 const loaded=await s.loadDraft('pages/a.html');
 assert.ok(loaded,'必须从 .tmp 回退,而不是返回 null');
 assert.equal(loaded.revision,4);
 assert.equal(loaded.workingSource,'<p>new</p>');
});

test('A29 audit 回归:磁盘上已有更新 revision 时拒绝旧写(audit/drafts 2.6)',async()=>{
 const a=memAdapter();const s=new DraftStore(a,'drafts','dev-1');
 await s.saveDraft({...RECORD,revision:5});
 await assert.rejects(()=>s.saveDraft({...RECORD,revision:4,updatedAt:99}),/更新 revision/);
 assert.equal((await s.loadDraft('pages/a.html'))?.revision,5);
});

// AC27 根因:文件名里的 ':' 在 Windows 上是 NTFS 备用数据流分隔符。实测
// writeFileSync 报成功,readdir 只回一个 0 字节基名条目,于是 listDrafts 的
// .json 过滤永远不命中(F23 清单全空)、removeDraft 删不掉、不同 revision 还会
// 共用同一条数据流。这里锁死"文件名不含任何文件系统保留字符"。
test('A27 草稿文件名不含文件系统保留字符(Windows 备用数据流回归)',async()=>{
 const a=memAdapter();
 const store=new DraftStore(a,'drafts','dev-1');
 await store.saveDraft(RECORD);
 const written=[...a.files.keys()].filter(k=>k.startsWith('drafts/'));
 assert.ok(written.length>=1,'应写入正式草稿文件');
 for(const p of written){
  const name=p.slice('drafts/'.length);
  for(const ch of [':','*','?','"','<','>','|','\\'])assert.ok(!name.includes(ch),`文件名不得包含 ${ch}: ${name}`);
  assert.match(name,/^[A-Za-z0-9_.-]+$/);
  assert.ok(name.endsWith('.json')||name.endsWith('.json.tmp'));
 }
 // 清单必须能看见刚写下的草稿
 const listed=await store.listDrafts();
 assert.equal(listed.records.length,1);
 assert.equal(listed.records[0].filePath,'pages/a.html');
});

test('A27 不同设备/路径的草稿映射到不同文件名,不互相覆盖',async()=>{
 const a=memAdapter();
 const s1=new DraftStore(a,'drafts','dev-aaa');
 const s2=new DraftStore(a,'drafts','dev-bbb');
 await s1.saveDraft({...RECORD,deviceId:'dev-aaa'});
 await s2.saveDraft({...RECORD,deviceId:'dev-bbb',filePath:'pages/b.html'});
 const finals=[...a.files.keys()].filter(k=>k.endsWith('.json')&&!k.endsWith('.tmp'));
 assert.equal(new Set(finals).size,2);
 assert.equal((await s1.loadDraft('pages/a.html'))?.filePath,'pages/a.html');
 assert.equal((await s2.loadDraft('pages/b.html'))?.filePath,'pages/b.html');
});

test('A29 removeDraft 同时清除撕裂写留下的 .tmp 回退副本',async()=>{
 const a=memAdapter();const s=new DraftStore(a,'drafts','dev-1');
 await s.saveDraft(RECORD);
 const final=[...a.files.keys()].find(k=>k.endsWith('.json')&&!k.endsWith('.tmp'))!;
 // 模拟"正式写完成、临时文件尚未清理"就崩溃
 a.files.set(`${final}.tmp`,a.files.get(final)!);
 await s.removeDraft('pages/a.html');
 assert.equal([...a.files.keys()].filter(k=>k.startsWith('drafts/')).length,0,'只删正式文件会让已丢弃的草稿在下次打开时复活');
 assert.equal(await s.loadDraft('pages/a.html'),null);
});

test('报告5 N1 回归:正式文件与 .tmp 并存时必须取 revision 较新的那份(两条路径判定一致)',async()=>{
 const a=memAdapter();const s=new DraftStore(a,'drafts','dev-1');
 await s.saveDraft(RECORD);                        // final = revision 3
 const name=(s as unknown as {fileName:(p:string)=>string}).fileName('pages/a.html');
 const finalPath=`drafts/${name}`;
 // 模拟撕裂写:.tmp 写成功、正式文件写失败 → 磁盘上是"旧正式 + 新临时"
 a.files.set(`${finalPath}.tmp`,JSON.stringify(sealDraftRecord({...RECORD,workingSource:'<p>NEWEST</p>',revision:5,updatedAt:2})));
 const loaded=await s.loadDraft('pages/a.html');
 const listed=await s.listDrafts();
 assert.equal(loaded?.revision,5,'恢复必须取 .tmp 里的新版');
 assert.equal(loaded?.workingSource,'<p>NEWEST</p>');
 assert.equal(listed.records.length,1);
 assert.equal(listed.records[0].record.revision,5,'管理器展示的必须是同一份');
 assert.equal(listed.records[0].record.workingSource,loaded?.workingSource,'展示与恢复内容一致');
 // 反向:.tmp 更旧时仍取正式文件
 a.files.set(`${finalPath}.tmp`,JSON.stringify(sealDraftRecord({...RECORD,workingSource:'<p>OLDER</p>',revision:1,updatedAt:0})));
 assert.equal((await s.loadDraft('pages/a.html'))?.revision,3);
 assert.equal((await s.listDrafts()).records[0].record.revision,3);
 // 身份校验仍在:记录里的 filePath 不匹配时按无草稿处理
 const other=sealDraftRecord({...RECORD,filePath:'pages/other.html',revision:9,updatedAt:3});
 a.files.set(`${finalPath}.tmp`,JSON.stringify(other));
 assert.equal((await s.loadDraft('pages/a.html'))?.revision,3);
});
