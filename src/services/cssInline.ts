import {parse,serialize} from 'parse5';
import {classifyRef,dirOf,resolveVaultRef} from '../parsing/url';

// 预览专用:库内本地样式表内联(2026-09-30 真机定因)。
// 预览是 srcdoc iframe,文档继承宿主页面的 policy container,于是 Obsidian 自身的
// CSP(style-src 'unsafe-inline' 'self' https://fonts.googleapis.com)叠加在插件 meta
// CSP 之上。库资源走 app://<hash>/…,既不是 'self'(app://obsidian.md)也不在白名单,
// <link rel=stylesheet> 指向库内 CSS、以及 CSS 里的本地 @import 全被拦截
// (控制台 Refused to load the stylesheet app://…);图片不受影响是因宿主 CSP 放行
// img-src app:。纯浏览器门禁(tests/browser-check.mjs)没有宿主 CSP,复现不出来。
// 对策:生成预览文档前,把库内样式表读出来内联成 <style>(只进预览,绝不写回源文件):
// - 本地 @import 递归展开(深度上限 5、visited 防环,与 assets.isPageDependency 同约定);
// - 内联文本里的 url() 按该 CSS 文件自己的目录改写成绝对资源 URL(交给回调,避免手工
//   拼 app:// 编码);远程引用一律不动,由 CSP 与 allowNetwork 设置照旧裁决;
// - 匹配前先做 CSS 词法切分:块注释与字符串里的 @import/url() 不碰(注释掉的 import
//   不能展开、content:"url(x)" 的字面文本不能改写——审计 m6);
// - 子导入的产物视为最终文本,不再被父层重扫(否则子层未解析的相对 url() 会按父目录
//   重新解析,同名文件时指错资源——审计 m7);
// - CSS 文本进 <style> 前转义 "</style"(raw text 序列化不转义,含它的 CSS 会提前
//   闭合标签,把后续文本当标记解析,还会错位可视化编辑的文本段映射——审计 n3)。
// 内联后的 <style> 命中宿主 CSP 的 'unsafe-inline',绕开 style-src 来源限制。
// 读取失败的引用保持原样(与此前"被拦截"表现一致,不额外报错);rel=alternate stylesheet
// 与带 disabled 的 link 不是生效样式,内联反而会让它生效,跳过。

interface P5Node {
 nodeName:string;tagName?:string;value?:string;
 namespaceURI?:string;
 attrs?:{name:string;value:string}[];
 childNodes?:P5Node[];
 parentNode?:P5Node|null;
}

export interface CssInlineIO {
 // 读库内 CSS 文本;文件不存在/读取失败返回 null
 readCss(path:string):Promise<string|null>;
 // 库内文件 → 绝对资源 URL(app://…);解析不了返回 null(调用方保留原引用)
 resourceUrl(path:string):string|null;
}

// @import 两种合法形态:url(...) 与字符串;[^;]* 吃掉 layer()/supports() 等条件到分号。
// 只在"代码段"上运行(见 splitCssLex),不会碰到注释/字符串里的伪 import。
const IMPORT_RE=/@import\s+(?:url\(\s*(['"]?)([^'")\s;]+)\1\s*\)|(['"])([^'"]+)\3)[^;]*;/gi;
const URL_RE=/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

const MAX_DEPTH=5;

// 库内引用 → 绝对资源 URL;非本地引用或解析失败原样返回
function rewriteUrl(whole:string,target:string,cssPath:string,io:CssInlineIO):string {
 const kind=classifyRef(target);
 if(kind!=='relative'&&kind!=='vault-root')return whole;
 const abs=io.resourceUrl(resolveVaultRef(dirOf(cssPath),target));
 if(!abs)return whole;
 return `url("${abs.replace(/"/g,'%22')}")`;
}

function rewriteUrls(css:string,cssPath:string,io:CssInlineIO):string {
 URL_RE.lastIndex=0;
 return css.replace(URL_RE,(whole:string,_q:string,target:string)=>rewriteUrl(whole,target,cssPath,io));
}

// CSS 词法切分(审计 m6):块注释与字符串是 protected,不参与 @import/url() 匹配;
// 两个例外必须整体留在 code 里——url(...) 连同引号参数(那是 url 语法不是字符串字面量),
// 以及整条 @import 语句(字符串形态的目标本身就是要匹配的内容)。
interface LexSpan{s:string;code:boolean}
function splitCssLex(text:string):LexSpan[]{
 const spans:LexSpan[]=[];
 let seg=0,i=0;
 const push=(end:number,code:boolean)=>{if(end>seg)spans.push({s:text.slice(seg,end),code});};
 while(i<text.length){
  if(text.startsWith('/*',i)){
   const close=text.indexOf('*/',i+2);
   const stop=close===-1?text.length:close+2;
   push(i,true);
   seg=i; // 保护段自己为下一段的起点(push 从 seg 切起)
   push(stop,false);
   seg=stop;i=stop;continue;
  }
  const c=text[i];
  if(c==='"'||c==="'"){
   let j=i+1;
   while(j<text.length&&text[j]!==c){if(text[j]==='\\')j++;j++;}
   const stop=Math.min(j+1,text.length);
   push(i,true);
   seg=i;
   push(stop,false);
   seg=stop;i=stop;continue;
  }
  if(text.slice(i,i+3).toLowerCase()==='url'&&text[i+3]==='('){
   let depth=0,j=i+3;
   do{if(text[j]==='(')depth++;else if(text[j]===')')depth--;j++;}while(j<text.length&&depth>0);
   i=j;continue;
  }
  if(text.slice(i,i+7).toLowerCase()==='@import'){
   const semi=text.indexOf(';',i+7);
   i=semi===-1?text.length:semi+1; // 整条语句留在 code 段
   continue;
  }
  i++;
 }
 push(text.length,true);
 return spans;
}

// 展开 CSS 文本里的本地 @import 并改写 url()。ownerPath 是"这段文本所属文件"的库内
// 路径(相对引用以它为基准)。返回的文本始终可用(import 失败的语句原样保留)。
// 子导入产物按子目录完成改写后即 final,父层不再重扫(审计 m7)。
async function expandCssText(text:string,ownerPath:string,depth:number,visited:Set<string>,io:CssInlineIO):Promise<string> {
 const parts:{s:string;final:boolean}[]=[];
 for(const span of splitCssLex(text)){
  if(!span.code){parts.push({s:span.s,final:true});continue;}
  let last=0;
  IMPORT_RE.lastIndex=0;
  let m:RegExpExecArray|null;
  while((m=IMPORT_RE.exec(span.s))!==null){
   const target=(m[2]??m[4]??'').trim();
   const kind=classifyRef(target);
   if(kind!=='relative'&&kind!=='vault-root')continue;
   const importPath=resolveVaultRef(dirOf(ownerPath),target);
   if(depth>=MAX_DEPTH||visited.has(importPath))continue;
   visited.add(importPath);
   const sub=await io.readCss(importPath);
   if(sub===null)continue;
   parts.push({s:span.s.slice(last,m.index),final:false});
   parts.push({s:await expandCssText(sub,importPath,depth+1,visited,io),final:true});
   last=m.index+m[0].length;
  }
  parts.push({s:span.s.slice(last),final:false});
 }
 return parts.map(p=>p.final?p.s:rewriteUrls(p.s,ownerPath,io)).join('');
}

// 从 <link href> 指向的库内 CSS 读出并展开;读不到返回 null(调用方保留原 link)
async function loadCss(cssPath:string,io:CssInlineIO):Promise<string|null> {
 const text=await io.readCss(cssPath);
 if(text===null)return null;
 return expandCssText(text,cssPath,0,new Set(),io);
}

// parse5 对 <style> 内容按 raw text 序列化(不转义):含 "</style" 的库内 CSS 会提前
// 闭合标签,把后续文本当标记解析进预览——不只污染文档,还会让预览的文本段序列与
// workingSource 的解析错位,可视化编辑映射全错(审计 n3)。"<\/style" 在 CSS 字符串里
// 是合法转义(\/ ≡ /)、在注释里无影响;除字符串/注释外 "</style" 不可能合法出现。
function escapeStyleClose(css:string):string{return css.replace(/<\/(style)/gi,'<\\/$1');}

function isLocalStylesheetLink(node:P5Node):{node:P5Node; href:string}|null {
 if(node.tagName!=='link'||!node.attrs)return null;
 const rel=(node.attrs.find(a=>a.name==='rel')?.value??'').trim().toLowerCase().split(/\s+/);
 if(!rel.includes('stylesheet')||rel.includes('alternate'))return null;
 // disabled 样式表浏览器不应用,内联反而会让它生效(审计 n1)
 if(node.attrs.some(a=>a.name==='disabled'))return null;
 const href=node.attrs.find(a=>a.name==='href')?.value;
 return href?{node,href}:null;
}

// 把 source 里指向库内的 <link rel=stylesheet> 替换为内联 <style>,并展开页内
// <style> 里的本地 @import。纯函数:不修改入参字符串语义之外的任何状态,产物只用于预览。
export async function inlineLocalStylesheets(source:string,pagePath:string,io:CssInlineIO):Promise<string> {
 const doc=parse(source) as unknown as P5Node;
 const pageDir=dirOf(pagePath);
 const walk=async(nodes:P5Node[])=>{
  for(let i=0;i<nodes.length;i++){
   const n=nodes[i];
   if(n.childNodes?.length)await walk(n.childNodes);
   if(n.tagName==='style'){
    const textNode=n.childNodes?.find(c=>c.nodeName==='#text');
    if(textNode&&textNode.value!==undefined)
     textNode.value=escapeStyleClose(await expandCssText(textNode.value,pagePath,0,new Set(),io));
    continue;
   }
   const link=isLocalStylesheetLink(n);
   if(!link)continue;
   const kind=classifyRef(link.href);
   if(kind!=='relative'&&kind!=='vault-root')continue;
   const css=await loadCss(resolveVaultRef(pageDir,link.href),io);
   if(css===null)continue;
   // namespaceURI 必须带上:parse5 序列化器靠它判定 style 是 HTML raw-text 元素,
   // 缺了会把文本按普通元素实体转义(< 变 &lt;),CSS 字符串/注释里的 < 字面量全毁
   const style:P5Node={nodeName:'style',tagName:'style',namespaceURI:'http://www.w3.org/1999/xhtml',
    attrs:n.attrs!.filter(a=>a.name!=='rel'&&a.name!=='href'&&a.name!=='disabled').map(a=>({...a})),
    childNodes:[],parentNode:n.parentNode};
   const text:P5Node={nodeName:'#text',value:escapeStyleClose(css),parentNode:style};
   style.childNodes!.push(text);
   nodes[i]=style;
  }
 };
 await walk(doc.childNodes??[]);
 return serialize(doc as never);
}
