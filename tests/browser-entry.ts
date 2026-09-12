import HtmlAtelier from '../src/main';
import {TFile} from 'obsidian';
const w=window as any;w.notices=[];
const source='<!doctype html><html><head><style>body{margin:0;padding:48px;background:#fbfaf7;color:#344338;font:16px/1.8 system-ui}h1{font-size:42px;line-height:1.5;font-weight:500}p{color:#697268}button{background:none;border:0;padding:0;color:inherit;font:inherit}header{font-size:12px;letter-spacing:2px;margin-bottom:50px}footer{margin-top:70px;border-top:1px solid #dce0d5;padding-top:20px;font-size:12px}</style></head><body><header>STUDIO / 26</header><h1>给好想法，<br>一个生长的地方。</h1><p>收集日常的片段，连接零散的思考。</p><button>看看最近的作品</button><footer>01 / 正在发生</footer><script>window.parent.unwantedScriptRan=true</script></body></html>';
const file=new (TFile as any)('demo/studio.html');const files=new Map([[file.path,source]]);const events=new Map<string,Function[]>();const leaves:any[]=[];let active:any=null;let plugin:any;
const on=(name:string,fn:Function)=>{const list=events.get(name)||[];list.push(fn);events.set(name,list);return {};};
const emit=(name:string,...args:any[])=>{for(const fn of events.get(name)||[])fn(...args);};
const createLeaf=(el:HTMLElement)=>{const leaf:any={app:null,el,view:null,async setViewState(state:any){this.view=plugin.factories.get(state.type)(this);await this.view.onOpen();},};leaves.push(leaf);return leaf;};
const right=createLeaf(document.getElementById('sidebar')!);const main=createLeaf(document.getElementById('preview')!);
const app:any={workspace:{on,getLeavesOfType:(t:string)=>leaves.filter(l=>l.view?.getViewType()===t),getActiveViewOfType:(type:any)=>active?.view instanceof type?active.view:null,getRightLeaf:()=>right,getLeaf:()=>main,async revealLeaf(){w.sidebarReveals++;},onLayoutReady:(fn:any)=>fn()},vault:{on,read:async(f:any)=>files.get(f.path),getResourcePath:()=> 'app://local/demo/studio.html',async process(f:any,fn:any){const next=fn(files.get(f.path));files.set(f.path,next);emit('modify',f);return next;},getAbstractFileByPath:(p:string)=>files.has(p)?{}:null,async create(p:string,data:string){files.set(p,data);}}};
w.sidebarReveals=0;w.testApp=app;main.app=right.app=app;
async function start(){plugin=new (HtmlAtelier as any)();await plugin.onload();await main.setViewState({type:'html-atelier-preview'});main.view.file=file;active=main;await main.view.onLoadFile(file);emit('active-leaf-change',main);emit('file-open',file);w.harness={plugin,main,right,file,files,emit,source};w.ready=true;}
void start();
