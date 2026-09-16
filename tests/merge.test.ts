import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diffHunks,tokenizeLines} from '../src/services/merge/diff';
import {diff3Merge,assemble,referenceMergeEngine} from '../src/services/merge/diff3';

test('A26 不相交修改自动合并',()=>{
 const r=diff3Merge('a\nb\nc\n','a\nB\nc\n','a\nb\nC\n');
 assert.equal(r.conflictCount,0);
 assert.equal(assemble(r.chunks,()=>''),'a\nB\nC\n');
 // 反向各改一行
 const r2=referenceMergeEngine.merge({base:'1\n2\n3\n4\n5\n',local:'1\n2\n3\n4\nFIVE\n',remote:'ONE\n2\n3\n4\n5\n'});
 assert.equal(r2.conflictCount,0);
 assert.equal(assemble(r2.chunks,()=>''),'ONE\n2\n3\n4\nFIVE\n');
});

test('A26 同一文本双方修改 → 冲突块保留两侧选项',()=>{
 const r=diff3Merge('a\nb\nc\n','a\n theirs1 \nc\n','a\n theirs2 \nc\n');
 assert.equal(r.conflictCount,1);
 const c=r.chunks.find(x=>x.type==='conflict')!;
 assert.equal(c.localText,' theirs1 \n');
 assert.equal(c.remoteText,' theirs2 \n');
 assert.equal(c.text,'b\n');
 // 用户选择 local
 assert.equal(assemble(r.chunks,ch=>ch.localText??''),'a\n theirs1 \nc\n');
});

test('A26 相同边界处插入 → 保守冲突；不同位置插入可自动合并',()=>{
 const r=diff3Merge('a\nb\n','X\na\nb\n','Y\na\nb\n');
 assert.equal(r.conflictCount,1);
 const ok=diff3Merge('a\nb\nc\n','a\nINS\nb\nc\n','a\nb\nINS2\nc\n');
 assert.equal(ok.conflictCount,0);
 assert.equal(assemble(ok.chunks,()=>''),'a\nINS\nb\nINS2\nc\n');
});

test('A26 双方相同修改 → 直接解决',()=>{
 const r=diff3Merge('a\nb\n','a\nSAME\n','a\nSAME\n');
 assert.equal(r.conflictCount,0);
 assert.equal(assemble(r.chunks,()=>''),'a\nSAME\n');
});

test('A26 CRLF 与混合换行保留；行终止符变化按修改处理',()=>{
 const r=diff3Merge('h1\r\nh2\r\n','h1\r\nEDIT\r\n','h1\r\nh2\r\n');
 assert.equal(r.conflictCount,0);
 assert.equal(assemble(r.chunks,()=>''),'h1\r\nEDIT\r\n');
 // 仅换行风格不同的行视为不同内容（双方都改动该行 → 冲突）
 const mixed=diff3Merge('a\nb\n','a\r\nb\n','a  \nb\n');
 assert.equal(mixed.conflictCount,1);
 // 尾部换行删除
 const tail=diff3Merge('a\nb\n','a\nb','a\nb\n');
 assert.equal(assemble(tail.chunks,()=>''),'a\nb');
});

test('A26 删除与编辑同一行 → 冲突；双方删除同一行 → 解决',()=>{
 const delEdit=diff3Merge('a\nb\nc\n','a\nc\n','a\nB2\nc\n');
 assert.equal(delEdit.conflictCount,1);
 const bothDel=diff3Merge('a\nb\nc\n','a\nc\n','a\nc\n');
 assert.equal(bothDel.conflictCount,0);
 assert.equal(assemble(bothDel.chunks,()=>''),'a\nc\n');
});

test('A26 多行块修改与单行编辑重叠 → 冲突',()=>{
 const r=diff3Merge('1\n2\n3\n4\n5\n','1\nTWO\nTHREE\n4\n5\n','1\n2\nX\n4\n5\n');
 assert.equal(r.conflictCount,1);
});

test('diff 契约：hunks 应用后等于目标序列（模糊测试）',()=>{
 let seed=42;
 const rand=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};
 for(let iter=0;iter<300;iter++){
  const n=Math.floor(rand()*12);
  const a=Array.from({length:n},(_,k)=>`t${Math.floor(rand()*8)}#${k}`);
  const b=a.filter(()=>rand()>0.25).map(t=>rand()>0.3?t:`x${t}`);
  if(rand()>0.7)b.push('extra');
  const hunks=diffHunks(a,b);
  // 应用 hunks
  const out:string[]=[];
  let pos=0;
  for(const h of hunks){
   assert.ok(h.aStart>=pos,'hunks 必须按序且不重叠');
   out.push(...a.slice(pos,h.aStart),...h.tokens);
   pos=h.aEnd;
  }
  out.push(...a.slice(pos));
  assert.deepEqual(out,b,`第 ${iter} 轮 diff 应用失败: ${JSON.stringify([a,b,hunks])}`);
 }
});

test('diff 超容量回退为整段替换（保守不丢失）',()=>{
 const big=Array.from({length:3000},(_,k)=>`l${k}`);
 const other=big.map(t=>t+'!');
 const hunks=diffHunks(big,other);
 assert.equal(hunks.length,1);
 assert.equal(hunks[0].aStart,0);
 assert.equal(hunks[0].aEnd,3000);
});

test('A26 空输入与完全一致输入',()=>{
 assert.deepEqual(diff3Merge('','', '').conflictCount,0);
 const same=diff3Merge('<p>a</p>','<p>a</p>','<p>a</p>');
 assert.deepEqual(same.chunks,[{type:'same',text:'<p>a</p>'}]);
 assert.equal(tokenizeLines('a\n\r\nb').length,3);
});
