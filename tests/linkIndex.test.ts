import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SourceIndex} from '../src/parsing/sourceIndex';
import {backlinksFor,collectPageLinks,linkKeyOf,anchorRangesForKey,firstSegmentIds,anchorIndexesForKey} from '../src/services/linkIndex';
import type {ResolvedLink,LinkKind} from '../src/services/links';

// 出链/反链(2026-10-31)的纯函数回归。断言产品实现,不转写算法。

function link(kind:LinkKind,partial:Partial<ResolvedLink>):ResolvedLink{
 return {kind,raw:'',target:'',query:'',fragment:'',file:null,...partial};
}

test('backlinksFor:反演 resolvedLinks,只取指向目标的源并按路径排序',()=>{
 const resolved={
  'b.md':{'页面/page.html':2},
  'a.md':{'页面/page.html':1,'其他.html':3},
  'c.md':{'别的.md':1},
 };
 assert.deepEqual(backlinksFor(resolved,'页面/page.html'),[
  {source:'a.md',count:1},{source:'b.md',count:2},
 ]);
 assert.deepEqual(backlinksFor(resolved,'不存在.html'),[]);
 assert.deepEqual(backlinksFor({},'x'),[]);
});

test('collectPageLinks:库内/外链/未解析分类,锚点与空 href 不算出链',()=>{
 const src=`<html><body>
  <a href="notes/a.md">笔记A</a>
  <a href="./other.html">另一个页面</a>
  <a href="https://example.com/x">外链</a>
  <a href="mailto:a@b.c">邮件</a>
  <a href="#top">锚点</a>
  <a href="">空</a>
  <a>无href</a>
  <a href="missing.html">缺失</a>
 </body></html>`;
 const files=new Set(['notes/a.md','other.html']);
 const resolve=(raw:string):ResolvedLink=>{
  const target=raw.split('#')[0].replace(/^\.\//,'');
  if(raw.startsWith('#'))return link('anchor',{raw,fragment:raw});
  if(!raw)return link('empty',{raw});
  if(/^https?:/.test(raw))return link('http',{raw,target});
  if(/^mailto:/.test(raw))return link('mailto',{raw,target});
  if(files.has(target)){
   const ext=target.split('.').pop()!;
   return link(ext==='html'?'library-html':'markdown',{raw,target,file:{path:target,extension:ext} as ResolvedLink['file']});
  }
  return link('unsupported',{raw,target,reason:'not-found'});
 };
 const index=new SourceIndex(src);
 const out=collectPageLinks(index,resolve);
 assert.deepEqual(out.map(e=>[e.resolved.kind,e.text]),[
  ['markdown','笔记A'],['library-html','另一个页面'],['http','外链'],
  ['mailto','邮件'],['unsupported','缺失'],
 ]);
 // 未解析项:点击语义是定位源码,offset 必须落在 missing.html 的 href 值上
 const broken=out.find(e=>e.resolved.kind==='unsupported')!;
 assert.ok(src.slice(broken.offset,broken.offset+'missing.html'.length)==='missing.html');
});

test('collectPageLinks:同目标去重合并计数,不同 fragment 各自成条',()=>{
 const src=`<html><body>
  <a href="other.html">一次</a>
  <a href="./other.html">两次</a>
  <a href="other.html#sec">带锚点</a>
 </body></html>`;
 const resolve=(raw:string):ResolvedLink=>{
  const [target,frag='']=raw.split('#');
  return link('library-html',{raw,target,fragment:frag?`#${frag}`:'',
   file:{path:'other.html',extension:'html'} as ResolvedLink['file']});
 };
 const out=collectPageLinks(new SourceIndex(src),resolve);
 assert.equal(out.length,2);
 assert.equal(out[0].count,2);
 assert.equal(out[0].text,'一次');       // 去重保留首次出现
 assert.equal(out[1].resolved.fragment,'#sec');
});

test('collectPageLinks:嵌套内联的锚点文字也能取到(按区间收文本节点)',()=>{
 const src=`<html><body><a href="n.md"><em>斜体</em>与<b>粗体</b></a></body></html>`;
 const resolve=(raw:string):ResolvedLink=>
  link('markdown',{raw,target:raw,file:{path:raw,extension:'md'} as ResolvedLink['file']});
 const out=collectPageLinks(new SourceIndex(src),resolve);
 assert.equal(out.length,1);
 assert.equal(out[0].text,'斜体与粗体');
});

test('collectPageLinks:非 not-found 的 unsupported(javascript: 等)不算出链',()=>{
 const src=`<html><body><a href="javascript:void(0)">脚本</a></body></html>`;
 const resolve=(raw:string):ResolvedLink=>link('unsupported',{raw,reason:'unsupported-protocol'});
 assert.deepEqual(collectPageLinks(new SourceIndex(src),resolve),[]);
});

test('collectPageLinks/linkKeyOf:不同 raw 并入同一目标 key,重复条目只留首条',()=>{
 const src=`<html><body>
  <a href="other.html">一</a>
  <a href="other.html">二</a>
  <a href="./other.html">三(不同 raw,并入同一目标)</a>
 </body></html>`;
 const resolve=(raw:string):ResolvedLink=>{
  const target=raw.replace(/^\.\//,'');
  return link('library-html',{raw,target,file:{path:target,extension:'html'} as ResolvedLink['file']});
 };
 const out=collectPageLinks(new SourceIndex(src),resolve);
 assert.equal(out.length,1);
 assert.equal(out[0].count,3);
 assert.equal(out[0].text,'一');
 assert.deepEqual(out[0].texts,['一','二','三(不同 raw,并入同一目标)']);   // 各次文字都收,供"等 N 处"提示
 // key 是"路径+query+fragment 带分隔符"的内部尺子,不是路径字面量
 assert.equal(linkKeyOf(out[0].resolved),'other.html\u0000\u0000');
});

test('anchorRangesForKey:重扫当前源码收集同目标全部锚点(文档顺序,变化后仍正确)',()=>{
 const resolve=(raw:string):ResolvedLink=>{
  const [target,frag='']=raw.split('#');
  return link('library-html',{raw,target,fragment:frag?`#${frag}`:'',
   file:{path:target,extension:'html'} as ResolvedLink['file']});
 };
 const src=`<html><body><a href="a.html">A</a><a href="a.html">B</a><a href="a.html#sec">C</a><a href="b.html">D</a></body></html>`;
 // key 统一经 linkKeyOf 构造(与产品代码同一把尺子,不写死字面量)
 const keyOf=(raw:string)=>linkKeyOf(resolve(raw));
 const ranges=anchorRangesForKey(new SourceIndex(src),resolve,keyOf('a.html'));
 assert.equal(ranges.length,2);                       // #sec 是另一把 key,不算
 assert.ok(src.slice(ranges[0].start,ranges[0].end).includes('>A<'));
 assert.ok(src.slice(ranges[1].start,ranges[1].end).includes('>B<'));
 assert.deepEqual(anchorRangesForKey(new SourceIndex(src),resolve,keyOf('missing.html')),[]);
 // 渲染后锚点前插入了文字:重扫得到的是新偏移,而不是过期快照
 const edited=`<html><body><p>前面加了一段文字</p><a href="a.html">A</a><a href="a.html">B</a></body></html>`;
 const ranges2=anchorRangesForKey(new SourceIndex(edited),resolve,keyOf('a.html'));
 assert.equal(ranges2.length,2);
 assert.ok(edited.slice(ranges2[1].start,ranges2[1].end).includes('>B<'));
});

test('collectPageLinks:template/svg 等排除区里的 <a> 不算出链(审计 round1)',()=>{
 const src=`<html><body>
  <template><a href="tpl.html">模板链接</a></template>
  <svg><a href="svg.html"><text>svg链接</text></a></svg>
  <a href="visible.html">可见链接</a>
 </body></html>`;
 const resolve=(raw:string):ResolvedLink=>
  link('library-html',{raw,target:raw,file:{path:raw,extension:'html'} as ResolvedLink['file']});
 const out=collectPageLinks(new SourceIndex(src),resolve);
 assert.deepEqual(out.map(e=>e.text),['可见链接']);
 // 定位重扫同样不收:两把口径必须同一把尺子
 const index=new SourceIndex(src);
 for(const e of out)assert.equal(anchorRangesForKey(index,resolve,linkKeyOf(e.resolved)).length,1);
 assert.deepEqual(anchorRangesForKey(index,resolve,linkKeyOf(link('library-html',{target:'tpl.html',file:{path:'tpl.html',extension:'html'} as ResolvedLink['file']}))),[]);
});

test('linkKeyOf:三段带分隔符,"含 # 的文件名"不再与"目标+fragment"碰撞;fragment 按解码归一(审计 round1)',()=>{
 // href="a%23b.md"(目标就是名为 a#b.md 的文件)与 href="a#b.md"(目标 a + 锚点 b.md)
 const hashFile=link('library-html',{file:{path:'a#b.md',extension:'md'} as ResolvedLink['file']});
 const withFragment=link('unsupported',{target:'a',fragment:'#b.md',reason:'not-found'});
 assert.notEqual(linkKeyOf(hashFile),linkKeyOf(withFragment));
 // 同一跳转目标的两种 fragment 拼写必须合并成一条
 const cn=link('library-html',{fragment:'#中',file:{path:'x.html',extension:'html'} as ResolvedLink['file']});
 const encoded=link('library-html',{fragment:'#%E4%B8%AD',file:{path:'x.html',extension:'html'} as ResolvedLink['file']});
 assert.equal(linkKeyOf(cn),linkKeyOf(encoded));
});

test('firstSegmentIds:图片锚点 null,多文字段锚点取第一个完整落在区间内的段(审计 round1)',()=>{
 // 区间 0 是图片链接(无文字段);区间 1 含两个文字段,且有一个跨出区间的段不能收
 const ranges=[{start:0,end:20},{start:20,end:60}];
 const segments=[
  {id:'img',start:1,end:6,text:''},          // 图片锚点,无文字
  {id:'bad',start:19,end:25,text:'跨界'},     // 起点在区间外
  {id:'s1',start:22,end:30,text:'斜体'},
  {id:'s2',start:30,end:40,text:'正文'},
 ];
 assert.deepEqual(firstSegmentIds(ranges,segments),[null,'s1']);
 assert.deepEqual(firstSegmentIds([],segments),[]);
});

test('anchorIndexesForKey:预览侧按 DOM 顺序取同目标第 N 次出现,与源码侧同一把过滤尺',()=>{
 // 模拟预览文档里 a[href] 的属性值序列(文档序):混合干扰项与两种同目标写法
 const hrefs=['x.html','#frag','y.html','./x.html','javascript:void(0)','x.html','z.html'];
 const resolve=(raw:string):ResolvedLink=>{
  if(raw.startsWith('#'))return link('anchor',{raw,fragment:raw});
  if(!raw)return link('empty',{raw});
  if(raw.startsWith('javascript:'))return link('unsupported',{raw,reason:'unsupported-protocol'});
  const target=raw.replace(/^\.\//,'');
  if(['x.html','y.html'].includes(target))return link('library-html',{raw,target,file:{path:target,extension:'html'} as ResolvedLink['file']});
  return link('unsupported',{raw,target,reason:'not-found'});
 };
 const keyOfX=linkKeyOf(resolve('x.html'));
 assert.equal(anchorIndexesForKey(hrefs,resolve,keyOfX,0),0);   // 第一处 x.html
 assert.equal(anchorIndexesForKey(hrefs,resolve,keyOfX,1),3);   // ./x.html 并入同目标
 assert.equal(anchorIndexesForKey(hrefs,resolve,keyOfX,2),5);
 assert.equal(anchorIndexesForKey(hrefs,resolve,keyOfX,3),0);   // 越界回卷
 assert.equal(anchorIndexesForKey(hrefs,resolve,keyOfX,99),0);
 assert.equal(anchorIndexesForKey(hrefs,resolve,linkKeyOf(resolve('y.html')),0),2);
 // 未解析目标也算出现(出链清单含"未解析"类);序列里完全不存在的目标才是 -1
 assert.equal(anchorIndexesForKey(hrefs,resolve,linkKeyOf(resolve('z.html')),0),6);
 assert.equal(anchorIndexesForKey(hrefs,resolve,linkKeyOf(resolve('w.html')),0),-1);
});

test('不变量:每个清单条目的 count 恒等于定位重扫得到的同 key 锚点数(含不同写法/未解析)',()=>{
 const src=`<html><body>
  <a href="other.html">一</a>
  <a href="./other.html">二</a>
  <a href="other.html#sec">三</a>
  <a href="missing.html">缺一</a>
  <a href="missing.html">缺二</a>
  <a href="https://e.example/x">外链</a>
 </body></html>`;
 const resolve=(raw:string):ResolvedLink=>{
  const [before,frag='']=raw.split('#');
  const target=before.replace(/^\.\//,'');
  if(/^https?:/.test(raw))return link('http',{raw,target});
  if(['other.html'].includes(target))return link('library-html',{raw,target,fragment:frag?`#${frag}`:'',
   file:{path:target,extension:'html'} as ResolvedLink['file']});
  return link('unsupported',{raw,target,reason:'not-found'});
 };
 const index=new SourceIndex(src);
 const out=collectPageLinks(index,resolve);
 assert.equal(out.length,4);
 for(const e of out){
  assert.equal(e.count,anchorRangesForKey(index,resolve,linkKeyOf(e.resolved)).length,`key=${linkKeyOf(e.resolved)}`);
 }
});
