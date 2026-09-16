import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DocumentSession,MissingError,SessionIO} from '../src/core/session';
import {fingerprint} from '../src/core/fingerprint';

const sp=(source:string,start:number,end:number,replacement:string)=>({start,end,expected:source.slice(start,end),replacement});

// 模拟 vault.process 的原子比较写：读取当前磁盘 → decide 返回写入内容或 null(冲突)。
function mockIO(disk:{text:string|null}):SessionIO & {writes:number}{
 return {
  writes:0,
  async process(decide){
   if(disk.text===null)throw new MissingError();
   const next=decide(disk.text);
   if(next===null)return 'conflict';
   disk.text=next;this.writes++;
   return 'written';
  },
 };
}

test('A16 会话：编辑→改回原文即 clean；冲突状态不因改回原文解除',()=>{
 const s=new DocumentSession('a.html','<p>Hi</p>','<p>Hi</p>');
 assert.equal(s.dirty,false);
 s.applyEdit([sp('<p>Hi</p>',3,5,'Hello')],{groupingKey:'f'});
 assert.equal(s.dirty,true);
 assert.equal(s.contentState,'dirty');
 s.applyEdit([sp('<p>Hello</p>',3,8,'Hi')],{groupingKey:'f'});
 assert.equal(s.dirty,false);
 assert.equal(s.contentState,'clean');

 // 冲突：外部改动 + 本地草稿
 s.applyEdit([sp('<p>Hi</p>',3,5,'Hello')],{groupingKey:'f'});
 s.externalChange('<p>External</p>');
 assert.equal(s.contentState,'conflict');
 // 冲突期间允许继续编辑与撤销
 s.applyEdit([sp('<p>Hello</p>',3,8,'Hey')],{groupingKey:'g'});
 assert.equal(s.contentState,'conflict');
 s.undo();
 assert.equal(s.source,'<p>Hello</p>');
 // 撤销到旧 Base 也不解除冲突（磁盘 Remote 仍不同）
 s.undo();
 assert.equal(s.source,'<p>Hi</p>');
 assert.equal(s.contentState,'conflict');
 const io=mockIO({text:'<p>External</p>'});
 void io;
});

test('A16 普通保存：写入成功保留 undo/redo 与 revision，基准前移',async()=>{
 const disk={text:'<p>Hi</p>'};
 const s=new DocumentSession('a.html','<p>Hi</p>','<p>Hi</p>');
 s.applyEdit([sp('<p>Hi</p>',3,5,'Hello')],{groupingKey:'f'});
 const io=mockIO(disk);
 const outcome=await s.save(io);
 assert.equal(outcome.result,'written');
 assert.equal(disk.text,'<p>Hello</p>');
 assert.equal(s.dirty,false);
 assert.equal(s.contentState,'clean');
 assert.equal(s.revision,1); // 保存不递增 revision
 assert.equal(s.historyEpoch,'e1');
 assert.equal(s.controller.undoDepth,1); // 保留历史
 // 保存后撤销 → dirty 重新出现，磁盘未变
 s.undo();
 assert.equal(s.source,'<p>Hi</p>');
 assert.equal(s.dirty,true);
 assert.equal(disk.text,'<p>Hello</p>');
});

test('A16 保存时磁盘已变化 → conflict；IO 失败保留 dirty 与 lastError',async()=>{
 const disk={text:'<p>Changed</p>'};
 const s=new DocumentSession('a.html','<p>Hi</p>','<p>Hi</p>');
 s.applyEdit([sp('<p>Hi</p>',3,5,'Hello')],{groupingKey:'f'});
 const io=mockIO(disk);
 assert.equal((await s.save(io)).result,'conflict');
 assert.equal(s.contentState,'conflict');
 assert.equal(disk.text,'<p>Changed</p>'); // 未覆盖
 assert.equal(s.dirty,true);

 const failing:SessionIO={async process(){throw new Error('disk full');}};
 const s2=new DocumentSession('b.html','<p>Hi</p>','<p>Hi</p>');
 s2.applyEdit([sp('<p>Hi</p>',3,5,'Hello')],{groupingKey:'f'});
 assert.equal((await s2.save(failing)).result,'io-error');
 assert.equal(s2.contentState,'dirty'); // 错误不吞掉 dirty
 assert.equal(s2.lastError?.action,'save');
 assert.equal(s2.operation,'idle');
});

test('A16 干净内容的外部更新：采用磁盘版本、新 epoch、旧历史丢弃',()=>{
 const s=new DocumentSession('a.html','<p>V1</p>','<p>V1</p>');
 s.applyEdit([sp('<p>V1</p>',3,5,'X')],{groupingKey:'f'});
 s.undo(); // clean
 const oldEpoch=s.historyEpoch;
 const result=s.externalChange('<p>V2</p>');
 assert.equal(result?.adopted,true);
 assert.equal(result?.droppedHistory.length,1);
 assert.equal(s.source,'<p>V2</p>');
 assert.equal(s.baseSource,'<p>V2</p>');
 assert.notEqual(s.historyEpoch,oldEpoch);
 assert.equal(s.contentState,'clean');
 assert.equal(s.controller.undoDepth,0);
 // 与基准相同的外部通知被忽略
 assert.equal(s.externalChange('<p>V2</p>'),null);
});

test('A16 保存期间外部变化排队；保存禁用期间编辑/撤销被拒',async()=>{
 const disk={text:'<p>Hi</p>'};
 const s=new DocumentSession('a.html','<p>Hi</p>','<p>Hi</p>');
 s.applyEdit([sp('<p>Hi</p>',3,5,'Hello')],{groupingKey:'f'});
 // 慢 IO：decide 被调用后挂起
 let release:(()=>void)|null=null;
 const io:SessionIO={process:async decide=>{
  const next=decide(disk.text);
  if(next===null)return 'conflict';
  await new Promise<void>(r=>{release=r;});
  disk.text=next;return 'written';
 }};
 const saving=s.save(io);
 assert.equal(s.operation,'saving');
 assert.equal(s.externalChange('<p>Other</p>'),null); // 排队，不立即处理
 assert.throws(()=>s.applyEdit([sp('<p>Hello</p>',3,8,'X')],{}),/暂时禁用/);
 assert.throws(()=>s.undo(),/暂时禁用/);
 release?.();
 assert.equal((await saving).result,'written');
 assert.equal(s.operation,'idle');
 // 保存结束后宿主补发排队的磁盘事件（磁盘已是我们的写入结果时按基准比较忽略）
 assert.equal(s.externalChange(disk.text),null);
});

test('A16 文件缺失：markMissing 后编辑拒绝，保存返回 missing',async()=>{
 const s=new DocumentSession('a.html','<p>Hi</p>','<p>Hi</p>');
 s.markMissing();
 assert.throws(()=>s.applyEdit([sp('<p>Hi</p>',3,5,'X')],{}),/已删除/);
 const io=mockIO({text:null});
 assert.equal((await s.save(io)).result,'missing');
 // MissingError 抛出路径
 const s2=new DocumentSession('b.html','<p>Hi</p>','<p>Hi</p>');
 s2.applyEdit([sp('<p>Hi</p>',3,5,'Hello')],{groupingKey:'f'});
 const throwing:SessionIO={async process(){throw new MissingError();}};
 assert.equal((await s2.save(throwing)).result,'missing');
 assert.equal(s2.contentState,'missing');
});

test('A26 三方合并应用：合并稿与新基准、新历史段',()=>{
 const s=new DocumentSession('a.html','<p>Base</p>','<p>Local</p>');
 s.externalChange('<p>Remote</p>');
 assert.equal(s.contentState,'conflict');
 // 应用合并：base=Remote，working=合并稿
 const dropped=s.applyMergeResult('<p>Merged</p>','<p>Remote</p>');
 assert.ok(dropped.length>=0);
 assert.equal(s.source,'<p>Merged</p>');
 assert.equal(s.baseSource,'<p>Remote</p>');
 assert.equal(s.baseHash,fingerprint('<p>Remote</p>'));
 assert.equal(s.contentState,'dirty');
 assert.notEqual(s.historyEpoch,'e1');
 // 合并稿等于 Remote → clean
 const s2=new DocumentSession('b.html','<p>Base</p>','<p>Local</p>');
 s2.externalChange('<p>Same</p>');
 s2.applyMergeResult('<p>Same</p>','<p>Same</p>');
 assert.equal(s2.contentState,'clean');
});

test('A30 解析登记：parsedRevision 匹配才开放可视化编辑',()=>{
 const s=new DocumentSession('a.html','<p>Hi</p>','<p>Hi</p>');
 assert.equal(s.canUseVisualEdits(),false);
 s.setParsed({segments:[]});
 assert.equal(s.canUseVisualEdits(),true);
 s.applyEdit([sp('<p>Hi</p>',3,5,'Ho')],{groupingKey:'f'});
 assert.equal(s.canUseVisualEdits(),false); // revision 前进，旧解析过期
});

test('A16 audit 回归:保存进行中调用 adoptRemote/applyMergeResult 被拒绝(audit/core S5)',async()=>{
 const disk={text:'<p>Hi</p>'};
 const s=new DocumentSession('a.html','<p>Hi</p>','<p>Hi</p>');
 s.applyEdit([sp('<p>Hi</p>',3,5,'Mine')],{groupingKey:'f'});
 let release:()=>void;
 const io:SessionIO={process:async decide=>{
  const next=decide(disk.text);
  if(next===null)return 'conflict';
  await new Promise<void>(r=>{release=r;});
  disk.text=next;return 'written';
 }};
 const saving=s.save(io);
 assert.throws(()=>s.adoptRemote('<p>Remote</p>'),/不能采用磁盘版本/);
 assert.throws(()=>s.applyMergeResult('<p>M</p>','<p>R</p>'),/不能应用合并结果/);
 release();
 await saving;
 // 保存结束后可正常解除冲突,基准一致
 assert.equal(s.adoptRemote(disk.text).length,1); // 保存前的编辑事件随新 epoch 丢弃
 assert.equal(s.baseSource,disk.text);
 assert.equal(s.contentState,'clean');
});

test('A16 audit 回归:被阻止的保存也关闭输入分组(audit/core S3)',async()=>{
 const s=new DocumentSession('a.html','<p>Hi</p>','<p>Hi</p>');
 s.applyEdit([sp('<p>Hi</p>',3,5,'A')],{groupingKey:'k',now:0});
 s.externalChange('<p>Remote</p>'); // conflict,保存将被阻止
 assert.equal(s.contentState,'conflict');
 assert.equal((await s.save(mockIO({text:'<p>Remote</p>'}))).result,'blocked');
 s.applyEdit([sp('<p>A</p>',3,4,'B')],{groupingKey:'k',now:1}); // workingSource 是 <p>A</p>
 assert.equal(s.controller.undoDepth,2,'保存尝试后同键输入不得并入上一分组');
 // 外部事件排队标记对宿主可见(保存结束后宿主据此补查磁盘)
 const s2=new DocumentSession('b.html','<p>x</p>','<p>x</p>');
 s2.applyEdit([sp('<p>x</p>',3,4,'y')],{groupingKey:'f'});
 let release2:()=>void;
 const gate:SessionIO={process:async decide=>{
  const next=decide('<p>x</p>');
  if(next===null)return 'conflict';
  await new Promise<void>(r=>{release2=r;});
  return 'written';
 }};
 const p2=s2.save(gate);
 assert.equal(s2.externalChange('<p>z</p>'),null);
 assert.equal(s2.hasQueuedExternal,true);
 release2();
 await p2;
 // 标记必须留给宿主:保存自己清掉它 = 排队的外部变化被静默丢弃,会话随后自认与磁盘同步,
 // 下一次保存就覆盖对方版本(审计 round4 BUG 21)。宿主补发之后才调 consumeQueuedExternal。
 assert.equal(s2.hasQueuedExternal,true,'save() 不得替宿主消费排队的外部变化');
 s2.consumeQueuedExternal();
 assert.equal(s2.hasQueuedExternal,false);
});
