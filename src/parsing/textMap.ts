import {SourceIndex,SourceNode} from './sourceIndex';
import {TextPatch} from '../core/patch';
import {escapeText} from './escape';

// TextMap（报告 §12.3 第 8 条，D1 具名交付物）：
// 记录逻辑文本字符与一个或多个源区间、文字节点和格式边界之间的映射；
// 实体解码、空白折叠、br、代理对和跨节点命中都必须可追溯。
// F08/F09/F13/F20 共用它；源码定位共用 SourceIndex。

export interface CharSourceMap {nodeId:number; srcStart:number; srcEnd:number}
export interface TextContainer {
 nodeId:number;
 tag:string;
 logical:string;
 map:CharSourceMap[];   // 与 logical 等长（每 UTF-16 代码单元一项）
 hidden:boolean;
 preserveWhitespace:boolean;
}
export interface TextMap {containers:TextContainer[]; unmappableNodes:number[]}
export interface SourceRange {nodeId:number; srcStart:number; srcEnd:number}

const NAMED_ENTITIES:Record<string,string>={
 amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0',copy:'\u00a9',reg:'\u00ae',trade:'\u2122',
 hellip:'\u2026',mdash:'\u2014',ndash:'\u2013',lsquo:'\u2018',rsquo:'\u2019',ldquo:'\u201c',rdquo:'\u201d',
 laquo:'\u00ab',raquo:'\u00bb',deg:'\u00b0',plusmn:'\u00b1',frac12:'\u00bd',times:'\u00d7',divide:'\u00f7',
 euro:'\u20ac',pound:'\u00a3',yen:'\u00a5',cent:'\u00a2',sect:'\u00a7',para:'\u00b6',middot:'\u00b7',
};

function decodeEntityBody(body:string):string|null {
 const numeric=/^#([0-9]+)$/.exec(body);
 const hex=/^#[xX]([0-9a-fA-F]+)$/.exec(body);
 if(numeric){const cp=Number(numeric[1]);return cp>0&&cp<=0x10ffff?String.fromCodePoint(cp):null;}
 if(hex){const cp=parseInt(hex[1],16);return cp>0&&cp<=0x10ffff?String.fromCodePoint(cp):null;}
 return NAMED_ENTITIES[body]??null;
}

// 带位置映射的原始切片解码：每个输出 UTF-16 代码单元对应一个源区间；
// 实体解码映射到完整拼写，CRLF/孤立 CR 按规范归一为 LF 并映射到整个换行区间。
export function decodeRawWithMap(raw:string):{text:string; map:[number,number][]} {
 const chars:string[]=[];const map:[number,number][]=[];
 const push=(ch:string,srcStart:number,srcEnd:number)=>{
  for(let k=0;k<ch.length;k++){chars.push(ch[k]);map.push([srcStart,srcEnd]);}
 };
 let i=0;
 while(i<raw.length){
  const c=raw[i];
  if(c==='\r'){const crlf=raw[i+1]==='\n';push('\n',i,crlf?i+2:i+1);i+=crlf?2:1;continue;}
  if(c==='&'){
   const semi=raw.indexOf(';',i+1);
   if(semi>0&&semi-i<=34){
    const dec=decodeEntityBody(raw.slice(i+1,semi));
    if(dec!==null){push(dec,i,semi+1);i=semi+1;continue;}
   }
  }
  push(c,i,i+1);i++;
 }
 return {text:chars.join(''),map};
}

// 将 parse5 的解码文本逐单元对齐回原始切片，产出切片内偏移映射。
// 对齐失败（跨标签合并的散布节点等）返回 null，由调用方降级处理，
// 绝不用错误偏移构造映射。
// 实体处理分三层：已知实体按解码值精确匹配；未知的规范实体(&…;)按"解码为单个码点"
// 通用消费(audit/parsing R9:不能因实体表不全而丢弃整个文本节点);'&' 后非规范形式按字面量。
function alignValueToSlice(value:string,slice:string):[number,number][]|null {
 const map:[number,number][]=[];
 let i=0;
 for(let v=0;v<value.length;){
  const ch=value[v];
  if(ch==='\n'&&slice[i]==='\r'){
   const len=slice[i+1]==='\n'?2:1;
   map.push([i,i+len]);v++;i+=len;continue;
  }
  if(slice[i]==='&'){
   const semi=slice.indexOf(';',i+1);
   if(semi>0&&semi-i<=34){
    const dec=decodeEntityBody(slice.slice(i+1,semi));
    if(dec!==null&&value.startsWith(dec,v)){
     for(let k=0;k<dec.length;k++)map.push([i,semi+1]);
     v+=dec.length;i=semi+1;continue;
    }
    if(value[v]!=='&'){
     // 未知实体:规范形式必然解码为单个码点;按值端码点长度通用消费
     const cp=value.codePointAt(v)??0;
     const units=cp>0xffff?2:1;
     for(let k=0;k<units;k++)map.push([i,semi+1]);
     v+=units;i=semi+1;continue;
    }
   }
  }
  if(slice.startsWith(ch,i)){map.push([i,i+1]);v++;i++;continue;}
  return null;
 }
 return i===slice.length?map:null;
}

const COLLAPSIBLE=/[ \t\n\r\f]/;
const isCollapsibleOnly=(s:string)=>[...s].every(c=>c==='\ufeff'||COLLAPSIBLE.test(c));

// 容器标签（报告 F10 的容器集合是其子集）：块级元素作为逻辑段落边界。
const BLOCK=new Set(['p','div','h1','h2','h3','h4','h5','h6','ul','ol','li','table','thead','tbody','tfoot','tr','td','th',
 'blockquote','pre','dl','dt','dd','figure','figcaption','section','article','aside','header','footer','nav','main',
 'form','fieldset','details','summary','address','hgroup','button','caption']);

// 空容器占位适用标签:只覆盖"段落类"内容槽,不把布局用的空 div 塞进大纲。
const EMPTY_SLOT=new Set(['p','h1','h2','h3','h4','h5','h6','li','td','th','button','a','blockquote','dd','dt','caption','figcaption','summary','pre']);

interface Segment {nodeId:number; text:string; map:[number,number][]; isBr:boolean; brRange:[number,number]}

export function buildTextMap(index:SourceIndex):TextMap {
 const nodes=index.nodes;
 // 每个文字节点的最近块级祖先作为其容器；无块祖先时用 body（或根元素）。
 const nearestBlock=(nodeId:number):number|null=>{
  let cur:SourceNode|undefined=nodes[nodeId];
  while(cur){
   if(cur.kind==='element'&&BLOCK.has(cur.tag))return cur.id;
   cur=cur.parentId===null?undefined:nodes[cur.parentId];
  }
  return null;
 };
 const fallback=index.elements('body')[0]?.id??index.root?.id??null;

 const grouped=new Map<number,Segment[]>();
 const unmappableNodes:number[]=[];
 const addSegment=(containerId:number,seg:Segment)=>{
  let arr=grouped.get(containerId);
  if(!arr){arr=[];grouped.set(containerId,arr);}
  arr.push(seg);
 };
 for(const n of nodes){
  if(n.kind==='element'&&n.tag==='br'&&!n.excluded){
   const containerId=nearestBlock(n.id)??fallback;
   if(containerId!==null)addSegment(containerId,{nodeId:n.id,text:'',map:[],isBr:true,brRange:[n.startTagStart,n.startTagEnd]});
   continue;
  }
  if(n.kind!=='text'||n.excluded)continue;
  const containerId=nearestBlock(n.id)??fallback;
  if(containerId===null)continue;
  const aligned=alignValueToSlice(n.value,n.raw);
  if(aligned){
   const shifted=aligned.map(([s,e])=>[s+n.start,e+n.start] as [number,number]);
   addSegment(containerId,{nodeId:n.id,text:n.value,map:shifted,isBr:false,brRange:[0,0]});
  }else if(isCollapsibleOnly(n.value)){
   // 跨标签合并的散布空白节点：整体作为一个待折叠空白 run，映射到整个切片。
   addSegment(containerId,{nodeId:n.id,text:' ',map:[[n.start,n.end]],isBr:false,brRange:[0,0]});
  }else{
   // 无法安全对齐的非空白内容：不进入映射，交由诊断；绝不产生错误偏移。
   unmappableNodes.push(n.id);
  }
 }

 const containers:TextContainer[]=[];
 for(const [containerId,segments] of grouped){
  const el=nodes[containerId];
  if(!el||el.kind!=='element')continue;
  segments.sort((a,b)=>a.nodeId-b.nodeId); // SourceIndex 按文档顺序分配 id，稳定排序恢复顺序
  const preserve=el.tag==='pre';
  let logical='';const map:CharSourceMap[]=[];
  let pendingWs=false;      // 有待折叠的空白
  let atLineStart=true;     // 行首（含文档起始、br 之后）不输出折叠空格
  let wsRun:CharSourceMap|null=null;
  let wsRunClosed=false;    // run 只在本文字节点内延伸;跨节点绝不合并
  for(const seg of segments){
   if(seg.isBr){
    if(pendingWs&&!atLineStart&&wsRun){logical+=' ';map.push(wsRun);}
    pendingWs=false;wsRun=null;wsRunClosed=false;
    logical+='\n';
    map.push({nodeId:seg.nodeId,srcStart:seg.brRange[0],srcEnd:seg.brRange[1]});
    atLineStart=true;
    continue;
   }
   const chars=seg.map;
   for(let k=0;k<seg.text.length;k++){
    const ch=seg.text[k];
    const [ss,se]=chars[k];
    if(!preserve&&COLLAPSIBLE.test(ch)){
     if(!wsRun)wsRun={nodeId:seg.nodeId,srcStart:ss,srcEnd:se};
     else if(!wsRunClosed)wsRun.srcEnd=se;
     // 跨节点后的空白不再并入:若延伸,源区间会跨越中间的内联元素,
     // 替换折叠空格时会静默删除元素(audit/parsing R10/R11 跨节点场景)
     pendingWs=true;
     continue;
    }
    if(pendingWs&&!atLineStart&&wsRun){logical+=' ';map.push(wsRun);}
    pendingWs=false;wsRun=null;wsRunClosed=false;atLineStart=false;
    logical+=ch;
    map.push({nodeId:seg.nodeId,srcStart:ss,srcEnd:se});
   }
   wsRunClosed=true;
  }
  // 尾部待折叠空白直接丢弃
  containers.push({nodeId:containerId,tag:el.tag,logical,map,hidden:el.hidden,preserveWhitespace:preserve});
 }
 // 空段落也要有容器:清空后 parse5 不再产生文本节点,此前这类段落会**完全消失**,
 // 既不在大纲里、也无法再写回(审计 round4 BUG 2)。只为"段落类"标签补占位容器,
 // 避免把布局用的空 div 全部塞进大纲。
 for(const el of nodes){
  if(el.kind!=='element')continue;
  if(!EMPTY_SLOT.has(el.tag))continue;
  if(grouped.has(el.id))continue;
  const hasText=el.childIds.some(id=>nodes[id]?.kind==='text'||(nodes[id]?.kind==='element'&&EMPTY_SLOT.has((nodes[id] as {tag:string}).tag)));
  if(hasText)continue;
  containers.push({nodeId:el.id,tag:el.tag,logical:'',map:[],hidden:el.hidden,preserveWhitespace:el.tag==='pre'});
 }
 containers.sort((a,b)=>a.nodeId-b.nodeId);
 return {containers,unmappableNodes};
}

export function rangesForLogical(container:TextContainer,lStart:number,lEnd:number):SourceRange[] {
 const ranges:SourceRange[]=[];
 // 负起点此前不钳:lStart<0 时 map[i] 为 undefined,读 m.nodeId 直接抛 TypeError
 // (审计 round4 BUG 19)。上界仍按历史行为钳到映射长度(调用方会传整段逻辑长度),
 // 但非法起点一律返回空区间:静默把 -1 收敛成 0 会让"越界编辑"落在容器开头。
 if(!Number.isFinite(lStart)||!Number.isFinite(lEnd)||lStart<0)return ranges;
 const from=Math.floor(lStart);
 const to=Math.min(container.map.length,Math.floor(lEnd));
 for(let i=from;i<to;i++){
  const m=container.map[i];
  const last=ranges[ranges.length-1];
  if(last&&last.nodeId===m.nodeId&&last.srcEnd===m.srcStart)last.srcEnd=m.srcEnd;
  else ranges.push({nodeId:m.nodeId,srcStart:m.srcStart,srcEnd:m.srcEnd});
 }
 return ranges;
}

export type LogicalReplaceResult=
 |{ok:true; patch:TextPatch}
 |{ok:false; reason:'cross-node'|'out-of-range'|'empty-range'; ranges:SourceRange[]};

// 单节点内的逻辑区间替换生成精确 TextPatch（替换文本按文字转义）。
// 跨节点命中返回 false 与源区间列表，由段落编辑（F20）或映射分配逻辑处理。
export function replaceLogical(index:SourceIndex,container:TextContainer,lStart:number,lEnd:number,replacement:string):LogicalReplaceResult {
 if(lStart<0||lEnd>container.logical.length||lStart>lEnd)return {ok:false,reason:'out-of-range',ranges:[]};
 const ranges=rangesForLogical(container,lStart,lEnd);
 if(!ranges.length)return {ok:false,reason:'empty-range',ranges};
 if(ranges.length>1)return {ok:false,reason:'cross-node',ranges};
 const r=ranges[0];
 return {ok:true,patch:{start:r.srcStart,end:r.srcEnd,expected:index.source.slice(r.srcStart,r.srcEnd),replacement:escapeText(replacement)}};
}
