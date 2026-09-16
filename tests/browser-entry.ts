import HtmlAtelier from '../src/main';
import {TFile} from 'obsidian';
const w=window as any;w.notices=[];w.savedDraftFiles=new Map();(globalThis as any).moment={locale:()=>'zh-CN'};
const source='<!doctype html><html><head><style>body{margin:0;padding:48px;background:#fbfaf7;color:#344338;font:16px/1.8 system-ui}h1{font-size:42px;line-height:1.5;font-weight:500}p{color:#697268}button{background:none;border:0;padding:0;color:inherit;font:inherit}header{font-size:12px;letter-spacing:2px;margin-bottom:50px}footer{margin-top:70px;border-top:1px solid #dce0d5;padding-top:20px;font-size:12px}</style></head><body><header>STUDIO / 26</header><h1>给好想法，<br>一个生长的地方。</h1><p>收集日常的片段，连接零散的思考。</p><button>看看最近的作品</button><footer>01 / 正在发生</footer><script>window.parent.unwantedScriptRan=true</script></body></html>';
const file=new (TFile as any)('demo/studio.html');const files=new Map([[file.path,source]]);const events=new Map<string,Function[]>();const leaves:any[]=[];let active:any=null;let plugin:any;
const on=(name:string,fn:Function)=>{const list=events.get(name)||[];list.push(fn);events.set(name,list);return {};};
// getActiveFile 的宿主语义(obsidian.asar 实证):
//   activeEditor?.file || getActiveFileView()?.file || null
// 其中 getActiveFileView() 在活动叶子 view.navigation===false(侧栏视图)时会退回
// "activeTime 最新的导航视图"。桩照此维护 activeNavFile,否则"点侧栏页签不改当前文档"
// 这条语义在浏览器探针里根本模拟不出来。
let activeNavFile:any=null;
const isNavLeaf=(l:any)=>!!l?.view&&l.view.navigation!==false&&!!l.view.file;
const emit=(name:string,...args:any[])=>{
 if(name==='active-leaf-change'){const l=args[0];if(l){active=l;if(isNavLeaf(l))activeNavFile=l.view.file;}}
 for(const fn of events.get(name)||[])fn(...args);};
const createLeaf=(el:HTMLElement)=>{const leaf:any={app:null,el,view:null,async setViewState(state:any){this.view=plugin.factories.get(state.type)(this);await this.view.onOpen();},detach(){this.el.remove();leaves.splice(leaves.indexOf(this),1);},isVisible(){return true;},getRoot(){return {getType:()=>'root'};},getViewState(){return {};}};leaves.push(leaf);return leaf;};
const right=createLeaf(document.getElementById('sidebar')!);const main=createLeaf(document.getElementById('preview')!);
const adapter={files:w.savedDraftFiles,basePath:'D:/vault',
 async read(p:string){const v=this.files.get(p);if(v===undefined)throw new Error('ENOENT');return v;},
 async write(p:string,data:string){this.files.set(p,data);},
 async exists(p:string){return this.files.has(p);},
 async mkdir(){},async remove(p:string){this.files.delete(p);},
 async list(dir:string){return [...this.files.keys()].filter(k=>k.startsWith(dir+'/')).map(k=>k.slice(dir.length+1));}};
const app:any={workspace:{on,getLeavesOfType:(t:string)=>leaves.filter(l=>l.view?.getViewType()===t),getActiveViewOfType:(type:any)=>active?.view instanceof type?active.view:null,
  getActiveFile:()=>{const a=active;if(isNavLeaf(a))return a.view.file;return activeNavFile??null;},getRightLeaf:()=>right,getLeaf:()=>main,async revealLeaf(){w.sidebarReveals++;},onLayoutReady:(fn:any)=>fn(),getMostRecentLeaf:()=>active},vault:{configDir:'.obsidian',adapter,on,read:async(f:any)=>files.get(f.path),cachedRead:async(f:any)=>files.get(f.path),getResourcePath:()=>'app://local/demo/studio.html',async process(f:any,fn:any){const current=files.get(f.path);const next=fn(current);if(next===undefined||next===null)throw new Error('conflict');files.set(f.path,next);emit('modify',f);return next;},getAbstractFileByPath:(p:string)=>files.has(p)?{path:p}:null,async create(p:string,data:string){files.set(p,data);const tf=new (TFile as any)(p);return tf;},async createBinary(p:string,data:any){files.set(p,data);const tf=new (TFile as any)(p);return tf;},async modify(f:any,data:string){files.set(f.path,data);},getFiles:()=>[...files.keys()].map(p=>new (TFile as any)(p)),getMarkdownFiles:()=>[],getAllLoadedFiles:()=>[]}};
w.sidebarReveals=0;w.testApp=app;main.app=right.app=app;
async function start(){plugin=new (HtmlAtelier as any)();await plugin.onload();await main.setViewState({type:'html-atelier-preview'});main.view.file=file;active=main;await main.view.onLoadFile(file);emit('active-leaf-change',main);emit('file-open',file);w.harness={plugin,main,right,file,files,emit,source,leaves};
// 探针需要构造新 TFile 打开另一个文件(如验证图片属性写入)
w.TFileCtor=TFile;w.ready=true;}
void start();
