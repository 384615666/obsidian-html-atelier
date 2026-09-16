import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SourceIndex} from '../src/parsing/sourceIndex';
import {buildTextMap,rangesForLogical,replaceLogical,decodeRawWithMap} from '../src/parsing/textMap';
import {escapeText,escapeAttrValue} from '../src/parsing/escape';

const first=(index:SourceIndex,tag:string)=>{
 const c=buildTextMap(index).containers.find(c=>c.tag===tag);
 assert.ok(c,`缺少 ${tag} 容器`);
 return c;
};

test('A05 CRLF/BOM 夹具：所有节点源区间可直接 slice 还原原文',()=>{
 const source='\uFEFF<!DOCTYPE html>\r\n<html>\r\n<body>\r\n<p>中文 &amp; 空格</p>\r\n</body>\r\n</html>\r\n';
 const index=new SourceIndex(source);
 for(const n of index.textNodes()){
  if(n.start<0)continue;
  assert.equal(source.slice(n.start,n.end),n.raw,`节点 ${n.id} 区间不匹配`);
 }
 const p=first(index,'p');
 assert.equal(p.logical,'中文 & 空格');
 // &amp; 实体的映射还原到原始拼写
 const amp=p.logical.indexOf('&');
 const ranges=rangesForLogical(p,amp,amp+1);
 assert.equal(source.slice(ranges[0].srcStart,ranges[0].srcEnd),'&amp;');
});

test('A13 实体多种写法解码并保留映射；替换生成转义补丁',()=>{
 const source='<p>A &amp; B &#x4E2D; &nbsp; &#128512; &unknown; &</p>';
 const index=new SourceIndex(source);
 const p=first(index,'p');
 assert.equal(p.logical,'A & B 中 \u00a0 \ud83d\ude00 &unknown; &');
 // 😀 是 astral 字符：两个 UTF-16 单元都映射到同一源区间
 const dIdx=p.logical.indexOf('\ud83d\ude00');
 const dMap=p.map[dIdx];
 assert.equal(p.map[dIdx+1].srcStart,dMap.srcStart);
 assert.equal(dMap.srcEnd-dMap.srcStart,'&#128512;'.length);
 // 替换 & 为转义后的内容
 const res=replaceLogical(index,p,ampOf(p.logical),ampOf(p.logical)+1,'<b>&</b>');
 assert.ok(res.ok);
 if(res.ok){
  assert.equal(index.source.slice(res.patch.start,res.patch.end),'&amp;');
  assert.equal(res.patch.replacement,'&lt;b&gt;&amp;&lt;/b&gt;');
 }
});
const ampOf=(s:string)=>s.indexOf('&');

test('A13 跨 strong 的短语：逻辑文本命中并生成跨节点区间列表',()=>{
 const source='<p>你好 <strong>世界</strong>！</p>';
 const index=new SourceIndex(source);
 const p=first(index,'p');
 assert.equal(p.logical,'你好 世界！');
 const hit=p.logical.indexOf('好 世界');
 const ranges=rangesForLogical(p,hit,hit+4);
 assert.equal(ranges.length,2); // p 的文字节点 + strong 的文字节点
 assert.equal(index.source.slice(ranges[0].srcStart,ranges[0].srcEnd),'好 ');
 assert.equal(index.source.slice(ranges[1].srcStart,ranges[1].srcEnd),'世界');
 const cross=replaceLogical(index,p,hit,hit+4,'X');
 assert.equal(cross.ok,false);
 if(!cross.ok)assert.equal(cross.reason,'cross-node');
});

test('A13 同节点替换：只改受影响源区间并保留其余原文',()=>{
 const source='<h1>你好 <em>世界</em></h1><p data-x="1">另一段</p>';
 const index=new SourceIndex(source);
 const h=first(index,'h1');
 const res=replaceLogical(index,h,0,2,'再见');
 assert.ok(res.ok);
 if(res.ok){
  const patched=index.source.slice(0,res.patch.start)+res.patch.replacement+index.source.slice(res.patch.end);
  assert.equal(patched,'<h1>再见 <em>世界</em></h1><p data-x="1">另一段</p>');
 }
});

test('A13 空白按可读语义折叠、nbsp 保留、跨节点空白合并',()=>{
 const index=new SourceIndex('<p>  a \t b&nbsp;c </p>');
 const p=first(index,'p');
 assert.equal(p.logical,'a b\u00a0c');
});

test('A14 pre 容器保留空白',()=>{
 const index=new SourceIndex('<pre>  a  b </pre>');
 const pre=first(index,'pre');
 assert.equal(pre.logical,'  a  b ');
 assert.equal(pre.preserveWhitespace,true);
});

test('A14 br 映射到标签区间并产生换行；br 后行首空白被折叠',()=>{
 const source='<p>a<br>   b</p>';
 const index=new SourceIndex(source);
 const p=first(index,'p');
 assert.equal(p.logical,'a\nb');
 const nl=p.logical.indexOf('\n');
 const r=p.map[nl];
 assert.equal(source.slice(r.srcStart,r.srcEnd),'<br>');
});

test('A14 畸形 HTML：parse5 合成结构下文字仍有有效源区间',()=>{
 const source='<table><tr><td>一<td>二</table><p>三';
 const index=new SourceIndex(source);
 const map=buildTextMap(index);
 const logicals=map.containers.map(c=>c.logical).sort();
 assert.deepEqual(logicals,['一','三','二']);
 for(const c of map.containers)for(const m of c.map)
  assert.ok(m.srcStart>=0&&m.srcEnd<=source.length);
});

test('A13/A14 隐藏内容标记但不混入默认可见性判断错误',()=>{
 const index=new SourceIndex('<p hidden>隐藏</p><div style="display:none">样式隐藏</div><input type="hidden" value="v"><p>可见</p>');
 const map=buildTextMap(index);
 const byText=(t:string)=>map.containers.find(c=>c.logical===t);
 assert.equal(byText('隐藏')?.hidden,true);
 assert.equal(byText('样式隐藏')?.hidden,true);
 assert.equal(byText('可见')?.hidden,false);
});

test('A13 排除区域（script/style/title/svg 等）不进入映射',()=>{
 const index=new SourceIndex('<title>t</title><script>var a=1;</script><style>.x{}</style><svg><text>vec</text></svg><p>正文</p>');
 const map=buildTextMap(index);
 assert.deepEqual(map.containers.map(c=>c.logical),['正文']);
});

test('A12 属性扫描：单双引号、无引号与转义辅助',()=>{
 const index=new SourceIndex('<a href=\'a b.html\' class="x" data-n=3>链</a>');
 const a=index.elements('a')[0];
 const href=a.attrs.find(x=>x.name==='href')!;
 assert.deepEqual([href.valueStart,href.valueEnd],[9,17]);
 assert.equal(href.quote,"'");
 assert.equal(index.source.slice(href.valueStart,href.valueEnd),'a b.html');
 assert.equal(href.hasEqual,true);
 const cls=a.attrs.find(x=>x.name==='class')!;
 assert.equal(cls.quote,'"');
 const dn=a.attrs.find(x=>x.name==='data-n')!;
 assert.equal(dn.quote,'');
 assert.equal(dn.hasEqual,true);
 // 引号无论包裹形式一律同时转义,消除包裹/转义引号错配(audit/parsing R5)
 assert.equal(escapeAttrValue('a"b\'c&d','"'),'a&quot;b&#39;c&amp;d');
 assert.equal(escapeAttrValue('a"b\'c&d',"'"),'a&quot;b&#39;c&amp;d');
 // 无引号场景:空白与 > 会截断值,必须转义(audit/parsing R4)
 assert.equal(escapeAttrValue('a b>c',''),'a&#32;b&gt;c');
 assert.equal(escapeText('<a>&'),'&lt;a&gt;&amp;');
});

test('A12 audit 回归:无空格相邻属性/布尔属性/换行赋值(audit/parsing R1-R3)',()=>{
 const src='<div a="1"b="2">t</div>';
 const adjacent=new SourceIndex(src).elements('div')[0];
 const a1=adjacent.attrs.find(x=>x.name==='a')!;
 // 写回 valueStart..valueEnd 必须恰好落在引号内
 const patched=src.slice(0,a1.valueStart)+'NEW'+src.slice(a1.valueEnd);
 assert.equal(patched,'<div a="NEW"b="2">t</div>');
 assert.equal(new SourceIndex(patched).elements('div')[0].attrs.find(x=>x.name==='a')?.value,'NEW');
 // 布尔属性:hasEqual=false,值区间为空集且锚在属性名后;写入方按 ="value" 插入而不是原地替换
 const boolSrc='<div a b=2>t</div>';
 const bool=new SourceIndex(boolSrc).elements('div')[0];
 const ab=bool.attrs.find(x=>x.name==='a')!;
 assert.equal(ab.hasEqual,false);
 assert.equal(ab.valueStart,ab.valueEnd);
 assert.equal(boolSrc.slice(ab.valueStart,ab.valueEnd),'');
 assert.equal(bool.attrs.find(x=>x.name==='b')?.hasEqual,true);
 // 布尔属性的正确写值路径:插入 ="NEW"
 const boolPatched=boolSrc.slice(0,ab.valueStart)+'="NEW"'+boolSrc.slice(ab.valueEnd);
 assert.deepEqual(new SourceIndex(boolPatched).elements('div')[0].attrs.map(x=>[x.name,x.value]),[['a','NEW'],['b','2']]);
 // 换行赋值:值区间精确
 const nlSrc='<div a\n=\n"1">t</div>';
 const an=new SourceIndex(nlSrc).elements('div')[0].attrs.find(x=>x.name==='a')!;
 assert.equal(an.quote,'"');
 assert.equal(nlSrc.slice(an.valueStart,an.valueEnd),'1');
});

test('A12 audit 回归:style 属性内的 display:none 子串不触发 hidden(audit/parsing R8)',()=>{
 assert.equal(new SourceIndex('<div style="background:url(display:none.png)">可见文字</div>').elements('div')[0].hidden,false);
 assert.equal(new SourceIndex('<div style="display:none">隐藏</div>').elements('div')[0].hidden,true);
 assert.equal(new SourceIndex('<div style="visibility:hidden">隐藏</div>').elements('div')[0].hidden,true);
});

test('A13 audit 回归:表外真实实体不再让整个文本节点掉出映射(audit/parsing R9)',()=>{
 const idx=new SourceIndex('<p>keep &notin; drop</p>');
 const map=buildTextMap(idx);
 assert.deepEqual(map.unmappableNodes,[]);
 const p=map.containers.find(c=>c.tag==='p')!;
 assert.equal(p.logical,'keep ∉ drop');
 const idx2=new SourceIndex('<p>因此 &there4; 结论</p>');
 const map2=buildTextMap(idx2);
 assert.deepEqual(map2.unmappableNodes,[]);
 assert.equal(map2.containers.find(c=>c.tag==='p')?.logical,'因此 ∴ 结论');
});

test('A13 audit 回归:折叠空格映射不跨节点,替换不再吞掉内联元素(audit/parsing R10/R11)',()=>{
 const source='<p>a <img src=x> b</p>';
 const idx=new SourceIndex(source);
 const p=first(idx,'p');
 assert.equal(p.logical,'a b');
 const res=replaceLogical(idx,p,p.logical.indexOf(' '),p.logical.indexOf(' ')+1,'X');
 assert.ok(res.ok);
 if(res.ok){
  assert.ok(res.patch.expected.length<source.indexOf('b')-source.indexOf('a'),'折叠空格的替换区间不得跨越 <img>');
  assert.ok(!res.patch.expected.includes('<img'),'expected 中不得包含元素标记');
  const patched=source.slice(0,res.patch.start)+res.patch.replacement+source.slice(res.patch.end);
  assert.equal(new SourceIndex(patched).elements('img').length,1,'<img> 必须保留');
 }
});

test('A13 搜索辅助：字符级映射支撑重复文字分别定位',()=>{
 const source='<p>重复</p><p>重复</p>';
 const index=new SourceIndex(source);
 const map=buildTextMap(index);
 const hits:[number,number][]=[];
 map.containers.forEach((c,ci)=>{
  let at=c.logical.indexOf('重复');
  while(at>=0){hits.push([ci,at]);at=c.logical.indexOf('重复',at+1);}
 });
 assert.equal(hits.length,2);
 const [c1,o1]=hits[0];const [c2,o2]=hits[1];
 assert.notEqual(map.containers[c1].map[o1].nodeId,map.containers[c2].map[o2].nodeId);
});

test('A13 解码器独立行为：无效实体按字面处理，数值边界安全',()=>{
 const d=decodeRawWithMap('&#65;&#x42;&amp;&#x110000;&#;&#x; &amp');
 assert.equal(d.text,'AB&&#x110000;&#;&#x; &amp');
 assert.equal(d.text.length,d.map.length);
});

// 审计复检 §3.16/§3.18:childIds 此前只初始化、从不填充,一处空字段让大綱标题文字、
// <style> 内 CSS 重写、<picture> 检测三处功能同时失效。
test('A13 audit 回归:SourceIndex 填充 childIds(大纲/<style>/picture 共用)',()=>{
 const idx=new SourceIndex('<html><head><style>a{background:url(b.png)}</style></head><body><h1 id="t">标题文字</h1><picture><source srcset="x.png"><img src="y.png"></picture></body></html>');
 const h1=idx.elements('h1')[0];
 const h1Text=h1.childIds.length?idx.nodes[h1.childIds[0]]:null;
 assert.equal(h1Text?.kind,'text');
 assert.equal(h1Text&&h1Text.kind==='text'?h1Text.value:null,'标题文字');
 const style=idx.elements('style')[0];
 assert.ok(style.childIds.length>0,'<style> 必须登记文字子节点');
 assert.equal(idx.nodes[style.childIds[0]]?.kind,'text');
 const picture=idx.elements('picture')[0];
 const img=idx.elements('img')[0];
 assert.ok(picture.childIds.includes(img.id),'<picture> 的子节点里必须能找到 <img>');
});
