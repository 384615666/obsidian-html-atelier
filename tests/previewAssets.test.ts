import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDataUrlFor,createInlineBudget,inlineLocalPreviewAssets,PreviewInlineIO} from '../src/services/previewAssets';

// 脚本模式资源内联回归(2026-10-26 真机定因):不透明源沙箱(sandbox="allow-scripts",
// 无 allow-same-origin)里 app:// 图片/脚本一律加载失败,必须转成 data: URL。
// 这些用例锁住"哪些引用该换、哪些必须原样保留"的边界。

type FileMap=Record<string,string|Uint8Array>;

function ioOf(files:FileMap):PreviewInlineIO{
 const asBuffer=(v:string|Uint8Array):ArrayBuffer=>typeof v==='string'
  ?new TextEncoder().encode(v).buffer as ArrayBuffer
  :v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength) as ArrayBuffer;
 return {
  readCss:async p=>typeof files[p]==='string'?files[p] as string:null,
  readText:async p=>typeof files[p]==='string'?files[p] as string:null,
  readBinary:async p=>p in files?asBuffer(files[p]):null,
  resourceUrl:p=>p in files?`app://hash/${p}`:null,
 };
}

const png=new Uint8Array([137,80,78,71,13,10,26,10]);

test('脚本模式:本地图片转 data: URL,远程/缺失引用保持原样',async()=>{
 const io=ioOf({'页面/pic.png':png});
 const src='<body><img id="a" src="pic.png"><img id="r" src="https://x.example/a.png"><img id="m" src="missing.png"></body>';
 const out=await inlineLocalPreviewAssets(src,'页面/x.html',io,createInlineBudget());
 const doc=new JSDOM(out).window.document;
 assert.match(doc.querySelector('#a')!.getAttribute('src')!,
  /^data:image\/png;base64,/,'本地图片必须内联');
 assert.equal(doc.querySelector('#r')!.getAttribute('src'),'https://x.example/a.png','远程图片不动');
 assert.equal(doc.querySelector('#m')!.getAttribute('src'),'missing.png','读不到的文件保留原引用');
});

test('脚本模式:srcset 逐候选替换且描述符逐字节保留',async()=>{
 const io=ioOf({'页面/a.png':png,'页面/b.png':png});
 const src='<body><img srcset="a.png 1x, b.png 2x, https://x.example/c.png 3x"></body>';
 const out=await inlineLocalPreviewAssets(src,'页面/x.html',io,createInlineBudget());
 const value=new JSDOM(out).window.document.querySelector('img')!.getAttribute('srcset')!;
 assert.match(value,/^data:image\/png;base64,[^ ]+ 1x, data:image\/png;base64,[^ ]+ 2x, https:\/\/x\.example\/c\.png 3x$/);
});

test('脚本模式:本地 <script src> 转 data: URL,保留 defer、移除 SRI/crossorigin',async()=>{
 const io=ioOf({'页面/app.js':'window.__probe=42;'});
 const src='<head><script src="app.js" defer integrity="sha256-x" crossorigin="anonymous"></script></head>';
 const out=await inlineLocalPreviewAssets(src,'页面/x.html',io,createInlineBudget());
 const el=new JSDOM(out).window.document.querySelector('script')!;
 const url=el.getAttribute('src')!;
 assert.match(url,/^data:text\/javascript;charset=utf-8;base64,/);
 assert.equal(Buffer.from(url.split('base64,')[1],'base64').toString('utf8'),'window.__probe=42;');
 assert.equal(el.hasAttribute('defer'),true,'defer 必须保留(data: 仍是外部脚本)');
 assert.equal(el.hasAttribute('integrity'),false);
 assert.equal(el.hasAttribute('crossorigin'),false);
});

test('脚本模式:非 JS 的 script 数据块与远程脚本不内联',async()=>{
 const io=ioOf({'页面/data.json':'{"a":1}'});
 const src='<body><script type="application/json" src="data.json"></script><script src="https://cdn.example/x.js"></script></body>';
 const out=await inlineLocalPreviewAssets(src,'页面/x.html',io,createInlineBudget());
 const doc=new JSDOM(out).window.document;
 const scripts=[...doc.querySelectorAll('script')];
 assert.equal(scripts[0].getAttribute('src'),'data.json','JSON 数据块不是脚本,保持原样');
 assert.equal(scripts[1].getAttribute('src'),'https://cdn.example/x.js');
});

test('脚本模式:style 属性里的本地 url() 转 data:,字符串字面量不碰',async()=>{
 const io=ioOf({'页面/pic.png':png});
 const src='<body><div id="a" style="background:url(pic.png)"></div><div id="b" style="content:\'url(pic.png)\'"></div></body>';
 const out=await inlineLocalPreviewAssets(src,'页面/x.html',io,createInlineBudget());
 const doc=new JSDOM(out).window.document;
 assert.match(doc.querySelector('#a')!.getAttribute('style')!,/url\("data:image\/png;base64,/);
 assert.match(doc.querySelector('#b')!.getAttribute('style')!,/url\(pic\.png\)/,'字符串里的 url() 不得改写');
});

test('脚本模式:超过单文件上限的资源不内联(避免把 srcdoc 撑爆)',async()=>{
 const big=new Uint8Array(9*1024*1024);
 const io=ioOf({'页面/big.png':big});
 const src='<body><img src="big.png"></body>';
 const out=await inlineLocalPreviewAssets(src,'页面/x.html',io,createInlineBudget());
 assert.equal(new JSDOM(out).window.document.querySelector('img')!.getAttribute('src'),'big.png');
});

test('脚本模式:隐藏目录/非资源扩展名不内联(防止页面借 src 读取库内文本)',async()=>{
 const io=ioOf({
  '页面/secret.txt':'TOP SECRET',
  '页面/note.md':'secret',
  '.obsidian/pic.png':png,
  '.obsidian/hook.js':'window.__leak=1;',
 });
 const src=[
  '<body>',
  '<img id="txt" src="secret.txt">',
  '<img id="hidden" src="../.obsidian/pic.png">',
  '<script id="s" src="secret.txt"></script>',
  '<script id="js" src="../.obsidian/hook.js"></script>',
  '<script id="md" src="note.md"></script>',
  '</body>',
 ].join('');
 const out=await inlineLocalPreviewAssets(src,'页面/x.html',io,createInlineBudget());
 const doc=new JSDOM(out).window.document;
 assert.equal(doc.querySelector('#txt')!.getAttribute('src'),'secret.txt','未知类型不内联');
 assert.equal(doc.querySelector('#hidden')!.getAttribute('src'),'../.obsidian/pic.png','隐藏目录不内联');
 assert.equal(doc.querySelector('#s')!.getAttribute('src'),'secret.txt','非 .js 脚本不内联');
 assert.equal(doc.querySelector('#js')!.getAttribute('src'),'../.obsidian/hook.js','隐藏目录里的脚本不内联');
 assert.equal(doc.querySelector('#md')!.getAttribute('src'),'note.md','Markdown 不能被当脚本内联');
});

test('dataUrlFor 缓存:同一文件多处引用只读一次、只记一次预算',async()=>{
 let reads=0;
 const io:PreviewInlineIO={
  readCss:async()=>null,
  readText:async()=>null,
  readBinary:async()=>{reads++;return png.buffer.slice(0) as ArrayBuffer;},
  resourceUrl:()=>null,
 };
 const budget=createInlineBudget();
 const url=createDataUrlFor(io,budget);
 const [a,b]=await Promise.all([url('a.png'),url('a.png')]);
 assert.equal(reads,1);
 assert.equal(a,b);
 assert.equal(budget.used,png.byteLength);
});
