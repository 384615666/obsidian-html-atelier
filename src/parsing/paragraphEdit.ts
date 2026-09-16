import {SourceIndex} from './sourceIndex';
import {TextContainer,buildTextMap,rangesForLogical} from './textMap';
import {TextPatch} from '../core/patch';
import {escapeText} from './escape';

// 整段编辑的补丁规划(F20,报告 §9.2/§12.3)。
// 单独成模块的原因:这段算法原先内嵌在侧栏视图的私有方法里,审计探针只能"忠实转写"一份
// 副本来验证,于是修复无法被探针观察到(round4 BUG 1/BUG 11 即因此长期存活)。
// 抽成纯函数后,单元测试与探针都直接调用同一实现。

// 字素簇切分:优先 Intl.Segmenter(ZWJ 家庭序列、肤色修饰符、旗帜都不拆),
// 无 Segmenter 时退化为按码点切分——两者都不会切开代理对。
export function graphemes(text:string):string[] {
 const Seg=(Intl as unknown as {Segmenter?:new(locale?:string,opts?:{granularity:'grapheme'})=>{segment:(s:string)=>Iterable<{segment:string}>}}).Segmenter;
 if(Seg){
  try{return [...new Seg(undefined,{granularity:'grapheme'}).segment(text)].map(s=>s.segment);}
  catch{/* 环境不支持时退化为码点 */}
 }
 return [...text];
}

// 逻辑偏移 → 源偏移。落在字符上取该字符起点;落在末尾时取末字符终点;
// 空容器没有可插入点,返回 null(绝不猜偏移)。
export function boundaryOffset(container:TextContainer,logicalIndex:number):number|null {
 const map=container.map;
 if(!map.length)return null;
 if(logicalIndex>=map.length)return map[map.length-1].srcEnd;
 return map[Math.max(0,logicalIndex)].srcStart;
}

// 按源偏移定位容器:文本对象可能重名(两个内容相同的段落),按内容查找必然命中第一个。
// 调用方持有 segment 的源偏移,用它可以精确落到用户实际编辑的那一段(round4 BUG 9)。
// 字符区间精确命中失败时按"偏移所属文字节点 → 映射了该节点字符的容器"回退:
// 缩进排版的真实文档里,段落文字节点几乎都以换行+空白开头,折叠空白被丢弃后
// node.start 指向映射空隙,严格按字符区间判定恒为 -1 —— 整段编辑对这类段落
// 此前是静默无效(用户实测 2026-09-16,文档里 1141 个容器无一覆盖 intro 段)。
function containerIndexForOffsetIn(map:TextContainer[],offset:number,index?:SourceIndex):number{
 for(let i=0;i<map.length;i++)if(map[i].map.some(m=>offset>=m.srcStart&&offset<m.srcEnd))return i;
 if(index){
  const node=index.nodes.find(n=>n.kind==='text'&&n.start!==null&&n.start<=offset&&n.end!==null&&offset<n.end);
  if(node)for(let i=0;i<map.length;i++)if(map[i].map.some(m=>m.nodeId===node.id))return i;
 }
 return -1;
}

export function containerForOffset(map:TextContainer[],offset:number,index?:SourceIndex):TextContainer|null {
 const i=containerIndexForOffsetIn(map,offset,index);
 return i<0?null:map[i];
}

export function containerIndexForOffset(map:TextContainer[],offset:number,index?:SourceIndex):number {
 return containerIndexForOffsetIn(map,offset,index);
}

// 逻辑区间 → 补丁集合。返回空数组表示"没有可应用的改动"。
export function planParagraphEdit(index:SourceIndex,container:TextContainer,
 lStart:number,lEnd:number,replacement:string):TextPatch[]{
 // 逻辑区间先钳到合法范围:负数下标此前会一路传进 rangesForLogical 并抛 TypeError(round4 缺陷 19)
 const from=Math.max(0,Math.min(lStart,container.logical.length));
 const to=Math.max(from,Math.min(lEnd,container.logical.length));
 const oldLogical=container.logical.slice(from,to);
 // F20:公共前后缀对齐——只有真正变化的中段落入源码补丁,未变文字保持原节点分布
 let prefix=0;
 const maxPrefix=Math.min(oldLogical.length,replacement.length);
 while(prefix<maxPrefix&&oldLogical[prefix]===replacement[prefix])prefix++;
 let suffix=0;
 const maxSuffix=Math.min(oldLogical.length-prefix,replacement.length-prefix);
 while(suffix<maxSuffix&&oldLogical[oldLogical.length-1-suffix]===replacement[replacement.length-1-suffix])suffix++;
 const oldMidStart=from+prefix,oldMidEnd=to-suffix;
 const midNew=replacement.slice(prefix,replacement.length-suffix);
 // 逻辑文本里的 '\n' 在非 preserve 容器中代表换行:必须写成 <br>,否则预览里只是一个空格
 // (round4 缺陷 43:回车插入的裸 \n 不换行,与提示文案矛盾)。
 const emit=(text:string)=>container.preserveWhitespace
  ?escapeText(text)
  :text.split('\n').map(escapeText).join('<br>');
 // 纯插入:公共前后缀吃掉整个区间,中段塌成零长度,rangesForLogical 返回空。
 // 定位到边界所在的源偏移做零长度插入,文字落在同一内联节点内。
 // (早期版本把 `if(!ranges.length)return` 放在这里之前,导致这个分支永远不可达,
 //  纯空白段落与清空段落都写不回去 —— round4 BUG 2/BUG 11。)
 if(oldMidStart>=oldMidEnd){
  if(!midNew)return [];
  let at=boundaryOffset(container,oldMidStart);
  if(at===null){
   // 已被清空的容器没有可映射字符:插到开始标签之后,让清空过的段落还能再写入
   const el=index.nodes[container.nodeId];
   if(el&&el.kind==='element')at=el.startTagEnd;
  }
  if(at===null)return [];
  return [{start:at,end:at,expected:'',replacement:emit(midNew)}];
 }
 const midRanges=rangesForLogical(container,oldMidStart,oldMidEnd);
 if(!midRanges.length)return [];
 // 把中段按"空隙里是否只有 <br>"切成块,块内整体替换。
 // 为什么必须成块:rangesForLogical 给 <br> 的源码区间是整个标签却只贡献 1 个逻辑字符,
 // 逐区间替换必然产生"变长 + 与相邻区间共享边界"的补丁组合,patch.ts 的相邻防护会拒绝
 // 整个事务——含换行的段落因此完全不可编辑(round4 BUG 1:63/63 被拒)。
 // 成块后每块只有一个补丁,块与块之间隔着内联标签,既不再共享边界,也保住了内联结构。
 const blocks:{from:number;to:number}[]=[];
 for(const r of midRanges){
  const last=blocks[blocks.length-1];
  if(last){
   const gap=index.source.slice(last.to,r.srcStart);
   if(!/<(?!\/?br[\s/>])/i.test(gap)){last.to=r.srcEnd;continue;}
  }
  blocks.push({from:r.srcStart,to:r.srcEnd});
 }
 const patches:TextPatch[]=[];
 // 按字素簇而非 UTF-16 码元推进分配指针:按码元比例切分会在 emoji 处把代理对劈到
 // 两个内联节点里,写出孤立代理项(审计复检 §3.2)。
 const units=graphemes(midNew);
 const totalUnits=units.length;
 const totalOld=blocks.reduce((n,b)=>n+(b.to-b.from),0)||1;
 let usedUnits=0;
 let consumed=0;
 blocks.forEach((b,i)=>{
  const len=b.to-b.from;
  consumed+=len;
  // 累计比例取整避免逐步取整的漂移;最后一块吃掉余数,保证总量精确
  const want=i===blocks.length-1?totalUnits-usedUnits:Math.round(totalUnits*(consumed/totalOld))-usedUnits;
  const share=Math.max(0,want);
  const slice=units.slice(usedUnits,usedUnits+share).join('');
  usedUnits+=share;
  const expected=index.source.slice(b.from,b.to);
  const next=emit(slice);
  if(next!==expected)patches.push({start:b.from,end:b.to,expected,replacement:next});
 });
 return patches;
}

// 便捷入口:直接按文件路径与逻辑区间计算补丁(探针与测试用)。
export function planParagraphEditByText(source:string,containerIndex:number,
 lStart:number,lEnd:number,replacement:string):TextPatch[]{
 const index=new SourceIndex(source);
 const map=buildTextMap(index).containers;
 const c=map[containerIndex];
 if(!c)return [];
 return planParagraphEdit(index,c,lStart,lEnd,replacement);
}
