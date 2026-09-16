import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SourceIndex} from '../src/parsing/sourceIndex';
import {buildTextMap} from '../src/parsing/textMap';
import {planParagraphEdit,graphemes,boundaryOffset,containerForOffset,containerIndexForOffset} from '../src/parsing/paragraphEdit';
import {validatePatches,applyPatches,computeInverse} from '../src/core/patch';

// 整段编辑的补丁规划。这几个用例正是审计 round4 的 BLOCKER:此前算法内嵌在视图私有
// 方法里,探针只能转写副本,修复无法被观察;抽成纯函数后直接测产品实现。

const plan=(source:string,ci:number,l0:number,l1:number,next:string)=>{
 const index=new SourceIndex(source);
 const map=buildTextMap(index).containers;
 const c=map[ci];
 assert.ok(c,`容器 ${ci} 不存在`);
 return {index,container:c,patches:planParagraphEdit(index,c,l0,l1,next)};
};
const applied=(source:string,ci:number,l0:number,l1:number,next:string)=>{
 const {index,patches}=plan(source,ci,l0,l1,next);
 if(!patches.length)return source;
 validatePatches(index.source,patches);
 return applyPatches(index.source,patches);
};

test('A24 含 <br> 的段落可以编辑(审计 round4 BUG 1)',()=>{
 const src='<html><head></head><body><p>ab<br>cd</p></body></html>';
 // 穷举 {X,Y} 上长度 0..5 的替换串:此前 63/63 被 patch.ts 的相邻防护拒绝
 const alphabet=['X','Y'];
 for(let len=0;len<=5;len++){
  const limit=Math.pow(alphabet.length,len);
  for(let n=0;n<limit;n++){
   let s='';let v=n;
   for(let k=0;k<len;k++){s+=alphabet[v%2];v=Math.floor(v/2);}
   const out=applied(src,0,0,5,s);
   assert.ok(typeof out==='string',`替换 ${JSON.stringify(s)} 应当可应用`);
   assert.ok(!out.includes('<br>')||s.includes('\n'),`替换 ${JSON.stringify(s)} 不应残留 <br>`);
  }
 }
});

test('A24 <br> 段落的具体形态',()=>{
 const src='<html><head></head><body><p>ab<br>cd</p></body></html>';
 assert.equal(applied(src,0,0,5,'xyz'),'<html><head></head><body><p>xyz</p></body></html>','整段改写应落到单个补丁');
 assert.equal(applied(src,0,0,5,'abYcd'),'<html><head></head><body><p>abYcd</p></body></html>','换行被替换成文字');
 assert.equal(applied(src,0,0,5,'ab\ncd\n'),'<html><head></head><body><p>ab<br>cd<br></p></body></html>','新增换行写成 <br>');
 assert.equal(applied(src,0,0,5,''),'<html><head></head><body><p></p></body></html>','清空段落');
});

test('A24 预览里回车必须真的换行(审计 round4 缺陷 43)',()=>{
 const src='<html><head></head><body><p>ab</p></body></html>';
 assert.equal(applied(src,0,0,2,'a\nb'),'<html><head></head><body><p>a<br>b</p></body></html>');
 // <pre> 内保留真实换行字符,不写 <br>
 const pre='<html><head></head><body><pre>ab</pre></body></html>';
 assert.equal(applied(pre,0,0,2,'a\nb'),'<html><head></head><body><pre>a\nb</pre></body></html>');
});

test('A24 内联结构在未变部分保持(块以标签为界)',()=>{
 const src='<html><head></head><body><p>AAAA<b>BBBB</b></p></body></html>';
 const out=applied(src,0,0,8,'x😀y😀z');
 assert.ok(out.includes('<b>'),'<b> 必须保留');
 assert.ok(/^(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\uD800-\uDFFF])*$/.test(out),'不得写出孤立代理项');
});

test('A24 空段落与纯空白段落都能写回(审计 round4 BUG 2/BUG 11)',()=>{
 const empty='<html><head></head><body><p></p></body></html>';
 assert.equal(applied(empty,0,0,0,'hello'),'<html><head></head><body><p>hello</p></body></html>');
 const ws='<html><head></head><body><p>   </p></body></html>';
 const out=applied(ws,0,0,0,'hello');
 assert.ok(out.includes('hello'),'纯空白段落必须能写入');
 const map=new SourceIndex(empty);
 eqContainers(empty,1);
 void map;
});

test('A24 清空后的段落仍留在容器列表里(审计 round4 BUG 2)',()=>{
 const withEmpty='<html><body><p>a</p><p></p><p>b</p></body></html>';
 const index=new SourceIndex(withEmpty);
 const containers=buildTextMap(index).containers;
 assert.equal(containers.length,3,'空段落必须占一个容器');
 assert.deepEqual(containers.map(c=>c.logical),['a','','b']);
});

function eqContainers(src:string,n:number){
 const index=new SourceIndex(src);
 assert.equal(buildTextMap(index).containers.length,n);
}

test('A24 逻辑文本过长实体不再让整段掉出映射(审计 round4 BUG 10)',()=>{
 const src='<html><body><p>a &bigtriangledown; b</p></body></html>';
 const index=new SourceIndex(src);
 const containers=buildTextMap(index).containers;
 assert.equal(containers.length,1,'含长命名实体的段落必须有容器');
 assert.equal(containers[0].logical,'a ▽ b');
 assert.equal(buildTextMap(index).unmappableNodes.length,0);
});

test('A13 负数逻辑下标不再抛异常(审计 round4 缺陷 19)',()=>{
 const {patches}=plan('<html><body><p>abc</p></body></html>',0,-5,2,'X');
 assert.ok(Array.isArray(patches));
 const index=new SourceIndex('<p>abc</p>');
 const map=buildTextMap(index).containers;
 assert.doesNotThrow(()=>planParagraphEdit(index,map[0],-1,3,'X'));
});

test('A13 按源偏移定位容器能区分内容相同的段落(审计 round4 BUG 9)',()=>{
 const src='<html><body><p>same</p><p>same</p></body></html>';
 const index=new SourceIndex(src);
 const map=buildTextMap(index).containers;
 assert.equal(map.length,2);
 const first=index.nodes.find(n=>n.kind==='text')!;
 const second=index.nodes.filter(n=>n.kind==='text')[1]!;
 assert.equal(containerForOffset(map,first.start),map[0]);
 assert.equal(containerForOffset(map,second.start),map[1]);
 // 编辑第二段:补丁必须落在第二段的偏移上
 const patches=planParagraphEdit(index,map[1],0,4,'SECOND');
 validatePatches(src,patches);
 const out=applyPatches(src,patches);
 assert.equal(out,'<html><body><p>same</p><p>SECOND</p></body></html>');
});

test('A13 缩进开头的段落不再让整段编辑静默无效(用户实测 2026-09-16)',()=>{
 // 排版过的真实文档:文字节点以换行+缩进开头,折叠空白被丢弃后 node.start 落在
 // 映射空隙 —— 此前 containerIndexForOffset 恒 -1,「整段编辑」按下去没有任何
 // 反应。按节点回退必须仍能定位到容器。
 const src='<html><body>\n  <div>\n    <p>\n      缩进段落文字\n    </p>\n  </div>\n</body></html>';
 const index=new SourceIndex(src);
 const map=buildTextMap(index).containers;
 const p=map.find(c=>c.tag==='p')!;
 assert.ok(p,'段落必须有容器');
 const node=index.nodes.find(n=>n.kind==='text'&&n.value.includes('缩进段落文字'))!;
 // 严格字符区间命中:node.start 指向被丢弃的空白,不在任何 map 区间内
 assert.equal(containerForOffset(map,node.start),null,'前置断言:空白起点本就落在区间外');
 // 传入 index 后按节点回退:命中该节点所在的段落容器
 assert.equal(containerForOffset(map,node.start,index),p);
 assert.equal(containerIndexForOffset(map,node.start,index),map.indexOf(p));
 // 整段替换仍可精确写回:保留源码缩进结构,只动逻辑文本
 const patches=planParagraphEdit(index,p,0,p.logical.length,'改写后的整段');
 validatePatches(index.source,patches);
 const out=applyPatches(index.source,patches);
 assert.equal(out,'<html><body>\n  <div>\n    <p>\n      改写后的整段\n    </p>\n  </div>\n</body></html>');
});

test('A16 整段补丁可撤销(逆向补丁与正向一一对应)',()=>{
 const src='<html><head></head><body><p>ab<br>cd</p></body></html>';
 const {index,patches}=plan(src,0,0,5,'xyz');
 validatePatches(index.source,patches);
 const out=applyPatches(index.source,patches);
 const back=applyPatches(out,computeInverse(patches));
 assert.equal(back,src,'撤销必须回到原文');
});

test('A24 字素簇切分不拆代理对与组合序列',()=>{
 assert.deepEqual(graphemes('😀'),['😀']);
 assert.deepEqual(graphemes('👨‍👩‍👧'),['👨‍👩‍👧']);
 assert.deepEqual(graphemes('🇨🇳'),['🇨🇳']);
 assert.deepEqual(graphemes('a😀b'),['a','😀','b']);
});

test('A24 boundaryOffset 只对非空容器给点',()=>{
 const index=new SourceIndex('<p></p>');
 const c=buildTextMap(index).containers[0];
 assert.equal(boundaryOffset(c,0),null,'空容器没有可插入点');
 const withText=new SourceIndex('<p>ab</p>');
 const c2=buildTextMap(withText).containers[0];
 assert.equal(typeof boundaryOffset(c2,0),'number');
});
