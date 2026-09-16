const w=window as any;
const proto=HTMLElement.prototype as any;
proto.empty=function(){this.replaceChildren();};proto.addClass=function(...c:string[]){this.classList.add(...c);};proto.setText=function(t:string){this.textContent=t;};
proto.toggleClass=function(c:string,force?:boolean){if(force===undefined)this.classList.toggle(c);else this.classList.toggle(c,force);return this;};proto.setStyle=function(k:string,v:string){this.style.setProperty(k,v);return this;};proto.toggle=function(show?:boolean){if(show===undefined)this.hidden=!this.hidden;else this.hidden=!show;return this;};proto.createEl=function(tag:string,opts:any={}){const el=document.createElement(tag);if(opts.text)el.textContent=opts.text;if(opts.cls)el.className=opts.cls;for(const [k,v] of Object.entries(opts.attr||{}))el.setAttribute(k,String(v));this.append(el);return el;};
for(const [method,tag] of [['createDiv','div'],['createSpan','span']])proto[method]=function(opts:any={}){return this.createEl(tag,opts);};
// 宿主(Obsidian)会给 HTMLElement 全局注入 setCssProps(EmbedRenderChild 挂载时用);
// mock 缺它会让嵌入了 iframe 的探针在 onload 处崩掉(2026-09-16 补齐)。
proto.setCssProps=function(props:Record<string,string|null|undefined>){for(const [k,v] of Object.entries(props??{})){if(v===null||v===undefined)this.style.removeProperty(k);else this.style.setProperty(k,String(v));}return this;};
// extension 必须按路径推导:此前硬编码 'html',于是"打开一个 .md 文件"在桩里仍然是
// html —— 依赖文件类型的判定(如"当前文档还是不是 HTML")在浏览器探针里永远测不出错。
export class TFile {path:string;name:string;basename:string;extension:string;parent={path:'demo'};
 constructor(path:string){this.path=path;this.name=path.split('/').pop()!;
  const m=this.name.match(/\.([^.]+)$/);this.extension=(m?m[1]:'').toLowerCase();
  this.basename=m?this.name.slice(0,-(m[0].length)):this.name;}}
export class ItemView {contentEl:HTMLElement;app:any;constructor(public leaf:any){this.app=leaf.app;this.contentEl=leaf.el;}async onOpen(){}getViewType(){return '';}}
// navigation:宿主的 View.navigation —— 文档视图为 true,侧栏 ItemView 为 false。
// getActiveFile 的回退逻辑依赖它(见 main.ts 的 htmlStillActive 说明),桩必须带上。
export class FileView extends ItemView {file:TFile|null=null;navigation=true;}
export class Plugin {app=w.testApp;factories=new Map();commands:any[]=[];async loadData(){return w.savedPluginData??null;}async saveData(d:any){w.savedPluginData=JSON.parse(JSON.stringify(d));}registerView(t:string,fn:any){this.factories.set(t,fn);}registerExtensions(){}registerMarkdownCodeBlockProcessor(lang:string,fn:any){w.codeBlockProcessors=(w.codeBlockProcessors??[]).filter((x:any)=>x.lang!==lang);w.codeBlockProcessors.push({lang,fn});}addSettingTab(){}registerDomEvent(){}addCommand(c:any){this.commands.push(c);}registerEvent(e:any){} }
export class Modal {contentEl=document.createElement('div');titleEl=document.createElement('h2');constructor(public app:any){}open(){document.body.append(this.contentEl);(this as any).onOpen();}close(){this.contentEl.remove();}}
export class Notice {constructor(message:string){w.notices.push(message);}}
export function setIcon(el:HTMLElement,icon:string){el.setAttribute('data-icon',icon);el.textContent=({eye:'◉','mouse-pointer-2':'↖','undo-2':'↶',save:'▣','rotate-ccw':'↶','text-cursor-input':'I'} as any)[icon]||'◇';}
export class WorkspaceLeaf {}

// ===== 2.0 harness 扩展 =====
// 菜单 mock:按结构记录条目(标题 + 回调)与弹出坐标。探针需要验证"菜单弹在按下的
// 按钮下方"以及"点菜单项真的改到视图",平铺的 items 既读不出回调也读不出位置。
export interface MockMenuItem {title:string; onClick:(()=>void)|null}
export class Menu {items:MockMenuItem[]=[];shownAt:{x:number;y:number}|null=null;
 constructor(){((globalThis as {__menus?:Menu[]}).__menus??=[]).push(this);}
 addItem(fn:(i:unknown)=>void){const item:MockMenuItem={title:'',onClick:null};
  const api={setTitle:(t:string)=>{item.title=t;return api;},setIcon:()=>api,
   onClick:(cb:()=>void)=>{item.onClick=cb;return api;},setDisabled:()=>api};
  fn(api);this.items.push(item);return this;}
 addSeparator(){}
 showAtPosition(pos?:{x?:number;y?:number}){this.shownAt={x:pos?.x??0,y:pos?.y??0};
  ((globalThis as {__menuShows?:unknown[]}).__menuShows??=[]).push({...this.shownAt,titles:this.items.map(i=>i.title)});}
 showAtMouseEvent(evt?:{clientX?:number;clientY?:number}){this.shownAt={x:evt?.clientX??0,y:evt?.clientY??0};}}
export class SuggestModal{contentEl=document.createElement('div');constructor(public app:any){}open(){(this as any).onOpen?.();}close(){}}
export class FuzzySuggestModal extends SuggestModal{}
export class TFolder{path='';}
export class MarkdownView{editor={replaceSelection(){}};containerEl=document.createElement('div');navigation=true;file:any=null;getViewType(){return 'markdown';}}
export class PluginSettingTab{containerEl=document.createElement('div');constructor(public app:any,public plugin:any){}display(){}hide(){}}
export class MarkdownRenderChild{constructor(public containerEl:HTMLElement){}onload(){}onunload(){}}
export function debounce(fn:(...a:any[])=>void,ms:number){let t:any=null;const g=(...a:any[])=>{if(t)clearTimeout(t);t=setTimeout(()=>{t=null;fn(...a);},ms);};(g as any).cancel=()=>{if(t)clearTimeout(t);t=null;};(g as any).run=fn;return g;}
export class Scope{}
export class Component{addChild(){return {};}}
// 设置项 mock:渲染出真实 DOM(名称/说明 + 真控件)并保留链式 API。
// 此前 addToggle/addText/addDropdown 只回调一个空壳、什么都不渲染,于是**设置页**
// (用户直接面对的一页)在浏览器探针里完全看不见 —— "下拉里显示的是不是本地化文字"
// 这类问题也就无从验证(用户反馈 2026-09-15)。
export class Setting{
 el:HTMLElement;
 nameEl:HTMLElement;
 descEl:HTMLElement;
 controlEl:HTMLElement;
 constructor(containerEl?:HTMLElement){
  this.el=document.createElement('div');this.el.className='setting-item';
  this.nameEl=document.createElement('div');this.nameEl.className='setting-item-name';
  this.descEl=document.createElement('div');this.descEl.className='setting-item-description';
  const info=document.createElement('div');info.className='setting-item-info';
  info.append(this.nameEl,this.descEl);
  this.controlEl=document.createElement('div');this.controlEl.className='setting-item-control';
  this.el.append(info,this.controlEl);
  if(containerEl)containerEl.append(this.el);
 }
 setName(n:string){this.nameEl.textContent=n;return this;}
 setDesc(d:string){this.descEl.textContent=d;return this;}
 setHeading(){this.el.classList.add('setting-item-heading','setting-item-name-only');return this;}
 setClass(c:string){this.el.classList.add(c);return this;}
 addDropdown(fn:(d:unknown)=>void){
  const select=document.createElement('select');
  const api={addOption:(v:string,label?:string)=>{const o=document.createElement('option');o.value=v;o.textContent=label??v;select.append(o);return api;},
   setValue:(v:string)=>{select.value=v;return api;},
   getValue:()=>select.value,
   onChange:(cb:(v:string)=>void)=>{select.addEventListener('change',()=>cb(select.value));return api;}};
  this.controlEl.append(select);
  fn(api);
  return this;
 }
 addToggle(fn:(t:unknown)=>void){
  const box=document.createElement('input');box.type='checkbox';
  const api={setValue:(v:boolean)=>{box.checked=v;return api;},
   getValue:()=>box.checked,
   onChange:(cb:(v:boolean)=>void)=>{box.addEventListener('change',()=>cb(box.checked));return api;}};
  this.controlEl.append(box);
  fn(api);
  return this;
 }
 addText(fn:(t:unknown)=>void){
  const input=document.createElement('input');input.type='text';
  const api={setValue:(v:string)=>{input.value=v;return api;},
   getValue:()=>input.value,
   onChange:(cb:(v:string)=>void)=>{input.addEventListener('input',()=>cb(input.value));return api;}};
  this.controlEl.append(input);
  fn(api);
  return this;
 }
}
