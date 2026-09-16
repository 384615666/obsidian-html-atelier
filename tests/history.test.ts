import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyPatches,computeInverse,PatchError,TextPatch,validatePatches} from '../src/core/patch';
import {HistoryError,TransactionController} from '../src/core/history';
import {fingerprint} from '../src/core/fingerprint';

const patch=(source:string,start:number,end:number,replacement:string):TextPatch=>({start,end,expected:source.slice(start,end),replacement});

test('A12 基础补丁：expected 校验、倒序应用、区间重叠拒绝',()=>{
 const source='<p>abc</p><p>def</p>';
 assert.equal(applyPatches(source,[patch(source,3,4,'X'),patch(source,13,14,'Y')]),'<p>Xbc</p><p>Yef</p>');
 assert.throws(()=>applyPatches(source,[patch(source,3,4,'X'),patch(source,3,6,'Y')]),(e:unknown)=>e instanceof PatchError&&e.code==='overlap');
 assert.throws(()=>applyPatches(source,[{start:3,end:6,expected:'wrong',replacement:'Y'}]),(e:unknown)=>e instanceof PatchError&&e.code==='expected-mismatch');
 assert.throws(()=>applyPatches(source,[]),(e:unknown)=>e instanceof PatchError&&e.code==='empty');
 // 逆向补丁可还原正向结果
 const patches=[patch(source,3,4,'LONG'),patch(source,13,14,'Q')];
 const out=applyPatches(source,patches);
 const inverse=computeInverse(patches);
 assert.equal(applyPatches(out,inverse),source);
 // 逆向补丁的坐标基于输出内容
 assert.equal(inverse[0].start,3);
 assert.equal(inverse[1].start,13+3);
});

test('A16 报告 12.2.1 变长案例：保存后两次撤销、两次重做，dirty 与内容一致',()=>{
 const c=new TransactionController('abc');
 assert.equal(c.revision,0);
 c.apply([patch('abc',1,1,'LONG')],{now:0});
 assert.equal(c.source,'aLONGbc');
 c.apply([patch('aLONGbc',6,7,'C')],{now:1});
 assert.equal(c.source,'aLONGbC');
 // 普通保存：内容、revision、epoch 均不变，仅关闭分组
 c.checkpointSave();
 assert.equal(c.revision,2);
 assert.equal(c.undoDepth,2);
 const base=c.source;
 c.undo();
 assert.equal(c.source,'aLONGbc');
 assert.equal(c.revision,3);
 assert.notEqual(c.source,base);
 c.undo();
 assert.equal(c.source,'abc');
 assert.equal(c.revision,4);
 // 磁盘基准仍为 aLONGbC（由上层持有），此处仅验证历史链
 c.redo();
 assert.equal(c.source,'aLONGbc');
 c.redo();
 assert.equal(c.source,'aLONGbC');
 assert.equal(c.revision,6);
 assert.equal(c.source,base);
});

test('A16 连续输入分组：同字段窗口内合并一次撤销，跨字段/超时/批量独立',()=>{
 const c=new TransactionController('<p></p>');
 c.apply([patch('<p></p>',3,3,'你')],{groupingKey:'seg-1',now:0});
 c.apply([patch('<p>你</p>',4,4,'好')],{groupingKey:'seg-1',now:400});
 c.apply([patch('<p>你好</p>',5,5,'吗')],{groupingKey:'seg-1',now:799});
 assert.equal(c.undoDepth,1);
 assert.equal(c.undo().source,'<p></p>');
 c.redo();
 // 超过合并窗口
 c.apply([patch('<p>你好吗</p>',6,6,'？')],{groupingKey:'seg-1',now:1700});
 assert.equal(c.undoDepth,2);
 // 换字段
 c.apply([patch('<p>你好吗？</p>',3,3,'【')],{groupingKey:'seg-2',now:1750});
 assert.equal(c.undoDepth,3);
 // 批量操作无分组键 → 独立事件
 c.apply([patch('<p>【你好吗？</p>',10,10,'】')],{now:1760});
 assert.equal(c.undoDepth,4);
});

test('A16 新修改清空 redo 分支',()=>{
 const c=new TransactionController('abc');
 c.apply([patch('abc',0,1,'X')],{now:0});
 c.undo();
 assert.equal(c.redoDepth,1);
 c.apply([patch('abc',0,1,'Y')],{now:1});
 assert.equal(c.redoDepth,0);
 assert.throws(()=>c.redo(),(e:unknown)=>e instanceof HistoryError&&e.code==='no-redo');
});

test('A16 撤销后先保存再重做：基准移动不影响历史链',()=>{
 const c=new TransactionController('abc');
 c.apply([patch('abc',0,3,'XYZ')],{now:0});
 c.undo();
 assert.equal(c.source,'abc');
 c.checkpointSave(); // 模拟以 abc 为新基准保存
 c.redo();
 assert.equal(c.source,'XYZ');
});

test('A16 多步骤批量事务：后一步校验失败时整体不落地',()=>{
 const c=new TransactionController('abc');
 c.apply([patch('abc',0,1,'X')],{now:0});
 // 构造一次包含错误 expected 的撤销尝试：直接篡改内容模拟并发写入
 c.source='aXc-modified';
 assert.throws(()=>c.undo(),(e:unknown)=>e instanceof HistoryError&&e.code==='fingerprint-mismatch');
 assert.equal(c.source,'aXc-modified'); // 临时结果未落地
 assert.equal(c.undoDepth,1);
});

test('A16 空撤销栈与指纹篡改拒绝',()=>{
 const c=new TransactionController('abc');
 assert.throws(()=>c.undo(),(e:unknown)=>e instanceof HistoryError&&e.code==='no-undo');
 assert.throws(()=>c.redo(),(e:unknown)=>e instanceof HistoryError&&e.code==='no-redo');
 // 栈顶 afterFingerprint 与当前内容不一致（绕过 apply 直接改源）→ 拒绝
 c.apply([patch('abc',0,1,'X')],{now:0});
 c.source='zzz';
 assert.throws(()=>c.undo(),(e:unknown)=>e instanceof HistoryError&&e.code==='fingerprint-mismatch');
});

test('A16 历史事件数上限：整事件裁剪，不拆分组',()=>{
 const c=new TransactionController('',{maxEvents:3,maxBytes:10_000_000,mergeDelayMs:800});
 for(let i=0;i<6;i++){
  const s=c.source;
  c.apply([patch(s,0,0,'x'.repeat(10))],{groupingKey:`f${i}`,now:i});
 }
 assert.ok(c.undoDepth<=3);
 // 最旧事件已丢弃：连续撤销最多 3 次后报 no-undo
 for(let i=0;i<3;i++)c.undo();
 assert.throws(()=>c.undo(),(e:unknown)=>e instanceof HistoryError&&e.code==='no-undo');
});

test('A16 历史字节预算：超预算裁掉最旧事件',()=>{
 const c=new TransactionController('',{maxEvents:1000,maxBytes:20,mergeDelayMs:800});
 for(let i=0;i<5;i++){
  const s=c.source;
  c.apply([patch(s,0,0,'y')],{groupingKey:`g${i}`,now:i}); // 每事件约 12 字节
 }
 assert.ok(c.historyBytes<=20);
 assert.ok(c.undoDepth>=1);
 c.undo();
 assert.ok(c.source.length>=0);
});

test('A16 外部重载开启新 epoch，旧历史不重放',()=>{
 const c=new TransactionController('abc');
 c.apply([patch('abc',0,1,'X')],{now:0});
 const dropped=c.resetForExternalLoad('全新内容');
 assert.equal(dropped.length,1);
 assert.equal(c.source,'全新内容');
 assert.equal(c.revision,2); // 编辑 +1，外部重载 +1
 assert.equal(c.undoDepth,0);
 assert.throws(()=>c.undo(),(e:unknown)=>e instanceof HistoryError&&e.code==='no-undo');
 // 新 epoch 上的编辑照常工作
 c.apply([patch('全新内容',0,2,'旧')],{now:1});
 assert.equal(c.undo().source,'全新内容');
});

test('A16 多视图顺序编辑共享同一 workingSource 与 revision',()=>{
 // 两个视图先后提交，第二个视图的补丁基于第一个视图提交后的内容构造
 const c=new TransactionController('<p>A</p>');
 const r1=c.apply([patch('<p>A</p>',3,4,'B')],{groupingKey:'v1',now:0});
 const s1=r1.source;
 c.apply([patch(s1,3,4,'C')],{groupingKey:'v2',now:1});
 assert.equal(c.source,'<p>C</p>');
 assert.equal(c.revision,2);
 c.undo(); // 撤销 v2
 assert.equal(c.source,'<p>B</p>');
 c.undo(); // 撤销 v1
 assert.equal(c.source,'<p>A</p>');
});

test('A23 指纹函数对内容敏感且稳定',()=>{
 assert.equal(fingerprint('abc'),fingerprint('abc'));
 assert.notEqual(fingerprint('abc'),fingerprint('abd'));
 assert.notEqual(fingerprint('abc'),fingerprint('abcd'));
 assert.notEqual(fingerprint('😀x'),fingerprint('\ud83dx')); // 代理对与孤立代理区分
});

test('A16 audit 回归:相邻零长度/变长区间共享边界被拒绝(audit/core FINDINGS #1)',()=>{
 const src='0123456789';
 const patches:TextPatch[]=[
  {start:1,end:2,expected:'1',replacement:'AAAA'},
  {start:2,end:4,expected:'23',replacement:''},
  {start:4,end:6,expected:'45',replacement:'ZZZZZ'},
 ];
 // 旧实现:forward 可写出,但逆向应用静默产出错误文本或抛错;新实现:正向构造即拒绝
 assert.throws(()=>validatePatches(src,patches),(e:unknown)=>e instanceof PatchError&&e.code==='overlap');
 // 相邻但非空等长的常规编辑不受影响
 const ok:TextPatch[]=[{start:1,end:2,expected:'1',replacement:'X'},{start:2,end:3,expected:'2',replacement:'Y'}];
 assert.equal(applyPatches(src,ok),'0XY3456789');
 const inv=computeInverse(ok);
 assert.equal(applyPatches('0XY3456789',inv),src);
});

test('A16 audit 回归:applyPatches 应用前逐补丁复验,错位必显式拒绝',()=>{
 // 逆向补丁区间被人造错位后,应用必须抛错而不是产出静默损坏
 const out='0AAAAZZZZZ6789';
 const badInv:TextPatch[]=[{start:1,end:5,expected:'AAAA',replacement:'1'},{start:5,end:5,expected:'',replacement:'23'},{start:5,end:10,expected:'ZZZZZ',replacement:'45'}];
 assert.throws(()=>applyPatches(out,badInv),(e:unknown)=>e instanceof PatchError);
});

// 审计复检 §3.4:清空 redo 分支时必须退还其字节,否则"撤销→继续编辑"会积累幽灵字节,
// trim() 随后按虚高的预算驱逐真实撤销历史(5 轮即清空全部历史)。
test('A16 audit 回归:撤销后继续编辑不产生幽灵字节,历史不被驱逐',()=>{
 const c=new TransactionController('x'.repeat(400000),{maxEvents:200,maxBytes:32*1024*1024,mergeDelayMs:800});
 const big='y'.repeat(400000);
 for(let i=0;i<5;i++){
  c.apply([{start:0,end:c.source.length,expected:c.source,replacement:big+String(i)}],{kind:'text'});
  c.undo();
  c.apply([{start:0,end:0,expected:'',replacement:'z'}],{kind:'text'});
 }
 assert.ok(c.historyBytes<1000,`不应积累幽灵字节,实得 ${c.historyBytes}`);
 assert.equal(c.undoDepth,5,'五次小编辑都应可撤销');
 assert.equal(c.redoDepth,0);
});

test('A16 audit 回归:普通连续编辑的记账保持正确(对照)',()=>{
 const c=new TransactionController('abc');
 for(let i=0;i<50;i++)c.apply([{start:0,end:0,expected:'',replacement:'z'}],{kind:'text'});
 assert.equal(c.undoDepth,50);
 assert.equal(c.redoDepth,0);
 assert.ok(c.historyBytes>0&&c.historyBytes<=50*8);
});
