import {SourceIndex} from '../parsing/sourceIndex';
import {TextPatch,applyPatches} from '../core/patch';
import {escapeAttrPath} from '../parsing/escape';
import {dirOf,escapesVaultRoot,isDirRef,isRemoteRef,normJoin,srcsetCandidates,stripQuery} from '../parsing/url';

// F14 另存为的**纯规划逻辑**:跨目录时重写可解析的本地相对 src/href/poster/srcset
// 与内联 CSS url(使用分词器定位,不做全局字符串替换)。
// 与 obsidian 宿主无关,因此可被 node 测试直接引用;saveService.ts 重新导出对外接口。

export interface SaveAsPlan {path:string; content:string; rewritten:{from:string; to:string}[]; unresolved:string[]}

// srcset 不在这里:它有自己的多候选循环,若同时被通用循环按"整个属性值"改写,
// 两个补丁区间重叠,applyPatches 直接抛错、另存为静默失败(审计复检 §3.9)。
const REWRITE_ATTRS=new Set(['src','href','poster']);

export function planSaveAs(source:string,sourcePath:string,targetDir:string,rebase:boolean):
 {content:string; rewritten:{from:string; to:string}[]; unresolved:string[]}{
 const index=new SourceIndex(source);
 const patches:TextPatch[]=[];
 const rewritten:{from:string; to:string}[]=[];
 const unresolved:string[]=[];
 const sourceDir=dirOf(sourcePath);
 const done=()=>patches.length?{content:applyPatches(source,patches.sort((a,b)=>b.start-a.start)),rewritten,unresolved}:{content:source,rewritten,unresolved};
 if(!rebase||targetDir===sourceDir)return {content:source,rewritten,unresolved};
 // expected 必须与源码逐字节一致:parse5 的 attr.value 是解码后的值,属性里含实体时
 // 会与源切片不符,补丁被 validatePatches 以"内容已变化"拒绝。一律取源切片。
 const slice=(start:number,end:number)=>source.slice(start,end);
 // 文档自己的解析基准 `<base href>`(第一个生效)。带 base 的文档里,所有相对引用
 // 都相对 base 的目录解析;基准不动的话,搬到新目录后同一条相对引用会指到别处
 // (审计 round4 BUG 14)。
 const baseAttr=findBaseHref(index);
 if(baseAttr){
  const raw=slice(baseAttr.valueStart,baseAttr.valueEnd);
  // 远程 base:相对引用整体落到站外,任何重写都会写坏值 → 保持原样
  if(isRemoteRef(raw))return {content:source,rewritten,unresolved};
  // 本地 base:只把 base 搬到新位置。其余引用相对 base 的语义随 base 一起移动,
  // 因此结果仍指向原资源,且改动最小(审计 round4 BUG 14 的两种等价修法之一)。
  const next=rebaseRef(raw,sourceDir,targetDir);
  if(next&&next!==raw){
   patches.push({start:baseAttr.valueStart,end:baseAttr.valueEnd,expected:raw,replacement:escapeAttrPath(next,baseAttr.quote)});
   rewritten.push({from:raw,to:next});
  }
  return done();
 }
 for(const el of index.nodes){
  if(el.kind!=='element')continue;
  for(const attr of el.attrs){
   if(!REWRITE_ATTRS.has(attr.name)||!attr.hasEqual)continue;
   const raw=slice(attr.valueStart,attr.valueEnd);
   const next=rebaseRef(raw,sourceDir,targetDir);
   if(next===null){if(!isRemoteRef(raw))unresolved.push(raw);continue;}
   if(next===raw)continue;
   patches.push({start:attr.valueStart,end:attr.valueEnd,expected:raw,
    replacement:escapeAttrPath(next,attr.quote)});
   rewritten.push({from:raw,to:next});
  }
 }
 // srcset 多候选:逐候选只改 URL 本身,属性其余部分逐字节保留
 for(const el of index.nodes){
  if(el.kind!=='element')continue;
  for(const attr of el.attrs){
   if(attr.name!=='srcset'||!attr.hasEqual)continue;
   rewriteSrcset(slice(attr.valueStart,attr.valueEnd),attr.valueStart,sourceDir,targetDir,patches,rewritten,unresolved);
  }
 }
 // 内联 style 属性与 style 标签里的 url(...)
 for(const el of index.nodes){
  if(el.kind!=='element')continue;
  if(el.tag==='style'&&el.childIds.length){
   const textNode=index.nodes[el.childIds[0]];
   // 起点必须是文字节点的源偏移(不是节点 id)
   if(textNode?.kind==='text')rewriteCssUrls(textNode.raw,textNode.start,sourceDir,targetDir,patches,rewritten,unresolved);
  }
  for(const attr of el.attrs){
   if(attr.name!=='style'||!attr.hasEqual)continue;
   rewriteCssUrls(slice(attr.valueStart,attr.valueEnd),attr.valueStart,sourceDir,targetDir,patches,rewritten,unresolved);
  }
 }
 return done();
}

// 文档生效的 <base href>(按规范只认第一个)
function findBaseHref(index:SourceIndex):{valueStart:number;valueEnd:number;quote:'"'|"'"|''}|null{
 for(const n of index.nodes){
  if(n.kind!=='element'||n.tag!=='base')continue;
  const attr=n.attrs.find(a=>a.name==='href'&&a.hasEqual);
  if(attr)return {valueStart:attr.valueStart,valueEnd:attr.valueEnd,quote:attr.quote};
 }
 return null;
}

// 单一引用重写:相对 sourceDir 解析,再相对 targetDir 重新相对化。
// 返回 null 表示不可重写(站外/无法相对化),返回原值表示无需改写。
// 三个边界必须在这里统一处理(审计 round4 BUG 13/29):
// - 尾部 `/` 是语义的一部分(`assets/` 目录 vs `assets` 文件);
// - 引用的首尾空白会被浏览器剥离," x.png" 指的是 x.png,保留空格会指到另一个文件;
// - query/fragment 原样附加,不参与路径计算。
function rebaseRef(raw:string,sourceDir:string,targetDir:string):string|null{
 if(isRemoteRef(raw))return null;
 const path=stripQuery(raw).trim();
 // 只有 query/fragment(如 href="?x=1" / "#f"):指向文档自身,位置无关,保持原样。
 // 早期实现会把它算成目录并改写成 "..?x=1" —— 既改错又进"未重写"清单。
 if(!path)return raw;
 const suffix=raw.slice(stripQuery(raw).length);
 const dir=isDirRef(raw);
 // 越出库根的引用无法用库内路径表示:报"未重写",不写一个被截断的近似路径
 if(escapesVaultRoot(sourceDir,path))return null;
 const abs=normJoin(sourceDir,path);
 if(!abs)return null;
 const rel=relPathFrom(targetDir,abs);
 if(!rel)return null;
 return rel+(dir?'/':'')+suffix;
}

function rewriteSrcset(value:string,valueStart:number,sourceDir:string,targetDir:string,
 patches:TextPatch[],rewritten:{from:string;to:string}[],unresolved:string[]):void{
 // 候选切分与依赖图共用同一实现(srcsetCandidates,按 HTML 规范):
 // URL 读到空白,逗号只在描述符区作分隔符。此前自己写的一套"逗号+空白"判定会漏掉
 // 无空格分隔的候选 —— 不改写但浏览器照常加载,与 N2 是同一类偏差。
 for(const cand of srcsetCandidates(value)){
  const url=cand.url;
  if(!url)continue;
  const next=rebaseRef(url,sourceDir,targetDir);
  if(next===null){if(!isRemoteRef(url))unresolved.push(url);continue;}
  if(next===url)continue;
  // 引号/空白会被当成候选边界,进而不安全;交给"未重写"清单而不是写出坏值
  if(/["'\s]/.test(next)){unresolved.push(url);continue;}
  patches.push({start:valueStart+cand.start,end:valueStart+cand.end,expected:url,replacement:next});
  rewritten.push({from:url,to:next});
 }
}

function rewriteCssUrls(css:string,baseOffset:number,sourceDir:string,targetDir:string,patches:TextPatch[],rewritten:{from:string; to:string}[],unresolved:string[]):void{
 // `url(` 大小写不敏感是 CSS 规定:`URL(bg.png)` 此前完全不匹配(审计 round4 BUG 22)
 const re=/url\(\s*['"]?([^'")]+)/gi;
 let m:RegExpExecArray|null;
 while((m=re.exec(css))!==null){
  const raw=m[1];
  if(isRemoteRef(raw))continue;
  // 与属性/srcset 共用同一套边界处理(尾部 `/`、首尾空白、query/fragment 保留、
  // 越出库根):三处各自实现正是这一批缺陷的来源
  const next=rebaseRef(raw,sourceDir,targetDir);
  if(next===null){unresolved.push(raw);continue;}
  // url() 内无法安全容纳引号与空白;这类路径进"未重写"清单,不写坏值
  if(/["'\s]/.test(next)){unresolved.push(raw);continue;}
  if(next===raw)continue;
  // 补丁起点是"路径"的偏移,不是 url( 的偏移:匹配串本身以路径结尾,
  // 用 m[0] 长度反推即可(审计复检 §3.15:此前错用 m.index,补丁被拒绝)。
  const pathStart=m.index+(m[0].length-raw.length);
  patches.push({start:baseOffset+pathStart,end:baseOffset+pathStart+raw.length,expected:raw,replacement:next});
  rewritten.push({from:raw,to:next});
 }
}

// 重新相对化。此前以"两个目录没有公共首段"当作越界条件,导致平级目录
// (pages → archive)、根目录到子目录、跨顶层目录全部不重写(审计复检 §3.10)。
// normJoin 已在库根截断,因此这里只要处理绝对路径,其余一律可算。
function relPathFrom(fromDir:string,toPath:string):string|null{
 if(!toPath||toPath.startsWith('/'))return null;
 const from=fromDir?fromDir.split('/'):[];
 const to=toPath.split('/');
 let i=0;
 while(i<from.length&&i<to.length&&from[i]===to[i])i++;
 const ups:string[]=Array.from({length:from.length-i},()=>'..');
 const rest=to.slice(i);
 return [...ups,...rest].join('/')||to[to.length-1];
}

