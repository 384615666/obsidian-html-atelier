import {parse,serialize} from 'parse5';
import {classifyRef,dirOf,resolveVaultRef,srcsetCandidates,stripQuery} from '../parsing/url';
import {CssInlineIO,rewriteCssUrls} from './cssInline';

// 脚本模式(preview.allowScripts)的预览资源内联(2026-10-26 真机定因)。
// 帧是 sandbox="allow-scripts"(没有 allow-same-origin)的不透明源沙箱:
// app:// 资源一律加载失败——图片触发 onerror,外链脚本不执行,<script src> 的
// onload 也不来;而 http(s) 与 data: 正常。于是生成 srcdoc 前把页面静态引用的
// 库内资源转成 data: URL(只进预览,绝不写回源文件):
// - <script src> → data:text/javascript;...;base64。保持"外部脚本"身份,defer/async
//   语义不变(data: URL 仍是外部脚本);integrity/crossorigin 对 data: 无意义,移除。
// - img/source/video/audio/track/input 的 src、video poster、SVG <image href>、图标 link;
// - srcset 逐候选替换(与依赖图共用 srcsetCandidates,描述符逐字节保留);
// - style 属性里的 url() 复用 cssInline 的词法切分与 dataUrlFor;样式表本身已内联。
// 远程引用不动,仍由 CSP 与 allowNetwork 设置裁决。读取失败或超过上限的资源保持原样
// (脚本模式里本来就加载不了,不会比不处理更差)。页面运行时动态创建的本地资源不在
// 静态扫描范围内,这是本模式的已知边界。

interface P5Node {
 nodeName:string;tagName?:string;value?:string;
 namespaceURI?:string;
 attrs?:{name:string;value:string}[];
 childNodes?:P5Node[];
 parentNode?:P5Node|null;
}

export interface PreviewInlineIO extends CssInlineIO {
 // 读库内文本(脚本);失败返回 null
 readText(path:string):Promise<string|null>;
 // 读库内二进制(图片/字体/媒体);失败返回 null
 readBinary(path:string):Promise<ArrayBuffer|null>;
}

export interface InlineBudget {total:number; used:number}

// 单次预览的资源预算。超过后剩余引用保持原样,避免一个巨大的视频把 srcdoc
// 撑到无法解析的内存规模;常见页面(几十张图 + 几个脚本)远低于此。
export const createInlineBudget=(total=32*1024*1024):InlineBudget=>({total,used:0});

const MAX_BINARY=8*1024*1024;
const MAX_SCRIPT=4*1024*1024;

const MIME:Record<string,string>={
 png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',
 avif:'image/avif',svg:'image/svg+xml',bmp:'image/bmp',ico:'image/x-icon',cur:'image/x-icon',
 woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',eot:'application/vnd.ms-fontobject',
 mp4:'video/mp4',webm:'video/webm',ogv:'video/ogg',mov:'video/quicktime',m4v:'video/x-m4v',
 mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',m4a:'audio/mp4',flac:'audio/flac',aac:'audio/aac',
};

function extOf(path:string):string{
 const name=path.split('/').pop()??'';
 const dot=name.lastIndexOf('.');
 return dot<0?'':name.slice(dot+1).toLowerCase();
}

// 分块 btoa:大文件一次 String.fromCharCode(...bytes) 会超过引擎的实参上限。
function base64Of(bytes:Uint8Array):string{
 let out='';
 const CHUNK=0x8000;
 for(let i=0;i<bytes.length;i+=CHUNK)out+=btoa(String.fromCharCode(...bytes.subarray(i,i+CHUNK)));
 return out;
}

export function dataUrlOf(path:string,bytes:ArrayBuffer):string|null{
 const mime=MIME[extOf(path)];
 if(!mime)return null; // 未知类型不做 base64 内联:页面脚本能读到 src 里的完整内容
 return `data:${mime};base64,${base64Of(new Uint8Array(bytes))}`;
}

function scriptDataUrl(text:string):string{
 return `data:text/javascript;charset=utf-8;base64,${base64Of(new TextEncoder().encode(text))}`;
}

// dataUrlFor 带缓存:同一文件被 src/srcset/style 多处引用时只读一次、只记一次预算。
export function createDataUrlFor(io:PreviewInlineIO,budget:InlineBudget):(path:string)=>Promise<string|null>{
 const cache=new Map<string,Promise<string|null>>();
 return path=>{
  const hit=cache.get(path);
  if(hit)return hit;
  const p=(async()=>{
   if(!MIME[extOf(path)])return null;
   let bytes:ArrayBuffer|null=null;
   try{bytes=await io.readBinary(path);}catch{bytes=null;}
   if(!bytes||bytes.byteLength>MAX_BINARY||budget.used+bytes.byteLength>budget.total)return null;
   budget.used+=bytes.byteLength;
   return dataUrlOf(path,bytes);
  })();
  cache.set(path,p);
  return p;
 };
}

function localPath(ref:string,pageDir:string):string|null{
 const kind=classifyRef(ref);
 if(kind!=='relative'&&kind!=='vault-root')return null;
 const clean=stripQuery(ref).trim();
 if(!clean)return null;
 const path=resolveVaultRef(pageDir,clean);
 // 隐藏目录不放进来:脚本模式会把内联内容写进预览,页面脚本读得到 src/style;
 // .obsidian(插件数据)、.git 等配置/凭据不应因为一个 HTML 的引用就暴露
 if(path.split('/').some(s=>s.startsWith('.')))return null;
 return path;
}

function attr(n:P5Node,name:string):{name:string;value:string}|undefined{
 return n.attrs?.find(a=>a.name===name);
}

const SRC_TAGS=new Set(['img','source','video','audio','track','input']);
const JS_TYPES=new Set(['','module','text/javascript','application/javascript','text/ecmascript',
 'application/ecmascript','application/x-javascript','text/jscript','text/livescript']);

function isIconLink(n:P5Node):boolean{
 const rel=(attr(n,'rel')?.value??'').trim().toLowerCase().split(/\s+/);
 return rel.some(r=>r==='icon'||r==='shortcut'||r==='apple-touch-icon'||r==='mask-icon');
}

async function inlineScript(n:P5Node,pageDir:string,io:PreviewInlineIO,budget:InlineBudget):Promise<void>{
 const attrs=n.attrs;
 if(!attrs)return;
 const src=attrs.find(a=>a.name==='src');
 if(!src?.value)return;
 const type=(attrs.find(a=>a.name==='type')?.value??'').trim().toLowerCase();
 if(!JS_TYPES.has(type))return; // JSON/模板等数据块不是脚本,保持原样
 const path=localPath(src.value,pageDir);
 if(!path)return;
 // 只内联真正的 JS 文件:页面可以把任意库内文本当 <script src> 引用,
 // 内联后其内容会以 base64 出现在 src 里,页面脚本可直接读取
 if(!/\.(?:js|mjs|cjs)$/i.test(path))return;
 let text:string|null=null;
 try{text=await io.readText(path);}catch{text=null;}
 if(text===null)return;
 const bytes=new TextEncoder().encode(text);
 if(bytes.byteLength>MAX_SCRIPT||budget.used+bytes.byteLength>budget.total)return;
 budget.used+=bytes.byteLength;
 src.value=scriptDataUrl(text);
 for(let i=attrs.length-1;i>=0;i--){
  if(attrs[i].name==='integrity'||attrs[i].name==='crossorigin')attrs.splice(i,1);
 }
}

async function rewriteAttr(attrValue:{value:string},pageDir:string,dataUrl:(p:string)=>Promise<string|null>):Promise<void>{
 const path=localPath(attrValue.value,pageDir);
 if(!path)return;
 const url=await dataUrl(path);
 if(url)attrValue.value=url;
}

async function rewriteSrcset(attrValue:{value:string},pageDir:string,dataUrl:(p:string)=>Promise<string|null>):Promise<void>{
 const candidates=srcsetCandidates(attrValue.value);
 const replacements:{start:number;end:number;url:string}[]=[];
 for(const c of candidates){
  const path=localPath(c.url,pageDir);
  if(!path)continue;
  const url=await dataUrl(path);
  if(url)replacements.push({start:c.start,end:c.end,url});
 }
 // 从后往前替换:候选区间的偏移都基于原值,倒序替换不破坏前面的位置
 for(let i=replacements.length-1;i>=0;i--){
  const r=replacements[i];
  attrValue.value=attrValue.value.slice(0,r.start)+r.url+attrValue.value.slice(r.end);
 }
}

// 把 source 里静态引用的库内资源内联为 data: URL。返回可交给 makePreview 的 HTML。
export async function inlineLocalPreviewAssets(source:string,pagePath:string,io:PreviewInlineIO,budget:InlineBudget):Promise<string> {
 const doc=parse(source) as unknown as P5Node;
 const pageDir=dirOf(pagePath);
 // 调用方通常已经把 CSS 层的 dataUrlFor 传进来(cssInline 已用过);复用它,
 // 同一图片在 CSS 与 HTML 里只读一次、只扣一次预算。
 const ownDataUrl=createDataUrlFor(io,budget);
 const dataUrl=io.dataUrlFor?(path:string)=>io.dataUrlFor!(path):ownDataUrl;
 const cssIo:CssInlineIO={...io,dataUrlFor:dataUrl};
 const walk=async(nodes:P5Node[])=>{
  for(const n of nodes){
   if(n.childNodes?.length)await walk(n.childNodes);
   if(!n.attrs||!n.attrs.length)continue;
   const tag=n.tagName??'';
   if(tag==='script'){await inlineScript(n,pageDir,io,budget);continue;}
   if(tag==='style')continue; // 样式表与页内 <style> 已由 inlineLocalStylesheets 处理(含 url())
   for(const a of n.attrs){
    if(a.name==='srcset'&&(tag==='img'||tag==='source')){await rewriteSrcset(a,pageDir,dataUrl);continue;}
    if(a.name==='style'){a.value=await rewriteCssUrls(a.value,pagePath,cssIo);continue;}
    if(a.name==='src'&&SRC_TAGS.has(tag)){await rewriteAttr(a,pageDir,dataUrl);continue;}
    if(a.name==='poster'&&tag==='video'){await rewriteAttr(a,pageDir,dataUrl);continue;}
    if(tag==='image'&&(a.name==='href'||a.name==='xlink:href')){await rewriteAttr(a,pageDir,dataUrl);continue;}
    if(tag==='link'&&a.name==='href'&&isIconLink(n)){await rewriteAttr(a,pageDir,dataUrl);continue;}
   }
  }
 };
 await walk(doc.childNodes??[]);
 return serialize(doc as never);
}
