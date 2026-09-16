import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyRef,escapesVaultRoot,isNetworkRef,resolveVaultRef,srcsetUrls,stripQuery} from '../src/parsing/url';
import {planSaveAs} from '../src/services/saveAsPlan';
import {collectResourcesWithBase,pageReferences,isPageDependency,cssUrls} from '../src/services/assets';
import {SourceIndex} from '../src/parsing/sourceIndex';
import {planSrcsetRemoval} from '../src/parsing/patchPlan';
import {parseEmbedParams} from '../src/embed/params';
import {utf8Bytes} from '../src/core/bytes';
import {runRegexpSearch} from '../src/services/regexp/regexpCore';

// round4 第四批"引用解析统一"的回归测试。全部断言产品代码,不转写算法。

test('引用分类:协议相对/库根/绝对/相对互不混淆',()=>{
 assert.equal(classifyRef(''),'empty');
 assert.equal(classifyRef('#a'),'anchor');
 assert.equal(classifyRef('//cdn/x.png'),'protocol-relative');
 assert.equal(classifyRef('/assets/x.png'),'vault-root');
 assert.equal(classifyRef('HTTPS://X/Y'),'absolute');
 assert.equal(classifyRef('a/b.png'),'relative');
 assert.equal(isNetworkRef('//cdn/x.png'),true);
 assert.equal(isNetworkRef('/assets/x.png'),false);
 assert.equal(isNetworkRef('a/b.png'),false);
 assert.equal(stripQuery('a.png?v=1#f'),'a.png');
});

test('库内引用解析:根引用从库根,相对引用从页面目录',()=>{
 assert.equal(resolveVaultRef('demo/pages','/x/y.png'),'x/y.png');
 assert.equal(resolveVaultRef('demo/pages','x/y.png'),'demo/pages/x/y.png');
 assert.equal(resolveVaultRef('demo/pages','/x/y.png?a=1'),'x/y.png');
 assert.equal(escapesVaultRoot('pages','../a.png'),false);
 assert.equal(escapesVaultRoot('','../a.png'),true);
});

test('srcset 候选切分:按 HTML 规范(URL 读到空白、逗号在描述符区才是分隔符)',()=>{
 // 报告 5 N2 之前这里是"逗号+空白"判定,会在四种形态上与浏览器不一致。
 // 用例与 audit/round5/probe-srcset-spec.mts 的规范参考逐一对应。
 assert.deepEqual(srcsetUrls('a.png 1x, b.png 2x'),['a.png','b.png']);
 assert.deepEqual(srcsetUrls('a.png 1x,b.png 2x'),['a.png','b.png'],'无空格分隔符');
 assert.deepEqual(srcsetUrls('a.png 1x ,b.png 2x'),['a.png','b.png']);
 assert.deepEqual(srcsetUrls('  a.png   1x  ,   b.png  2x  '),['a.png','b.png']);
 assert.deepEqual(srcsetUrls('a.png 1x, b.png 2x , c.png 3x'),['a.png','b.png','c.png']);
 // URL 内部允许逗号(URL 读到空白为止)
 assert.deepEqual(srcsetUrls('a,b.png 1x'),['a,b.png']);
 assert.deepEqual(srcsetUrls('a,b.png 1x, c,d.png 2x'),['a,b.png','c,d.png']);
 assert.deepEqual(srcsetUrls('a.png,,b.png 2x'),['a.png,,b.png']);
 assert.deepEqual(srcsetUrls('data:image/png;base64,AA 1x'),['data:image/png;base64,AA']);
 // 末尾逗号:规范在此结束解析。浏览器实测 srcset="a.png, b.png" 只加载 a.png
 assert.deepEqual(srcsetUrls('a.png,'),['a.png']);
 assert.deepEqual(srcsetUrls('a.png, b.png'),['a.png']);
 // 前导逗号不是 URL 的一部分
 assert.deepEqual(srcsetUrls(',a.png 1x'),['a.png']);
 assert.deepEqual(srcsetUrls('a.png 1x, b.png 2x,'),['a.png','b.png']);
 assert.deepEqual(srcsetUrls(''),[]);
});

test('F14 另存为:srcset 无空格分隔符的候选也要重写(与依赖图共用同一套切分)',()=>{
 const p=planSaveAs('<img srcset="a.png 1x,b.png 2x">','demo/pages/a.html','demo/notes',true);
 assert.equal(p.content,'<img srcset="../pages/a.png 1x,../pages/b.png 2x">');
 // 末尾逗号之后的候选浏览器不会加载,保持原样(内容除已改写的候选外逐字节不变)
 const q=planSaveAs('<img srcset="a.png, b.png">','demo/pages/a.html','demo/notes',true);
 assert.equal(q.content,'<img srcset="../pages/a.png, b.png">');
});

test('F14 另存为:目录型引用的尾部 / 必须保留(BUG 13)',()=>{
 assert.equal(planSaveAs('<a href="sub/">x</a>','demo/pages/a.html','demo/notes',true).content,
  '<a href="../pages/sub/">x</a>');
 assert.equal(planSaveAs('<div style="background:url(img/)">x</div>','demo/pages/a.html','demo/notes',true).content,
  '<div style="background:url(../pages/img/)">x</div>');
 // 同目录不重写(早退)
 assert.equal(planSaveAs('<a href="sub/">x</a>','demo/pages/a.html','demo/pages',true).content,'<a href="sub/">x</a>');
});

test('F14 另存为:引用的首尾空白会被浏览器剥离,重写不得把它变成值内空格(BUG 29)',()=>{
 const p=planSaveAs('<img src=" x.png">','demo/pages/a.html','demo/notes',true);
 assert.equal(p.content,'<img src="../pages/x.png">');
});

test('F14 另存为:文档自身的 <base href> 决定解析基准(BUG 14)',()=>{
 // 本地 base:只把 base 搬到新位置,其余相对引用原样保留
 const local=planSaveAs('<html><head><base href="assets/"></head><body><img src="pic.png"></body></html>',
  'demo/pages/a.html','demo/notes',true);
 assert.equal(local.content,'<html><head><base href="../pages/assets/"></head><body><img src="pic.png"></body></html>');
 // 远程 base:相对引用整体站外,不重写且不产生"未重写"噪音
 const remote=planSaveAs('<html><head><base href="https://cdn.example.com/x/"></head><body><img src="pic.png"></body></html>',
  'demo/a.html','top',true);
 assert.equal(remote.content,'<html><head><base href="https://cdn.example.com/x/"></head><body><img src="pic.png"></body></html>');
 assert.deepEqual(remote.unresolved,[]);
});

test('F14 另存为:越出库根的引用进"未重写"清单,不写被截断的近似路径',()=>{
 const p=planSaveAs('<img src="../../a.png">','pages/a.html','top',true);
 assert.equal(p.content,'<img src="../../a.png">');
 assert.deepEqual(p.unresolved,['../../a.png']);
 // 只有 query/fragment 的自引用位置无关:保持原样且不算未重写
 const q=planSaveAs('<a href="?x=1">x</a>','pages/a.html','top',true);
 assert.equal(q.content,'<a href="?x=1">x</a>');
 assert.deepEqual(q.unresolved,[]);
});

test('F17 资源清单:库根引用不被页面目录覆盖(BUG 15),协议相对属站外(BUG 26)',()=>{
 const index=new SourceIndex('<img src="/assets/logo.png"><img src="assets/logo.png">');
 const vault=new Set(['assets/logo.png','demo/assets/logo.png']);
 const rows=collectResourcesWithBase(index,'demo/p.html',p=>vault.has(p),true).map(r=>[r.raw,r.resolved,r.status]);
 assert.deepEqual(rows,[
  ['/assets/logo.png','assets/logo.png','local-ok'],
  ['assets/logo.png','demo/assets/logo.png','local-ok'],
 ]);
 const net=new SourceIndex('<img src="//cdn.example.com/x.png">');
 assert.deepEqual(collectResourcesWithBase(net,'demo/p.html',()=>true,false).map(r=>[r.local,r.status]),[[false,'blocked']]);
 assert.deepEqual(collectResourcesWithBase(net,'demo/p.html',()=>true,true).map(r=>r.status),['remote']);
});

test('F17 依赖图:大写 .CSS 与含逗号的 srcset(BUG 16/27)',async()=>{
 const disk=new Map<string,string>([['demo/A.CSS','@import "b.css";'],['demo/b.css','x{}']]);
 const read=async(p:string)=>disk.get(p)??null;
 assert.equal(await isPageDependency('demo/A.CSS','<link rel="stylesheet" href="A.CSS">','demo/p.html',read),true);
 assert.equal(await isPageDependency('demo/b.css','<link rel="stylesheet" href="A.CSS">','demo/p.html',read),true);
 const page='<img srcset="photo,small.png 1x">';
 assert.deepEqual(pageReferences(new SourceIndex(page),'demo'),['demo/photo,small.png']);
 assert.equal(await isPageDependency('demo/photo,small.png',page,'demo/p.html',read),true);
 assert.deepEqual(pageReferences(new SourceIndex('<img src="/assets/x.png">'),'demo'),['assets/x.png']);
});

test('F17 CSS url()/@import 大小写不敏感(BUG 22)',()=>{
 assert.deepEqual(cssUrls('body{background:url(bg.png)}'),['bg.png']);
 assert.deepEqual(cssUrls('body{background:URL(bg.png)}'),['bg.png']);
 assert.deepEqual(cssUrls('@import URL(d.css);'),['d.css']);
 assert.deepEqual(cssUrls("@IMPORT 'e.css';"),['e.css']);
});

test('F15 srcset 删除区间不破坏元素(BUG 12)',()=>{
 for(const img of ['<img src="a.png" srcset="a 1x, b 2x">','<img srcset="a 1x"alt="x">','<img alt="x"srcset="a 1x">']){
  const src=`<html><body>${img}</body></html>`;
  const el=new SourceIndex(src).elements('img')[0];
  const attr=el.attrs.find(a=>a.name==='srcset')!;
  const patch=planSrcsetRemoval(src,attr);
  assert.ok(patch,`未能规划删除:${img}`);
  const out=src.slice(0,patch!.start)+src.slice(patch!.end);
  const after=new SourceIndex(out).elements('img')[0];
  assert.ok(after,`元素被破坏:${out}`);
  assert.equal(after.attrs.some(a=>a.name==='srcset'),false,`srcset 仍在:${out}`);
 }
});

test('源索引:重复属性暴露的区间指向第一次出现(BUG 17)',()=>{
 const src='<img alt="ONE" alt="TWO" src="s.png">';
 const el=new SourceIndex(src).elements('img')[0];
 const alt=el.attrs.find(a=>a.name==='alt')!;
 assert.equal(alt.value,'ONE');
 assert.equal(src.slice(alt.valueStart,alt.valueEnd),'ONE');
});

test('F21 嵌入参数:只接受十进制整数,引号与首尾空白剥离(BUG 24/25)',()=>{
 assert.equal(parseEmbedParams('path: a.html\nheight: 0x100').params?.height,'auto');
 assert.equal(parseEmbedParams('path: a.html\nheight: 1e2').params?.height,'auto');
 assert.equal(parseEmbedParams('path: a.html\nheight: 500').params?.height,500);
 assert.equal(parseEmbedParams('path: " demo/a.html "').params?.path,'demo/a.html');
 assert.equal(parseEmbedParams("path: ' demo/a.html '").params?.path,'demo/a.html');
 assert.equal(parseEmbedParams('path:   demo/a.html  ').params?.path,'demo/a.html');
 // 契约细节(报告 5 的审计者在 §3/§6 撤回了他们自己发明的三条期望):
 //  - 带符号的十进制是允许的(源码正则 ^[+-]?\d+$),按边界收敛
 assert.equal(parseEmbedParams('path: a.html\nheight: -5').params?.height,160);
 assert.equal(parseEmbedParams('path: a.html\nheight: +200').params?.height,200);
 //  - 空值的行不是"未知值"而是**缺值**:整行不匹配 key: value,按未知参数报错(比静默默认更诚实)
 const empty=parseEmbedParams('path: a.html\nheight:');
 assert.equal(empty.params,null);
 assert.ok(empty.error&&empty.error.includes('height'),`空值行应报错: ${JSON.stringify(empty.error)}`);
 //  - 小数不是整数
 assert.equal(parseEmbedParams('path: a.html\nheight: 12.5').params?.height,'auto');
});

test('UTF-8 字节计数按实际占用而非字符数',()=>{
 assert.equal(utf8Bytes('abc'),3);
 assert.equal(utf8Bytes('中'),3);
 assert.equal(utf8Bytes('😀'),4);
 assert.equal(utf8Bytes('a中'),4);
});

test('A17 正则:恰好用满上限不算截断(BUG 30)',()=>{
 assert.equal(runRegexpSearch('aaa','a','g',3,10000).truncated,false);
 assert.equal(runRegexpSearch('aaaa','a','g',3,10000).truncated,true);
 assert.equal(runRegexpSearch('aaaa','a','g',4,10000).truncated,false);
 // 零长匹配的边界同样要探测:abc 上 x* 有 4 个命中(0/1/2/3)
 assert.equal(runRegexpSearch('abc','x*','g',4,10000).truncated,false);
 assert.equal(runRegexpSearch('abc','x*','g',3,10000).truncated,true);
});
