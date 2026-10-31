import {parse, serialize} from 'parse5';

export interface Segment {id:string; text:string; start:number; end:number; kind:string}
export interface DocumentModel {source:string; segments:Segment[]}

// 基准段与工作段的对齐结果:base/work 恒至少一方非空。
// 两侧都有 = 修改(或未变);只有 base = 删除;只有 work = 新增。
export interface AlignedSegment {base:Segment|null; work:Segment|null}

// 段 id 是文档顺序流水号(t0,t1,…),只在**同一次解析**内稳定;基准与工作稿一旦
// 增删了文字节点,后续 id 全部错位 —— 按 id 跨源配对会让修改清单出现成串幻影
// 条目、把错误文本恢复进错误段落(实测:清空一个段落,后面每段都"被修改")。
// 对齐策略:先剥公共前后缀(单点编辑的常态,中段为空),中段再按文本相等做 LCS,
// 锚点之间的空档按顺序配对(多改一/多删一落为删除或新增)。
export function alignSegments(base:Segment[],work:Segment[]):AlignedSegment[]{
 const eq=(a:Segment,b:Segment)=>a.text===b.text;
 let p=0;
 while(p<base.length&&p<work.length&&eq(base[p],work[p]))p++;
 let be=base.length,we=work.length;
 while(be>p&&we>p&&eq(base[be-1],work[we-1])){be--;we--;}
 const out:AlignedSegment[]=[];
 for(let i=0;i<p;i++)out.push({base:base[i],work:work[i]});
 const bm=base.slice(p,be),wm=work.slice(p,we);
 const m=bm.length,n=wm.length;
 if(m&&n){
  // LCS,dp 行宽 n+1:中段被前后缀剥到通常很小;极端全重写时 O(mn) 也只算一次
  const dp:Array<Uint16Array>=Array.from({length:m+1},()=>new Uint16Array(n+1));
  for(let i=m-1;i>=0;i--)for(let j=n-1;j>=0;j--)
   dp[i][j]=eq(bm[i],wm[j])?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
  let i=0,j=0;const gapB:Segment[]=[],gapW:Segment[]=[];
  const flush=()=>{
   const k=Math.min(gapB.length,gapW.length);
   for(let x=0;x<k;x++)out.push({base:gapB[x],work:gapW[x]});
   for(let x=k;x<gapB.length;x++)out.push({base:gapB[x],work:null});
   for(let x=k;x<gapW.length;x++)out.push({base:null,work:gapW[x]});
   gapB.length=0;gapW.length=0;
  };
  while(i<m&&j<n){
   if(eq(bm[i],wm[j])){flush();out.push({base:bm[i],work:wm[j]});i++;j++;}
   else if(dp[i+1][j]>=dp[i][j+1]){gapB.push(bm[i]);i++;}
   else{gapW.push(wm[j]);j++;}
  }
  for(;i<m;i++)gapB.push(bm[i]);
  for(;j<n;j++)gapW.push(wm[j]);
  flush();
 }else{
  for(const s of bm)out.push({base:s,work:null});
  for(const s of wm)out.push({base:null,work:s});
 }
 const suffixLen=base.length-be;
 for(let k=0;k<suffixLen;k++)out.push({base:base[be+k],work:work[we+k]});
 return out;
}
interface P5Node {
 nodeName:string;tagName?:string;value?:string;data?:string;
 namespaceURI?:string;
 attrs?:{name:string;value:string}[];
 childNodes?:P5Node[];
 parentNode?:P5Node|null;
 sourceCodeLocation?:{startOffset:number;endOffset:number}|null;
}
const excluded = new Set(['script','style','noscript','template','textarea','select','option','svg','math','title','head','iframe','object','embed','canvas']);
export function parseDocument(source:string):DocumentModel {
 const doc=parse(source,{sourceCodeLocationInfo:true}) as unknown as P5Node;
 const segments:Segment[]=[];
 function visit(node:P5Node, blocked=false, kind='文字') {
  const tag=node.tagName??'';
  blocked=blocked||excluded.has(tag)||!!node.attrs?.some(a=>a.name==='hidden'||a.name==='contenteditable');
  if (/^h[1-6]$/.test(tag)) kind='标题'; else if(tag==='button') kind='按钮'; else if(tag==='a')kind='链接'; else if(tag==='p')kind='段落';
  if(node.nodeName==='#text'&&!blocked&&node.value?.trim()&&node.sourceCodeLocation){
   const l=node.sourceCodeLocation;
   segments.push({id:'t'+segments.length,text:node.value,start:l.startOffset,end:l.endOffset,kind});
  }
  for(const child of node.childNodes??[])visit(child,blocked,kind);
 }
 visit(doc);return {source,segments};
}
export const escapeText=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function applyText(model:DocumentModel, changes:Map<string,string>):string {
 let source=model.source;
 for(const s of [...model.segments].sort((a,b)=>b.start-a.start)){
  const value=changes.get(s.id);
  if(value!==undefined&&value!==s.text)source=source.slice(0,s.start)+escapeText(value)+source.slice(s.end);
 }return source;
}
// 预览滚动条美化:页面自己没写过滚动条外观时,把 Obsidian 默认主题的滚动条样式
// 注入预览文档。iframe 是独立文档,宿主对 ::-webkit-scrollbar 的全局美化够不到里面,
// Chromium 在 Windows 上画出的是带上下箭头的原生经典滚动条。注入只进预览产物
// (embed 同享),绝不写回源文件;节点插在 head 子节点首部(meta/base 之后、页面自己
// 的规则之前),检测漏掉的页面样式(写在模板/脚本/远程样式表里)在级联上天然压过
// 注入规则,不会被覆盖。
// 检测对象是剥掉 script/pre/code/textarea/template/注释后的源文本:讲课稿正文里的
// CSS 示例代码不算"页面自己设置了滚动条";<style>(含预览路径已内联的库内 CSS)保留,
// 是真正生效的样式来源。误报(漏判"有样式")的代价只是维持原生滚动条,方向安全。
// 颜色用 light-dark():判定滚动条明暗用的 used color-scheme 与 Chromium 渲染原生
// 滚动条是同一套,页面声明 color-scheme:dark(或跟随系统深色)时 thumb 反白,不比
// 原生差;每条颜色先落一份纯 rgba 再叠 light-dark(),老引擎不认时退回浅色值。
// 数值取自 Obsidian 默认主题(obsidian.asar):宽高 12px、thumb 以 background-clip:
// padding-box 加 3/2px 透明边框内缩成胶囊、--radius-l(12px) 圆角、min-height 45px、
// thumb 透明度 0.1、hover/active 0.2(light)——mono-rgb-100 在暗色下是 255,255,255。
const SCROLLBAR_HINT_RE=/::-webkit-scrollbar|scrollbar-width|scrollbar-color/i;
const SCROLLBAR_NOISE_RE=/<(?:script|pre|code|textarea|template)\b[\s\S]*?<\/(?:script|pre|code|textarea|template)|<!--[\s\S]*?-->/gi;
const PREVIEW_SCROLLBAR_CSS='::-webkit-scrollbar{background-color:transparent;width:12px;height:12px;border-radius:12px}'
 +'::-webkit-scrollbar-track{background-color:transparent}'
 +'::-webkit-scrollbar-thumb{background-clip:padding-box;border:2px solid transparent;border-width:3px 3px 3px 2px;min-height:45px;border-radius:12px;'
 +'background-color:rgba(0,0,0,.1);background-color:light-dark(rgba(0,0,0,.1),rgba(255,255,255,.1))}'
 +'::-webkit-scrollbar-thumb:hover,::-webkit-scrollbar-thumb:active{background-color:rgba(0,0,0,.2);background-color:light-dark(rgba(0,0,0,.2),rgba(255,255,255,.2))}'
 +'::-webkit-scrollbar-corner{background:transparent}';
function hasOwnScrollbarStyling(source:string):boolean{
 return SCROLLBAR_HINT_RE.test(source.replace(SCROLLBAR_NOISE_RE,''));
}
export function makePreview(model:DocumentModel, base:string, nonce:string, opts?:{allowNetwork?:boolean; allowScripts?:boolean}):string {
 const allowScripts=opts?.allowScripts===true;
 const doc=parse(model.source,{sourceCodeLocationInfo:true}) as unknown as P5Node;
 const byStart=new Map(model.segments.map(s=>[s.start,s]));
 function visit(node:P5Node){
  if(node.attrs)node.attrs=node.attrs.filter(a=>!(a.name.startsWith('on')&&!allowScripts)&&!['contenteditable','autofocus'].includes(a.name));
  if(node.childNodes)node.childNodes=node.childNodes.filter(n=>!['base','iframe','object','embed'].includes(n.tagName??'')&&!(n.tagName==='script'&&!allowScripts)&&!(n.tagName==='meta'&&n.attrs?.some(a=>a.name==='http-equiv')));
  const kids=node.childNodes;
  if(!kids)return;
  for(let i=0;i<kids.length;i++){
   const child=kids[i];const seg=child.nodeName==='#text'?byStart.get(child.sourceCodeLocation?.startOffset??-1):undefined;
   if(seg){kids.splice(i,0,{nodeName:'#comment',data:`html-atelier-text:${nonce}:${seg.id}`,parentNode:node});i++;}else visit(child);
  }
 }visit(doc);
 const safeBase=base.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
 // allowNetwork=false 时拦截远程资源(F17 设置 preview.allowNetworkAssets)
 const remote=opts?.allowNetwork===false?'':' https: http:';
 // allowScripts=true(设置 preview.allowScripts):页面脚本运行在**不透明源**沙箱帧里
 // (sandbox 仅 allow-scripts,无 allow-same-origin,帧与宿主跨源),放开 script-src 与
 // connect-src;嵌套 iframe/表单提交维持拦截。远程脚本/请求仍受 allowNetwork 约束。
 // 不透明源加载不了 app://,本地 <script src>/图片/字体/媒体在预览构建时已内联成
 // data: URL(services/previewAssets.ts),所以 script-src 必须同时允许 data:。
 const policy=allowScripts
  ?`default-src 'none'; img-src app: obsidian: data: blob:${remote}; media-src app: obsidian: data: blob:${remote}; style-src 'unsafe-inline' app: obsidian: data:${remote}; font-src app: obsidian: data:${remote}; script-src 'unsafe-inline' app: blob: data:${remote}; frame-src 'none'; connect-src blob: data:${remote}; form-action 'none'; base-uri app: obsidian:;`
  :`default-src 'none'; img-src app: obsidian: data: blob:${remote}; media-src app: obsidian: data: blob:${remote}; style-src 'unsafe-inline' app: obsidian: data:${remote}; font-src app: obsidian: data:${remote}; script-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri app: obsidian:;`;
 // CSP 与 base 以真实节点插入 head 子节点首部(audit R1:字符串替换 '<head>' 在
 // head 带属性或大小写不同时静默失败);nonce 防止用户源码中的同名注释被当作标记(audit R2)。
 const meta:P5Node={nodeName:'meta',tagName:'meta',attrs:[{name:'http-equiv',value:'Content-Security-Policy'},{name:'content',value:policy}],childNodes:[]};
 const baseEl:P5Node={nodeName:'base',tagName:'base',attrs:[{name:'href',value:safeBase}],childNodes:[]};
 const headKids:P5Node[]=[baseEl,meta];
 if(!hasOwnScrollbarStyling(model.source)){
  const sbStyle:P5Node={nodeName:'style',tagName:'style',namespaceURI:'http://www.w3.org/1999/xhtml',
   attrs:[{name:'data-html-atelier-scrollbar',value:''}],childNodes:[],parentNode:null};
  sbStyle.childNodes!.push({nodeName:'#text',value:PREVIEW_SCROLLBAR_CSS,parentNode:sbStyle});
  headKids.push(sbStyle);
 }
 const head=doc.childNodes?.find(n=>n.tagName==='head');
 if(head?.childNodes){head.childNodes.unshift(...headKids);}
 else{
  const html=doc.childNodes?.find(n=>n.tagName==='html');
  const headEl:P5Node={nodeName:'head',tagName:'head',attrs:[],childNodes:headKids};
  if(html?.childNodes)html.childNodes.unshift(headEl);
  else doc.childNodes?.unshift(headEl);
 }
 return serialize(doc as never);
}

// 预览文字标记的匹配正则:nonce 由调用方在每次渲染时生成,
// 用户源码里恰好长成 html-atelier-text:t0 的注释不会命中(audit R2)。
export function markerRegex(nonce:string):RegExp {
 return new RegExp(`^html-atelier-text:${nonce}:(t\\d+)$`);
}

export class EditSession {
 model:DocumentModel; changes=new Map<string,string>();history:Map<string,string>[]=[];
 selected:string|null=null; mode:'preview'|'edit'='preview';conflict=false;busy=false;
 constructor(source:string){this.model=parseDocument(source);}
 get dirty(){return this.changes.size>0;}
 value(id:string){return this.changes.get(id)??this.model.segments.find(s=>s.id===id)?.text??'';}
 set(id:string,value:string){const seg=this.model.segments.find(s=>s.id===id);if(!seg||this.value(id)===value)return;this.history.push(new Map(this.changes));if(this.history.length>200)this.history.shift();if(value===seg.text)this.changes.delete(id);else this.changes.set(id,value);}
 restore(){if(this.selected){const s=this.model.segments.find(s=>s.id===this.selected);if(s)this.set(s.id,s.text);}}
 undo(){const h=this.history.pop();if(h)this.changes=h;}
 saved(source:string){this.model=parseDocument(source);this.changes.clear();this.history=[];this.selected=null;this.conflict=false;}
}
