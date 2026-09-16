import {SourceIndex,SourceNode} from '../parsing/sourceIndex';
import {classifyRef,dirOf,resolveVaultRef,srcsetUrls,stripQuery} from '../parsing/url';
export {dirOf};

// 资源清单与依赖监控(F17):
// - 列出当前草稿引用的图片/样式/字体,标注本地/远程、解析状态;
// - 通过 vault 事件跟踪依赖,防抖刷新预览(不丢弃编辑、不从磁盘覆盖草稿);
// - @import/url 依 CSS 所在目录解析,带循环检测与上限。

export interface ResourceInfo {
 tag:string;              // img/link/style/script
 attr:string;
 raw:string;
 resolved:string;         // 解析结果(本地路径或 URL)
 local:boolean;
 status:'local-ok'|'missing'|'remote'|'blocked';
 nodeId:number;           // SourceIndex 节点,可跳源码
}

const TRACK_TAGS=new Set(['img','link','script','source','video','audio']);

// 这些标签内部不会有需要跟踪的资源引用。不能用 SourceIndex 的 excluded 标志:
// 它是"不可编辑文字"的判定,head 也在其中,于是 <link rel=stylesheet> 与 <style>
// 被一并跳过——F17 资源清单和依赖判断都会漏掉样式表(审计复检 §3.12 的真因)。
const NON_RESOURCE=new Set(['script','template','svg','math','textarea','select','option','canvas','iframe','object','embed','title']);

function insideNonResource(index:SourceIndex,nodeId:number):boolean {
 const guard=new Set<number>();
 let cur:SourceNode|undefined=index.nodes[nodeId];
 while(cur&&cur.parentId!==null&&!guard.has(cur.id)){
  guard.add(cur.id);
  const parent:SourceNode|undefined=index.nodes[cur.parentId];
  if(!parent)return false;
  if(parent.kind==='element'&&NON_RESOURCE.has(parent.tag))return true;
  cur=parent;
 }
 return false;
}

export function collectResources(index:SourceIndex):ResourceInfo[] {
 const out:ResourceInfo[]=[];
 const seen=new Set<string>();
 for(const n of index.nodes){
  if(n.kind!=='element'||!TRACK_TAGS.has(n.tag)||insideNonResource(index,n.id))continue;
  const attrName:string=n.tag==='link'?'href':'src';
  const attr=n.attrs.find(a=>a.name===attrName);
  const rel=n.tag==='link'?(n.attrs.find(a=>a.name==='rel')?.value??''):'';
  if(!attr)continue;
  if(n.tag==='link'&&rel&&!/stylesheet|icon|preload/i.test(rel))continue;
  const raw=attr.value;
  const key=`${n.id}:${raw}`;
  if(seen.has(key))continue;
  seen.add(key);
  let resolved=raw;let local=false;let status:ResourceInfo['status']='remote';
  const kind=classifyRef(raw);
  // 站内引用 = 相对引用或库根引用;数据/内联与页内锚点不是资源引用,不登记
  if(kind==='relative'||kind==='vault-root'){
   local=true;
   resolved=resolveVaultRef('',raw);
   status='missing';
  }else if(kind==='anchor'||kind==='empty'||/^(data:|blob:)/i.test(raw)){
   continue;
  }
  out.push({tag:n.tag,attr:attrName,raw,resolved,local,status,nodeId:n.id});
 }
 return out;
}

export function collectResourcesWithBase(index:SourceIndex,sourcePath:string,exists:(path:string)=>boolean,allowNetwork:boolean):ResourceInfo[] {
 const dir=dirOf(sourcePath);
 const out=collectResources(index);
 for(const r of out){
  if(r.local){
   // 根引用从库根解析,相对引用从页面目录解析(审计 round4 BUG 15)
   const path=resolveVaultRef(dir,r.raw);
   r.resolved=path;
   r.status=exists(path)?'local-ok':'missing';
  }else if(r.raw&&r.raw!=='(inline)'){
   r.status=allowNetwork?'remote':'blocked';
  }
 }
 return out;
}

// CSS @import/url 依赖追踪:从 CSS 文本提取库内相对引用(带循环检测与上限,见
// isPageDependency)。此前这里是一个读入 CSS 后 void 丢弃、恒返回 false 的空壳,
// 且没有调用者,于是"改关联 CSS 才刷新"退化成"任何 CSS/图片变化都刷新"(审计复检 §3.12)。
// `url(`/`@import URL(` 的大小写不敏感是 CSS 规定:大写形态此前完全不匹配,
// `@import URL(x)` 还会产出一个含 "URL(" 前缀的垃圾 token(审计 round4 BUG 22)。
const CSS_URL_RE=/@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)|url\(\s*['"]?([^'")]+)/gi;

export function cssUrls(cssText:string):string[] {
 const patterns=new RegExp(CSS_URL_RE.source,'gi');
 const refs:string[]=[];
 let m:RegExpExecArray|null;
 while((m=patterns.exec(cssText))!==null){
  const ref=(m[1]??m[2]).trim();
  if(!ref)continue;
  refs.push(ref);
 }
 return refs;
}

// 页面直接引用的本地资源(已解析为库内路径)。只认真正的资源引用:
// link 的 href(样式/图标/预加载)、img/source/video/audio 的 src/poster、srcset 候选、
// 内联 style 与 <style> 内的 url()/@import。<a href> 是页面链接,不属于资产依赖。
export function pageReferences(index:SourceIndex,pageDir:string):string[] {
 const out=new Set<string>();
 const add=(ref:string)=>{
  // 站内引用才登记:相对引用按页面目录解析,根引用从库根解析(与资源清单同一份判定)
  const kind=classifyRef(ref);
  if(kind!=='relative'&&kind!=='vault-root')return;
  const rel=stripQuery(ref).trim();
  if(!rel)return;
  out.add(resolveVaultRef(pageDir,rel));
 };
 for(const n of index.nodes){
  if(n.kind!=='element'||insideNonResource(index,n.id))continue;
  for(const a of n.attrs){
   if(!a.hasEqual)continue;
   if(n.tag==='link'&&a.name==='href'){add(a.value);continue;}
   if((a.name==='src'||a.name==='poster')&&n.tag!=='link')add(a.value);
   if(a.name==='srcset')for(const url of srcsetUrls(a.value))add(url);
   if(a.name==='style')for(const u of cssUrls(a.value))add(u);
  }
  if(n.tag==='style'&&n.childIds.length){
   const text=index.nodes[n.childIds[0]];
   if(text?.kind==='text')for(const u of cssUrls(text.raw))add(u);
  }
 }
 return [...out];
}

// 判断 modifiedPath 是否是某个页面的依赖:直接引用,或经 CSS 传递引用。
// 深度上限 5、visited 防环(设计 §7.4),读取失败即视为无依赖。
// `.css` 后缀比较不区分大小写:Windows 上 `A.CSS` 是合法文件名,只认小写会让
// 被引用的样式表变化静默不刷新(审计 round4 BUG 16)。
const isCssPath=(p:string)=>/\.css$/i.test(p);

export async function isPageDependency(modifiedPath:string,pageSource:string,pagePath:string,
 readCss:(path:string)=>Promise<string|null>):Promise<boolean> {
 const pageDir=dirOf(pagePath);
 const refs=pageReferences(new SourceIndex(pageSource),pageDir);
 if(refs.includes(modifiedPath))return true;
 const queue:Array<[string,number]>=refs.filter(isCssPath).map(p=>[p,0] as [string,number]);
 const seen=new Set<string>();
 while(queue.length){
  const [cssPath,depth]=queue.shift()!;
  if(seen.has(cssPath)||depth>5)continue;
  seen.add(cssPath);
  const text=await readCss(cssPath);
  if(text===null)continue;
  const dir=dirOf(cssPath);
  for(const ref of cssUrls(text)){
   const kind=classifyRef(ref);
   if(kind!=='relative'&&kind!=='vault-root')continue;
   const p=resolveVaultRef(dir,ref);
   if(p===modifiedPath)return true;
   if(isCssPath(p))queue.push([p,depth+1]);
  }
 }
 return false;
}

