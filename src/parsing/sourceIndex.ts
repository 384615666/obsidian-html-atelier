import {parse} from 'parse5';

// 源码位置索引（报告 §12.3）：基于 parse5 的 sourceCodeLocationInfo 建立全文档节点登记，
// 供 TextMap、属性编辑（F08）与源码定位（F19）共用。parse5 只用于解析与源位置，
// 永远不用它的序列化结果覆盖用户文件。
export interface SourceAttr {
 name:string;value:string;
 start:number;end:number;       // 属性名(或 name=value)的源区间
 hasEqual:boolean;              // 源码中是否存在 '=';false 为布尔属性,写值需插入 ="value"
 valueStart:number;valueEnd:number;
 quote:'"'|"'"|'';
}

interface ElementNode {
 kind:'element';id:number;tag:string;
 start:number;end:number;
 startTagStart:number;startTagEnd:number;
 endTagStart:number|null;endTagEnd:number|null;
 attrs:SourceAttr[];
 parentId:number|null;childIds:number[];
 hidden:boolean;excluded:boolean;synthetic:boolean;
}
interface TextNode {
 kind:'text';id:number;
 start:number;end:number;
 raw:string;    // 原始切片（保留实体拼写与 CRLF）
 value:string;  // parse5 解码后的文本（规范解码，CRLF 归一为 LF）
 parentId:number;
 hidden:boolean;excluded:boolean;
}
interface CommentNode {kind:'comment';id:number;start:number;end:number;parentId:number|null}
export type SourceNode=ElementNode|TextNode|CommentNode;
export type TextNodeInfo=TextNode;

interface P5Node {
 nodeName:string;tagName?:string;value?:string;data?:string;
 attrs?:{name:string;value:string}[];
 childNodes?:P5Node[];
 sourceCodeLocation?:{
  startOffset:number;endOffset:number;
  startTag?:{startOffset:number;endOffset:number};
  endTag?:{startOffset:number;endOffset:number}|null;
  attrs?:Record<string,{startOffset:number;endOffset:number}>;
 }|null;
}

const EXCLUDED=new Set(['script','style','noscript','template','textarea','select','option','svg','math','title','head','iframe','object','embed','canvas']);
// hidden 判定只看真实的属性声明(属性名 display/visibility + 对应值),
// 不做全文正则,避免 url(display:none.png) 之类被误判(audit/parsing R8)。
function styleAttrHides(styleValue:string):boolean {
 for(const decl of styleValue.split(';')){
  const idx=decl.indexOf(':');
  if(idx<0)continue;
  const prop=decl.slice(0,idx).trim().toLowerCase();
  const value=decl.slice(idx+1).trim().toLowerCase();
  if(prop==='display'&&value==='none')return true;
  if(prop==='visibility'&&value==='hidden')return true;
 }
 return false;
}

interface AttrToken {name:string; nameStart:number; nameEnd:number; hasEqual:boolean; valueStart:number; valueEnd:number; quote:'"'|"'"|''}

// 启动标签属性分词器(audit/parsing R1/R2/R3):
// parse5 的 attr 位置在"无空格相邻属性"场景只覆盖属性名(audit 实测 a="1"b="2" → [5,6)),
// 不能作为取值区间的依据;这里独立扫描启动标签,得到每个属性的准确区间。
// 输入区间是整个启动标签(含 < 和 >)。
function tokenizeStartTag(source:string,tagStart:number,tagEnd:number):AttrToken[] {
 const tokens:AttrToken[]=[];
 let i=tagStart+1; // 跳过 '<'
 while(i<tagEnd&&!/[\s/>]/.test(source[i]))i++; // 标签名
 while(i<tagEnd){
  while(i<tagEnd&&/\s/.test(source[i]))i++;
  if(i>=tagEnd||source[i]==='>'||source[i]==='/')break;
  const nameStart=i;
  while(i<tagEnd&&!/[\s=>]/.test(source[i]))i++;
  if(i===nameStart){i++;continue;}
  const nameEnd=i;
  let j=i;
  while(j<tagEnd&&/\s/.test(source[j]))j++;
  if(source[j]==='='){
   j++;
   while(j<tagEnd&&/\s/.test(source[j]))j++;
   const q=source[j];
   if(q==='"'||q==="'"){
    let k=j+1;
    while(k<tagEnd&&source[k]!==q)k++;
    tokens.push({name:source.slice(nameStart,nameEnd).toLowerCase(),nameStart,nameEnd,hasEqual:true,
     valueStart:j+1,valueEnd:Math.min(k,tagEnd),quote:q});
    i=Math.min(k+1,tagEnd);
   }else{
    let k=j;
    while(k<tagEnd&&!/[\s>]/.test(source[k]))k++;
    tokens.push({name:source.slice(nameStart,nameEnd).toLowerCase(),nameStart,nameEnd,hasEqual:true,
     valueStart:j,valueEnd:k,quote:''});
    i=k;
   }
  }else{
   // 布尔(无值)属性:值区间是空集,锚在属性名之后;写值必须以 ="value" 形式插入
   tokens.push({name:source.slice(nameStart,nameEnd).toLowerCase(),nameStart,nameEnd,hasEqual:false,
    valueStart:nameEnd,valueEnd:nameEnd,quote:''});
   i=nameEnd;
  }
 }
 return tokens;
}

export class SourceIndex {
 readonly nodes:SourceNode[]=[];
 constructor(readonly source:string){this.build();}

 get root(){return this.nodes[0];}
 node(id:number):SourceNode|undefined{return this.nodes[id];}
 elements(tag?:string):ElementNode[] {
  return this.nodes.filter((n):n is ElementNode=>n.kind==='element'&&(!tag||n.tag===tag));
 }
 textNodes():TextNode[]{return this.nodes.filter((n):n is TextNode=>n.kind==='text');}

 private element(node:P5Node,parentId:number|null,ancestorsExcluded:boolean,ancestorsHidden:boolean,depth:number):ElementNode {
  const loc=node.sourceCodeLocation??null;
  const tag=(node.tagName??'').toLowerCase();
  const synthetic=!loc;
  const start=loc?.startOffset??-1,end=loc?.endOffset??-1;
  const styleAttr=node.attrs?.find(a=>a.name==='style')?.value??'';
  const selfHidden=!!(ancestorsHidden
   ||node.attrs?.some(a=>a.name==='hidden')
   ||(!!styleAttr&&styleAttrHides(styleAttr))
   ||(tag==='input'&&node.attrs?.some(a=>a.name==='type'&&a.value?.toLowerCase()==='hidden')));
  const el:ElementNode={kind:'element',id:this.nodes.length,tag,start,end,
   startTagStart:loc?.startTag?.startOffset??start,startTagEnd:loc?.startTag?.endOffset??end,
   endTagStart:loc?.endTag?.startOffset??null,endTagEnd:loc?.endTag?.endOffset??null,
   attrs:[],parentId,childIds:[],hidden:selfHidden,
   excluded:ancestorsExcluded||EXCLUDED.has(tag),synthetic};
  this.nodes.push(el);
  if(loc&&node.attrs&&el.startTagEnd>el.startTagStart){
   const tokens=tokenizeStartTag(this.source,el.startTagStart,el.startTagEnd);
   // 重复属性按规范取**第一个**:parse5 也丢弃后续同名属性,若这里取最后一个,
   // 暴露出来的 valueStart/valueEnd 会指向另一次出现,属性编辑必然被
   // "内容已变化"拒绝(审计 round4 BUG 17)
   const byName=new Map<string,AttrToken>();
   for(const t of tokens)if(!byName.has(t.name))byName.set(t.name,t);
   for(const a of node.attrs){
    const loc2=loc.attrs?.[a.name];
    const t=byName.get(a.name);
    if(t){
     el.attrs.push({name:a.name,value:a.value,start:t.nameStart,end:t.nameEnd,hasEqual:t.hasEqual,
      valueStart:t.valueStart,valueEnd:t.valueEnd,quote:t.quote});
    }else if(loc2){
     // 分词器未覆盖(合成/异常结构):退回 parse5 区间,值为空区间,不允许原地改值
     el.attrs.push({name:a.name,value:a.value,start:loc2.startOffset,end:loc2.endOffset,hasEqual:false,
      valueStart:loc2.endOffset,valueEnd:loc2.endOffset,quote:''});
    }
   }
  }
  const selfExcluded=el.excluded;
  for(const child of node.childNodes??[]){
   if(child.nodeName==='#text'){
    const id=this.text(child,el.id,selfExcluded,selfHidden);
    if(id!==null)el.childIds.push(id);
   }else if(child.nodeName==='#comment'){
    const cloc=child.sourceCodeLocation;
    const id=this.nodes.length;
    this.nodes.push({kind:'comment',id,start:cloc?.startOffset??-1,end:cloc?.endOffset??-1,parentId:el.id});
    el.childIds.push(id);
   }else el.childIds.push(this.element(child,el.id,selfExcluded,selfHidden,depth+1).id);
  }
  return el;
 }

 // 返回登记后的节点 id;合成节点无源位置时不登记,返回 null。
 // childIds 必须真正填充:大纲标题文字、<style> 内 CSS 重写、<picture> 检测都依赖它
 // (audit/复检 §3.16/§3.18:此前恒为空数组,三处功能同时失效)。
 private text(node:P5Node,parentId:number,excluded:boolean,hidden:boolean):number|null {
  const loc=node.sourceCodeLocation;
  if(!loc)return null;
  const raw=this.source.slice(loc.startOffset,loc.endOffset);
  const id=this.nodes.length;
  this.nodes.push({kind:'text',id,start:loc.startOffset,end:loc.endOffset,
   raw,value:node.value??raw,parentId,hidden,excluded});
  return id;
 }

 private build(){
  const doc=parse(this.source,{sourceCodeLocationInfo:true}) as unknown as P5Node;
  this.element(doc,null,false,false,0);
 }
}
