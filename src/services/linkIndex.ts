import {SourceIndex} from '../parsing/sourceIndex';
import {decodeOnce} from './url';
import type {ResolvedLink} from './links';

// 库内链接索引(2026-10-31 出链/反链支持)。真机结论(probe/live/backlink-verify.mjs,
// Obsidian 1.13.7):原生反链面板对 HTML 文件可用,但原生出链面板对 HTML 恒为空
// (宿主不解析 HTML 内容),且 1.13.1 的公开 typings 没有 getBacklinksForFile ——
// 所以反链数据从公开的 resolvedLinks 反演,出链数据从页面 <a href> 现扫。
// 两个函数都是纯函数:单元测试与探针直接调用,不需要 Obsidian 实例。

// 反链:resolvedLinks 是"源路径 → {目标路径 → 次数}",反演取指向 targetPath 的全部源。
// 宿主只索引 Markdown 里的链接,所以反链源天然只有笔记 —— 与原生反链面板口径一致。
export interface BacklinkEntry{source:string; count:number}

export function backlinksFor(resolvedLinks:Record<string,Record<string,number>>,targetPath:string):BacklinkEntry[]{
 const out:BacklinkEntry[]=[];
 for(const src in resolvedLinks){
  const n=resolvedLinks[src][targetPath];
  if(n)out.push({source:src,count:n});
 }
 out.sort((a,b)=>a.source===b.source?0:a.source<b.source?-1:1);
 return out;
}

export interface PageLinkEntry{
 raw:string;              // href 属性值(parse5 已解码实体,与预览点击路径 getAttribute 一致)
 text:string;             // 链接文字(首条锚点;合并条目用 texts 看全部)
 texts:string[];          // 同目标各次出现的文字(去重;文字不同时 UI 提示"等 N 处")
 offset:number;           // href 属性的源码起始偏移(定位源码用)
 count:number;            // 同 target+query+fragment 出现次数(去重合并)
 resolved:ResolvedLink;
}

// 出链去重与"循环定位"的同一把尺子:目标文件路径+query+fragment。
// 三段必须用分隔符拼接:无分隔符时"文件名含 #"(href 写 %23)会与
// "目标 + #fragment"拼出同一个 key,两条不同目标被并成一条(审计 round1)。
// fragment 按 URL 规则解码一次再入 key:点击路径按解码值找元素,
// #中 与 #%E4%B8%AD 是同一个跳转目标,清单里必须合并。
export function linkKeyOf(resolved:ResolvedLink):string{
 return `${resolved.file?.path??resolved.target}\u0000${resolved.query}\u0000${decodeOnce(resolved.fragment)}`;
}

interface AnchorPos{start:number;end:number;hrefStart:number;resolved:ResolvedLink}

// "算不算出链"的过滤半边:空 href/纯锚点/纯协议类(javascript: 等)不算。
// 源码侧枚举与预览侧元素定位(anchorIndexesForKey)共用,保证两边的"第 N 次出现"数的是同一批锚点。
function countsAsOutgoing(resolved:ResolvedLink):boolean{
 return !(resolved.kind==='empty'||resolved.kind==='anchor'
  ||(resolved.kind==='unsupported'&&resolved.reason!=='not-found'));
}

// 共享的锚点枚举:清单渲染(collectPageLinks)与定位重扫(anchorRangesForKey)
// 必须用完全相同的谓词,任何一处单独增删条件都会让"合并计数"与"循环定位"分裂。
// 口径与原生出链面板对齐:纯锚点(#…)、空 href、非 not-found 的 unsupported
// (javascript:/data: 等协议)不算出链;excluded(template/svg/head 等不可见区域)
// 里的 <a> 不是真实页面出链,一并剔除(审计 round1)。
function collectAnchors(index:SourceIndex,resolve:(raw:string)=>ResolvedLink):AnchorPos[]{
 const out:AnchorPos[]=[];
 for(const node of index.nodes){
  if(node.kind!=='element'||node.tag!=='a'||node.excluded)continue;
  const href=node.attrs.find(a=>a.name==='href');
  if(!href)continue;
  const resolved=resolve(href.value);
  if(!countsAsOutgoing(resolved))continue;
  out.push({start:node.start,end:node.end,hrefStart:href.valueStart,resolved});
 }
 return out;
}

export function collectPageLinks(index:SourceIndex,resolve:(raw:string)=>ResolvedLink):PageLinkEntry[]{
 const out:PageLinkEntry[]=[];
 const byKey=new Map<string,PageLinkEntry>();
 // 文字节点一次收齐(文档序,起止偏移单调),各锚点二分取区间文字。
 // 全量重扫是 O(锚点×文字节点):面板在每次选中变化时整块重建,链接多的页面会卡。
 const texts:{start:number;end:number;value:string}[]=[];
 for(const n of index.nodes)if(n.kind==='text')texts.push(n);
 for(const a of collectAnchors(index,resolve)){
  const key=linkKeyOf(a.resolved);
  const text=anchorTextOf(texts,a.start,a.end);
  const seen=byKey.get(key);
  if(seen){
   seen.count++;
   if(text&&!seen.texts.includes(text))seen.texts.push(text);
   continue;
  }
  const entry:PageLinkEntry={raw:a.resolved.raw,text,texts:text?[text]:[],
   offset:a.hrefStart,count:1,resolved:a.resolved};
  byKey.set(key,entry);
  out.push(entry);
 }
 return out;
}

// 「定位」的重扫辅助:渲染后源码可能已被编辑,过期偏移会指错位置 ——
// 点击时在**当前**源码里重新解析每个 <a href>,收集与 key 同目标的全部锚点区间
// (文档顺序)。定位在这些区间上循环取用。
export function anchorRangesForKey(index:SourceIndex,resolve:(raw:string)=>ResolvedLink,key:string):{start:number;end:number}[]{
 const out:{start:number;end:number}[]=[];
 for(const a of collectAnchors(index,resolve)){
  if(linkKeyOf(a.resolved)!==key)continue;
  out.push({start:a.start,end:a.end});
 }
 return out;
}

export interface SegmentLike{id:string;start:number;end:number;text:string}

// 每个锚点区间里第一个可选中文字段(整段落在区间内),供「定位」在预览里高亮;
// 图片/图标链接没有文字段,得 null,调用方退回预览元素定位或源码定位。结构体类型与 model.Segment 兼容。
export function firstSegmentIds(ranges:{start:number;end:number}[],segments:SegmentLike[]):(string|null)[]{
 return ranges.map(range=>segments
  .find(seg=>seg.start>=range.start&&seg.end<=range.end&&seg.text.trim())?.id??null);
}

// 预览侧元素定位:预览文档里的 a[href](文档序)按同一把 key 分组,返回目标组
// 第 index 次出现(0 起,越界回卷)在序列里的下标;找不到返回 -1。
// 与源码侧(anchorRangesForKey)计数基本一致:template 内容不在文档树里天然排除;
// 已知偏差是 svg 内的 <a> 在 DOM 里存在、源码侧被 excluded —— 极端页面第 N 处可能错位一处。
export function anchorIndexesForKey(hrefs:string[],resolve:(raw:string)=>ResolvedLink,key:string,index:number):number{
 const hits:number[]=[];
 for(let i=0;i<hrefs.length;i++){
  const resolved=resolve(hrefs[i]);
  if(countsAsOutgoing(resolved)&&linkKeyOf(resolved)===key)hits.push(i);
 }
 if(!hits.length)return -1;
 return hits[index%hits.length];
}

// 锚点文字:元素区间内的全部文本节点(parse5 解码值)直接拼接后折叠空白 ——
// 相邻内联元素之间没有源空白就不能插空格(「斜体」「与」「粗体」必须拼成斜体与粗体),
// 而跨行缩进的空白由折叠归一。嵌套内联的文本节点 parentId 不是锚点本身,必须按区间收。
function anchorTextOf(texts:{start:number;end:number;value:string}[],start:number,end:number):string{
 let lo=0,hi=texts.length;
 while(lo<hi){
  const mid=(lo+hi)>>1;
  if(texts[mid].end<=start)lo=mid+1;else hi=mid;
 }
 let text='';
 for(let i=lo;i<texts.length&&texts[i].start<end;i++){
  const n=texts[i];
  if(n.start>=start&&n.end<=end)text+=n.value;
 }
 return text.replace(/\s+/g,' ').trim().slice(0,80);
}
