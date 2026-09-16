import {App, Menu, Notice, TFile} from 'obsidian';
import type {AtelierSettings} from '../settings/schema';
import type {Translator} from '../i18n';

// 链接解析与路由(F02–F05/F07):点击、右键、快捷键、悬停共用同一解析结果。
// 路径规则:相对路径按当前文件目录解析;/ 开头为库根相对;规范化后不得越过库根;
// 百分号只按 URL 规则解码一次;查询串与片段独立保留。

export type LinkKind='anchor'|'library-html'|'library-file'|'markdown'|'http'|'mailto'|'obsidian'|'unsupported'|'empty';

export interface ResolvedLink {
 kind:LinkKind;
 raw:string;                 // 原始 href(解码后的属性值)
 target:string;              // 去掉片段与查询后的路径/URL
 query:string;               // 含 ? 前缀
 fragment:string;            // 含 # 前缀
 file:TFile|null;            // 库内目标(可解析时)
 reason?:string;             // unsupported 原因
}

const UNSAFE_PROTOCOL=/^(javascript|vbscript|file|data:text\/html)/i;

export function decodeOnce(s:string):string {
 try{return decodeURIComponent(s);}catch{return s;}
}

export function resolveLink(app:App,raw:string,sourcePath:string):ResolvedLink {
 // **先切 query/fragment,再做百分号解码**:反过来会把 %23 解成 '#' 并被当成片段分隔符,
 // 于是插件解析不了自己生成的链接(noteRef 会把文件名里的 '#' 编成 %23)
 // (审计 round4 BUG 28)。
 const href=raw.trim();
 const hashIdx=href.indexOf('#');
 const qIdx=href.indexOf('?');
 const fragStart=hashIdx>=0?hashIdx:(href.length);
 const queryStart=qIdx>=0&&qIdx<fragStart?qIdx:fragStart;
 const target=decodeOnce(href.slice(0,Math.min(queryStart,fragStart)));
 const query=queryStart<fragStart?href.slice(queryStart,fragStart):'';
 const fragment=hashIdx>=0?href.slice(hashIdx):'';
 const base:ResolvedLink={kind:'unsupported',raw:href,target,query,fragment,file:null};
 if(!href||href==='#'){return {...base,kind:'empty',target:''};}
 const out:ResolvedLink={...base,target,query,fragment};
 if(!target){return {...out,kind:'anchor'};}
 if(UNSAFE_PROTOCOL.test(target)){return {...out,reason:'unsupported-protocol'};}
 if(/^(https?):\/\//i.test(target)){return {...out,kind:'http'};}
 // 协议相对 URL(`//host/x`):浏览器按当前协议加载,Obsidian 的外开接口需要显式协议,
 // 否则会被当成库内相对路径去查库、报 not-found(审计 round4 BUG 27)。
 // raw 保留原样,"复制原始地址"仍得到用户写的那一份。
 if(target.startsWith('//'))return {...out,kind:'http',target:`https:${target}`};
 if(/^mailto:/i.test(target)){return {...out,kind:'mailto'};}
 if(/^obsidian:/i.test(target)){return {...out,kind:'obsidian'};}
 if(/^[a-z][a-z0-9+.-]*:/i.test(target)){return {...out,reason:'unsupported-protocol'};}
 // 库内路径
 let path=target.replace(/\\/g,'/');
 if(path.startsWith('/'))path=path.slice(1);
 else{
  const dir=sourcePath.includes('/')?sourcePath.slice(0,sourcePath.lastIndexOf('/')+1):'';
  path=dir+path;
 }
 // 规范化 ../ 与 ./
 const parts:string[]=[];
 for(const part of path.split('/')){
  if(part==='.'||part==='')continue;
  if(part==='..'){parts.pop();continue;}
  parts.push(part);
 }
 const norm=parts.join('/');
 const file=app.vault.getAbstractFileByPath(norm);
 if(file instanceof TFile){
  const ext=file.extension.toLowerCase();
  if(ext==='html'||ext==='htm')return {...out,kind:'library-html',file};
  if(ext==='md')return {...out,kind:'markdown',file};
  return {...out,kind:'library-file',file};
 }
 return {...out,reason:'not-found',target:norm};
}

// “在浏览器中打开”的统一入口(D0-04:openExternal 对非 ASCII file URL 失败,
// 本地 HTML 需走配置的浏览器程序 spawn 传参;HTTPS 直接 openExternal)。
export interface BrowserLauncher {
 open(url:string):Promise<void>;
}

export function electronBrowserLauncher(getSettings?:()=>AtelierSettings):BrowserLauncher {
 // Electron 的 shell 仅在此处使用;require 为 Obsidian 渲染进程的既定用法
 async function openViaShell(url:string){
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Obsidian 渲染进程的 Electron 访问方式
  const {shell}=require('electron') as {shell:{openExternal:(u:string)=>Promise<void>}};
  await shell.openExternal(url);
 }
 return {
  async open(url:string){
   // links.browserApplication 指定了浏览器程序时,按 D0-04 结论用 spawn 以独立参数传 URL
   // (file:// 的含空格/中文路径 shell.openExternal 必然失败);否则退回 shell 快路径。
   // 此前该设置没有任何读取方(审计 round4 缺陷 38)。
   // 坑(2026-09-15 人工测试实测):默认哨兵值 'auto' 不能当可执行文件 spawn——spawn
   // 不存在的程序不抛同步异常,而是异步 error 事件,try/catch 接不住,于是包括普通点击
   // http 外链在内的所有"在浏览器打开"路径全部静默无反应。
   const configured=(getSettings?.().links.browserApplication??'').trim();
   if(configured&&configured.toLowerCase()!=='auto'){
    try{
     // eslint-disable-next-line @typescript-eslint/no-require-imports -- Obsidian 渲染进程的既定用法
     const {spawn}=require('child_process') as {spawn:(cmd:string,args:string[],opts?:unknown)=>{on?:(ev:string,cb:()=>void)=>void}};
     // 路径写错/程序不存在只走异步 error:接住后退回系统默认,而不是无声失败
     spawn(configured,[url],{detached:true,stdio:'ignore'})
      .on?.('error',()=>{void openViaShell(url);});
     return;
    }catch{/* 落到 shell 快路径 */}
   }
   await openViaShell(url);
  },
 };
}

export class LinkRouter {
 constructor(private app:App,private settings:()=>AtelierSettings,private t:Translator,
  private browser:BrowserLauncher,private openHtml:(path:string,fragment:string,newLeaf:boolean)=>void,
  private openLibraryFile:(file:TFile,newLeaf:boolean)=>void){}

 // F02:按分类路由。返回是否已处理。
 async open(resolved:ResolvedLink,opts:{newLeaf:boolean; inAppExternal:boolean}):Promise<void> {
  const st=this.settings();
  switch(resolved.kind){
   case 'anchor':{
    if(!resolved.fragment)return;
    this.openHtml('',resolved.fragment,false); // 当前文档锚点由视图内部滚动
    break;
   }
   case 'library-html':
    this.openHtml(resolved.file!.path,resolved.fragment,opts.newLeaf||st.links.internalTarget==='new-tab');
    break;
   case 'markdown':
    await this.app.workspace.openLinkText(resolved.file!.path,resolved.fragment.slice(1)||'',opts.newLeaf);
    break;
   case 'library-file':
    if(opts.newLeaf||st.links.internalTarget==='new-tab')this.openLibraryFile(resolved.file!,true);
    else this.openLibraryFile(resolved.file!,false);
    break;
   case 'http':{
    if(opts.inAppExternal&&st.links.externalTarget==='web-viewer'){
     // 网页查看器可用性已在 D0-03 记录:默认关闭时退回系统浏览器
     const wv=(this.app as unknown as {internalPlugins?:{getPluginById:(id:string)=>{enabled?:boolean}|null}}).internalPlugins?.getPluginById('webviewer');
     if(wv?.enabled){
      const leaf=this.app.workspace.getLeaf(true);
      await leaf.setViewState({type:'webviewer',state:{url:resolved.target}});
      break;
     }
     new Notice(this.t('noticeWebViewerFallback'));
    }
    await this.browser.open(resolved.target);
    break;
   }
   case 'mailto':
    await this.browser.open(resolved.target);
    break;
   case 'unsupported':
    new Notice(this.t('noticeLinkUnsupportedReason',{reason:resolved.reason==='unsupported-protocol'?resolved.target.split(':')[0]:this.t('linkTargetMissing')}));
    break;
   case 'empty':break;
   case 'obsidian':
    await this.browser.open(resolved.raw);
    break;
  }
 }

 // 浏览器手势(browserGesture)的执行入口:与右键菜单同权——只对菜单里提供
 // "在浏览器中打开"的类别生效(http/mailto 用原 URL,库内 HTML 用 file URL),
 // 其余类别(锚点/笔记/库内文件)返回 false,由调用方回落普通路由。
 // 此前手势分支只是原样调 router.open,库内 HTML 仍在插件内打开,设置承诺落空。
 openInBrowser(resolved:ResolvedLink):boolean {
  if(resolved.kind==='http'||resolved.kind==='mailto'){void this.browser.open(resolved.target);return true;}
  if(resolved.kind==='library-html'&&resolved.file){void this.openHtmlInBrowser(resolved);return true;}
  return false;
 }

 // F03:链接右键菜单。
 showMenu(event:MouseEvent,resolved:ResolvedLink,opts:{onEdit:()=>void; onOpenCurrent:()=>void; onOpenNew:()=>void; onRelink?:()=>void}):void {
  const menu=(new Menu()) as Menu&{showAtPosition:(p:{x:number;y:number},doc?:Document)=>Menu};
  const st=this.settings();
  const t=this.t;
  const addLocal=(label:string,icon:string,run:()=>void)=>menu.addItem(i=>{i.setTitle(label).setIcon(icon).onClick(()=>run());});
  if(resolved.kind==='anchor'||resolved.kind==='library-html'||resolved.kind==='empty'){
   addLocal(t('menuOpen'),st.links.internalTarget==='new-tab'?'external-link':'file',opts.onOpenCurrent);
   addLocal(t('menuOpenNewLeaf'),'external-link',opts.onOpenNew);
  }
  if(resolved.kind==='http'||resolved.kind==='mailto'){
   addLocal(t('menuOpenBrowser'),'globe',()=>{void this.browser.open(resolved.target);});
  }else if(resolved.kind==='library-html'){
   addLocal(t('menuOpenBrowser'),'globe',()=>{void this.openHtmlInBrowser(resolved);});
  }
  menu.addSeparator();
  addLocal(t('menuCopyAddress'),'copy',()=>{void this.copyAddress(resolved,false);});
  addLocal(t('menuCopyRaw'),'clipboard-copy',()=>{void navigator.clipboard.writeText(resolved.raw).then(()=>new Notice(t('noticeCopied')));});
  if(resolved.kind==='library-html'||resolved.kind==='markdown'||resolved.kind==='library-file'){
   addLocal(t('menuCopyNoteLink'),'link',()=>{void this.copyAddress(resolved,true);});
  }
  menu.addSeparator();
  if(resolved.kind==='anchor'||resolved.kind==='library-html'||resolved.kind==='empty'){
   addLocal(t('menuEditLink'),'pencil',opts.onEdit);
  }else if(resolved.kind==='unsupported'&&resolved.reason==='not-found'){
   if(opts.onRelink)addLocal(t('menuRelink'),'link-2',opts.onRelink);
  }
  const doc=(event.target as Element).ownerDocument;menu.showAtPosition({x:event.clientX,y:event.clientY},doc);
 }

 // 复制地址:F03 规则——HTTP 复制完整 URL;库内复制规范化库根相对路径(不泄露绝对路径)
 async copyAddress(resolved:ResolvedLink,noteLink:boolean):Promise<void> {
  let text='';
  if(noteLink&&resolved.file){
   const encoded=resolved.file.path.split('/').map(p=>p.replace(/ /g,'%20')).join('/');
   text=`${encoded}${resolved.fragment}${resolved.query}`;
  }else if(resolved.kind==='http'||resolved.kind==='mailto'){
   text=resolved.raw;
  }else if(resolved.file){
   text=`${resolved.file.path}${resolved.fragment}${resolved.query}`;
  }else text=resolved.raw;
  await navigator.clipboard.writeText(text);
  new Notice(this.t('noticeCopied'));
 }

 // 本地 HTML 的浏览器打开:验证实际 file URL(D0-04:非 ASCII 路径 openExternal 失败,
 // 需要配置浏览器程序 spawn;此处先用 file URL,失败给出可复制地址的明确提示)。
 async openHtmlInBrowser(resolved:ResolvedLink):Promise<void> {
  const ad=(this.app.vault.adapter as unknown as {basePath?:string}).basePath;
  if(!ad||!resolved.file){new Notice(this.t('noticeBrowserOpenFailed'));return;}
  const url='file:///'+encodeURI(`${ad.replace(/\\/g,'/')}/${resolved.file.path}`)
   .replace(/#/g,'%23').replace(/\?/g,'%3F');
  try{
   await this.browser.open(url);
   // ASCII 路径 resolve 不代表真开了浏览器;非 ASCII 路径会 reject,统一给出提示
   if(/[^\u0080-\uFFFF]/.test(ad+resolved.file.path))new Notice(this.t('noticeBrowserOpenVerify'));
  }catch{
   new Notice(this.t('noticeBrowserOpenFailedWithCopy',{url}));
  }
 }
}
