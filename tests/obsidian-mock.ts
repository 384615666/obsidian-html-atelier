const w=window as any;
const proto=HTMLElement.prototype as any;
proto.empty=function(){this.replaceChildren();};proto.addClass=function(...c:string[]){this.classList.add(...c);};proto.setText=function(t:string){this.textContent=t;};
proto.createEl=function(tag:string,opts:any={}){const el=document.createElement(tag);if(opts.text)el.textContent=opts.text;if(opts.cls)el.className=opts.cls;for(const [k,v] of Object.entries(opts.attr||{}))el.setAttribute(k,String(v));this.append(el);return el;};
for(const [method,tag] of [['createDiv','div'],['createSpan','span']])proto[method]=function(opts:any={}){return this.createEl(tag,opts);};
export class TFile {path:string;name:string;basename:string;extension='html';parent={path:'demo'};constructor(path:string){this.path=path;this.name=path.split('/').pop()!;this.basename=this.name.replace(/\.html$/,'');}}
export class ItemView {contentEl:HTMLElement;app:any;constructor(public leaf:any){this.app=leaf.app;this.contentEl=leaf.el;}async onOpen(){}getViewType(){return '';}}
export class FileView extends ItemView {file:TFile|null=null;}
export class Plugin {app=w.testApp;factories=new Map();commands:any[]=[];async loadData(){return w.savedPluginData??null;}async saveData(d:any){w.savedPluginData=JSON.parse(JSON.stringify(d));}registerView(t:string,fn:any){this.factories.set(t,fn);}registerExtensions(){}addCommand(c:any){this.commands.push(c);}registerEvent(e:any){} }
export class Modal {contentEl=document.createElement('div');titleEl=document.createElement('h2');constructor(public app:any){}open(){document.body.append(this.contentEl);(this as any).onOpen();}close(){this.contentEl.remove();}}
export class Notice {constructor(message:string){w.notices.push(message);}}
export function setIcon(el:HTMLElement,icon:string){el.setAttribute('data-icon',icon);el.textContent=({eye:'◉','mouse-pointer-2':'↖','undo-2':'↶',save:'▣','rotate-ccw':'↶','text-cursor-input':'I'} as any)[icon]||'◇';}
export class WorkspaceLeaf {}
