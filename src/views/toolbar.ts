import {Menu, setIcon} from 'obsidian';
import type {Translator} from '../i18n';

// 工具栏的**唯一**实现(视图内与侧栏面板共用)。
// editor.toolbarPlacement 决定它渲染在哪里:'view' 时挂在文件视图顶部,
// 'sidebar' 时挂在 HTML Atelier 右侧栏面板顶部。两处必须是同一份 DOM 结构与
// 同一套状态刷新逻辑——各自复制一份的话,按钮的禁用条件迟早会漂移。

export type ToolbarMode='preview'|'edit'|'source'|'split';

// 工具栏的作用对象。视图自己就是一个目标;面板则由宿主解析"当前活动 HTML 视图"
// 后转交给它。所有方法都必须在调用时读取实时状态(不是快照),因此每次刷新
// 都会重新求值。
export interface ToolbarTarget {
 hasFile():boolean;
 title():string;
 dirty():boolean;
 canBack():boolean;
 canForward():boolean;
 goBack():void;
 goForward():void;
 mode():ToolbarMode;
 setMode(mode:ToolbarMode):void;
 refreshPreview():void;
 canSave():boolean;
 save():void;
 widthMenu(anchor:HTMLElement):void;
 zoomMenu(anchor:HTMLElement):void;
 moreMenu(anchor:HTMLElement):void;
}

export interface ToolbarOptions {
 // 视图内显示文件名与脏标记;侧栏面板上方已有文件名、下方已有状态行
 showTitle:boolean;
 // 侧栏面板状态行自带保存按钮,不再重复一个
 showSave:boolean;
}

// 没有活动 HTML 视图时的空目标:按钮全部禁用,菜单不弹出
export function disabledTarget():ToolbarTarget {
 return {
  hasFile:()=>false,title:()=>'',dirty:()=>false,
  canBack:()=>false,canForward:()=>false,goBack:()=>{},goForward:()=>{},
  mode:()=>'preview',setMode:()=>{},refreshPreview:()=>{},
  canSave:()=>false,save:()=>{},
  widthMenu:()=>{},zoomMenu:()=>{},moreMenu:()=>{},
 };
}

// 菜单弹在按钮下方。此前宽度菜单用 showAtMouseEvent(合成事件在 0,0),
// 于是它永远出现在屏幕左上角,与按下的按钮毫无关系——在窄侧栏里尤其难用。
export function showMenuAt(menu:Menu,anchor:HTMLElement):void {
 const rect=anchor.getBoundingClientRect();
 const doc=anchor.ownerDocument;
 const win=doc.defaultView??window;
 menu.showAtPosition({x:rect.left+win.scrollX,y:rect.bottom+win.scrollY},doc);
}

export class ViewToolbar {
 readonly el:HTMLElement;
 private labels:{el:HTMLElement;key:Parameters<Translator>[0]}[]=[];
 private backEl!:HTMLButtonElement;
 private forwardEl!:HTMLButtonElement;
 private titleEl:HTMLElement|null=null;
 private dirtyEl:HTMLElement|null=null;
 private modes:Partial<Record<ToolbarMode,HTMLElement>>={};
 private saveEl:HTMLButtonElement|null=null;

 constructor(parent:HTMLElement,private getTarget:()=>ToolbarTarget,t:Translator,opts:ToolbarOptions){
  this.el=parent.createDiv({cls:'html-atelier-toolbar'});
  const btn=(host:HTMLElement,key:Parameters<Translator>[0],icon:string,run:(el:HTMLButtonElement)=>void,cls='')=>{
   const b=host.createEl('button',{cls:'html-atelier-button '+cls,attr:{'aria-label':t(key),title:t(key),'type':'button'}});
   const i=b.createSpan();setIcon(i,icon);
   b.addEventListener('click',()=>run(b));
   this.labels.push({el:b,key});
   return b;
  };
  this.backEl=btn(this.el,'tbBack','arrow-left',()=>this.getTarget().goBack());
  this.forwardEl=btn(this.el,'tbForward','arrow-right',()=>this.getTarget().goForward());
  if(opts.showTitle){
   this.titleEl=this.el.createSpan({cls:'html-atelier-filetitle'});
   this.dirtyEl=this.el.createSpan({cls:'html-atelier-dirtydot',attr:{'aria-hidden':'true'},text:'●'});
  }
  const modes=this.el.createDiv({cls:'html-atelier-modes'});
  const modeButtons:[ToolbarMode,Parameters<Translator>[0],string][]=[
   ['preview','tbPreview','eye'],['edit','tbEdit','mouse-pointer-2'],
   ['source','tbSource','code-2'],['split','tbSplit','columns-2'],
  ];
  for(const [mode,key,icon] of modeButtons){
   const b=btn(modes,key,icon,()=>this.getTarget().setMode(mode));
   const label=b.createSpan({cls:'html-atelier-mode-label',text:t(key)});
   this.labels.push({el:label,key});
   this.modes[mode]=b;
  }
  const actions=this.el.createDiv({cls:'html-atelier-actions'});
  btn(actions,'tbRefresh','refresh-cw',()=>this.getTarget().refreshPreview());
  btn(actions,'tbWidth','rectangle-horizontal',el=>this.getTarget().widthMenu(el));
  btn(actions,'tbZoom','zoom-in',el=>this.getTarget().zoomMenu(el));
  btn(actions,'tbMore','more-horizontal',el=>this.getTarget().moreMenu(el));
  if(opts.showSave)this.saveEl=btn(actions,'tbSave','save',()=>this.getTarget().save(),'html-atelier-save');
 }

 // 状态刷新。目标可能随时变化(面板的"活动视图"),所以每次重新取。
 refresh():void {
  const t=this.getTarget();
  const hasFile=t.hasFile();
  if(this.titleEl){this.titleEl.setText(t.title());this.titleEl.toggleClass('html-atelier-hidden',!hasFile);}
  if(this.dirtyEl)this.dirtyEl.toggleClass('html-atelier-hidden',!t.dirty());
  const mode=t.mode();
  for(const [k,el] of Object.entries(this.modes)){
   const active=hasFile&&mode===k;
   el.toggleClass('html-atelier-active',active);
   el.setAttribute('aria-pressed',String(active));
  }
  this.backEl.disabled=!t.canBack();
  this.forwardEl.disabled=!t.canForward();
  if(this.saveEl)this.saveEl.disabled=!t.canSave();
 }

 // 语言切换后重新求值(可视部分只有图标,文字在 aria-label 上)
 relabel(t:Translator):void {
  for(const {el,key} of this.labels){
   if(el.classList.contains('html-atelier-mode-label'))el.setText(t(key));
   else{el.setAttribute('aria-label',t(key));el.setAttribute('title',t(key));}
  }
 }

 destroy():void {this.el.remove();}
}
