import {MarkdownRenderChild,Notice,TFile} from 'obsidian';
import {makePreview,parseDocument} from '../model';

// Markdown 嵌入(F21,§10.1):html-atelier 代码块。
// 阅读模式与 Live Preview 都会调用处理器;组件销毁时清理观察器与 frame。
// 默认展示已保存 HTML;懒加载:视口附近才挂载 iframe。

export {parseEmbedParams} from './params';
import {parseEmbedParams} from './params';
export type {EmbedParams} from './params';

export class EmbedRenderChild extends MarkdownRenderChild {
 private observer:IntersectionObserver|null=null;
 private frame:HTMLIFrameElement|null=null;
 private mounted=false;

 constructor(public app:{vault:{cachedRead(f:TFile):Promise<string>}},containerEl:HTMLElement,private src:string,private sourcePath:string,
  private opts:{showDrafts:boolean; defaultHeight:number; autoHeightMax:number; showToolbar:boolean; nonce:string},
  private hooks:{getFileByPath:(p:string)=>TFile|null; getResourcePath:(f:TFile)=>string;
   openHtml:(path:string)=>void; isDirty:(path:string)=>boolean}){super(containerEl);}

 onload(){
  const {params,error}=parseEmbedParams(this.src);
  const container=this.containerEl.createDiv({cls:'html-atelier-embedbox'});
  if(error||!params||!params.path){
   container.createDiv({cls:'html-atelier-embederror',text:error??'missing path'});
   return;
  }
  const file=this.hooks.getFileByPath(params.path);
  if(!file){
   container.createDiv({cls:'html-atelier-embederror',text:`${params.path} (missing)`});
   return;
  }
  const head=container.createDiv({cls:'html-atelier-embedhead'});
  head.createSpan({cls:'html-atelier-muted',text:file.name});
  if(this.hooks.isDirty(file.path)&&this.opts.showDrafts)head.createSpan({cls:'html-atelier-badge',text:'草稿'});
  if(this.opts.showToolbar&&params.toolbar){
   const open=head.createEl('button',{attr:{type:'button'},text:'打开编辑'});
   open.addEventListener('click',()=>this.hooks.openHtml(file.path));
   const reload=head.createEl('button',{attr:{type:'button'},text:'刷新'});
   reload.addEventListener('click',()=>{this.mounted=false;this.tryMount(true);});
  }
  const host=container.createDiv({cls:'html-atelier-embedhost'});
  const hostProps:Record<string,string>={height:params.height==='auto'?`${this.opts.defaultHeight}px`:`${params.height}px`};
  // width 此前只写进 dataset、没有任何代码消费它(审计复检 §3.8);这里真正应用
  if(params.width!=='auto'){hostProps.width=`${params.width}px`;hostProps['max-width']='100%';hostProps.margin='0 auto';}
  host.setCssProps(hostProps);
  host.dataset.path=file.path;
  host.dataset.anchor=params.anchor??'';
  host.dataset.width=String(params.width);
  host.dataset.height=String(params.height);
  this.observer=new IntersectionObserver(entries=>{
   for(const e of entries)if(e.isIntersecting)this.tryMount();
  },{rootMargin:'200px'});
  this.observer.observe(host);
  this.host=host;
 }

 private host:HTMLElement|null=null;

 private tryMount(force=false){
  if(this.mounted&&!force)return;
  this.mounted=true;
  if(!this.host||!this.fileRef())return;
  const file=this.fileRef()!;
  void this.app;
  const resource=(this.hooks.getResourcePath)(file);
  const base=resource.slice(0,resource.lastIndexOf('/')+1);
  void this.app.vault?.cachedRead(file).then(content=>{
   if(!this.host)return;
   const ds=(this.host as HTMLElement&{dataset:{path:string; anchor:string; width:string; height:string; allow:string}}).dataset;
   this.frame=HtmlAtelierRenderEmbed(this.host,content,base,
    ds.height==='auto'?'auto':Number(ds.height),this.opts.autoHeightMax,true,`${this.opts.nonce}-${ds.anchor||''}`);
   const anchor=ds.anchor;
   if(anchor)this.frame.addEventListener('load',()=>{
    try{this.frame?.contentDocument?.getElementById(anchor)?.scrollIntoView();}catch{/* ignore */}
   });
  }).catch(()=>new Notice('嵌入读取失败'));
 }

 private fileRef():TFile|null{
  if(!this.host)return null;
  const ds=(this.host as HTMLElement&{dataset:{path:string}}).dataset;
  return this.hooks.getFileByPath(ds.path);
 }

 onunload(){
  this.observer?.disconnect();
  this.observer=null;
  this.frame?.remove();
  this.frame=null;
  this.host?.empty();
  this.host=null;
 }
}

// 独立函数便于测试;与 HtmlFileView.renderEmbed 共用 makePreview
export function HtmlAtelierRenderEmbed(container:HTMLElement,content:string,base:string,
 height:number|'auto',maxHeight:number,allowNetwork:boolean,nonce:string):HTMLIFrameElement{
 container.empty();
 const frame=container.createEl('iframe',{cls:'html-atelier-frame html-atelier-embed',attr:{sandbox:'allow-same-origin',referrerpolicy:'no-referrer'}});
 (frame.style).setProperty('height',height==='auto'?'300px':`${height}px`);
 frame.addEventListener('load',()=>{
  if(height!=='auto')return;
  const doc=frame.contentDocument;
  if(!doc)return;
  const h=autoEmbedHeight(frame,doc,maxHeight);
  if(h!==null)(frame.style).setProperty('height',`${h}px`);
 });
 frame.srcdoc=makePreview(parseDocument(content),base,nonce,{allowNetwork});
 return frame;
}

// height:auto 的内容高度测量。
// 不能直接用 documentElement.scrollHeight:iframe 的滚动高度有下限——它自身的视口,
// 于是"先用 300px 占位、再按 scrollHeight 收缩"永远量到 300px,短文档的 auto 高度
// 无法收缩(审计 round4 B20)。测之前先把高度压到下限,滚动高度就只剩内容本身;
// 小于下限的内容反正也只会渲染成下限值,因此压到 160 是安全的。
const EMBED_MIN_HEIGHT=160;

function autoEmbedHeight(frame:HTMLIFrameElement,doc:Document,maxHeight:number):number|null{
 (frame.style).setProperty('height',`${EMBED_MIN_HEIGHT}px`);
 const content=doc.documentElement.scrollHeight;
 if(!Number.isFinite(content))return null;
 return Math.max(EMBED_MIN_HEIGHT,Math.min(maxHeight,content));
}
