import {FileView, Menu, Notice, TFile, WorkspaceLeaf} from 'obsidian';
type ViewStateResultLike=Parameters<FileView['setState']>[1];
import {ViewToolbar,ToolbarTarget,ToolbarMode,showMenuAt} from './toolbar';
import {renderSelectionBoxes} from './selectionOverlay';
import {DocumentSession} from '../core/session';
import {TextPatch,PatchError} from '../core/patch';
import {parseDocument,makePreview,markerRegex,DocumentModel} from '../model';
import {SourceIndex,SourceNode} from '../parsing/sourceIndex';
import {buildTextMap,TextContainer} from '../parsing/textMap';
import {escapeAttrValue} from '../parsing/escape';
import {debugLog} from '../services/debug';
import {inlineLocalStylesheets,CssInlineIO} from '../services/cssInline';
import {resolveLink,LinkRouter} from '../services/links';
import {currentNavEntry,NavigationService,NavEntry} from '../services/nav';
import type {AtelierSettings} from '../settings/schema';
import type {Translator} from '../i18n';

// 主文件视图(F16/F19/F26,§9.1):单一 FileView 内部承载 预览/编辑/源码/分栏 四种模式。
// 视图状态经 getState/setState 跨重启恢复(D0-10 实测);工作区状态不含编辑器实例与 DOM。

export const HTML_VIEW='html-atelier-preview';

export interface SelectionInfo {
 kind:'text'|'link'|'image'|'paragraph';
 segmentId?:string;
 nodeId?:number;          // SourceIndex 节点(链接/图片)
 tagName?:string;
 containerIndex?:number;  // TextMap 容器(整段编辑)
 logicalStart?:number;
 logicalEnd?:number;
 offset?:number;          // 源码偏移(定位用)
 description?:string;
}

export interface ViewCallbacks {
 getSession(file:TFile):Promise<DocumentSession>;
 save(file:TFile,session:DocumentSession):Promise<boolean>;
 onSessionEdited(file:TFile,session:DocumentSession):void;
 onSelectChanged(sel:SelectionInfo|null,session:DocumentSession|null):void;
 onHoverStatus(text:string|null):void;
 nav:NavigationService;
 settings:()=>AtelierSettings;
 t:Translator;
 router:LinkRouter;
 openLibraryFile:(file:TFile,newLeaf:boolean)=>void;
 openMarkdown:(path:string,fragment:string,newLeaf:boolean)=>void;
 sidebarSuppressed:()=>boolean;
 isUnloading:()=>boolean;
 // 视图状态变化(模式/视口/导航栈/加载)时通知宿主:工具栏在侧栏承载时,
 // 面板必须跟着刷新,否则按钮的禁用与高亮会停在旧状态
 onViewStateChanged:()=>void;
}

const OVERLAY_CSS='html-atelier-selection-layer{all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647}html-atelier-selection-box{position:fixed;pointer-events:none;box-sizing:border-box;left:var(--html-atelier-x);top:var(--html-atelier-y);width:var(--html-atelier-w);height:var(--html-atelier-h);border:var(--html-atelier-border);border-radius:2px}';
// 编辑模式下的空块占位:完全空的 <p></p> 高度为 0,用户在预览里看不到也点不到
// (审计复检 §3.23 M11)。只在编辑/分栏模式启用,不改预览的还原度。
const EMPTY_SLOT_CSS='p:empty,li:empty,div:empty,td:empty,th:empty{min-height:1.2em}';

export class HtmlFileView extends FileView {
 session:DocumentSession|null=null;
 mode:'preview'|'edit'|'source'|'split'='preview';
 width:number|'auto'='auto';
 zoom=100;
 selected:SelectionInfo|null=null;
 private nonce='';
 private textNodes=new Map<string,Text>();
 private overlay:ShadowRoot|null=null;
 private emptySlotStyle:HTMLStyleElement|null=null;
 private iframe:HTMLIFrameElement|null=null;
 private iframeWrap:HTMLElement|null=null;
 private sourceHost:HTMLElement|null=null;
 private sourceEditor:import('./sourceEditor').SourceEditor|null=null;
 private loadToken=0;
 private previewTimer:number|null=null;
 private lastNavWin:Window|null=null;
 private hovered:string|null=null;
 // 后退/前进正在加载的目标路径。只在"这次加载确实来自该次遍历"时用于对齐索引,
 // 否则按普通导航压栈——若遍历的打开失败又来了别的文件,压栈行为必须保持正常。
 private pendingTraverse:string|null=null;
 // 换文件时等待恢复的滚动比例(来自目标文件的导航记录)
 private pendingRestoreRatio:number|null=null;
 // 视图级默认值只应用一次(之后由导航位置/用户操作决定)
 private viewDefaultsApplied=false;
 callbacks:ViewCallbacks;

 constructor(leaf:WorkspaceLeaf,callbacks:ViewCallbacks){
  super(leaf);
  this.callbacks=callbacks;
 }

 getViewType(){return HTML_VIEW;}
 getIcon(){return 'file-code-2';}
 canAcceptExtension(ext:string){return ['html','htm'].includes(ext.toLowerCase());}
 getDisplayText(){return this.file?.name??'HTML Atelier';}

 async onOpen(){
  this.contentEl.addClass('html-atelier-view');
  this.toolbarHost=this.contentEl.createDiv({cls:'html-atelier-toolbarhost'});
  this.contentEl.createDiv({cls:'html-atelier-main',attr:{'data-main':''}});
  this.syncToolbarPlacement();
  this.trackPanelInput();
 }

 // 面板内最近持有焦点的输入框:保存按钮的 mousedown 会先把焦点从文字框拿走,
 // click 处理器/saveFile 里再读 activeElement 已经是按钮(2026-09-30 复查:保存后
 // 焦点离开侧栏文字框)。这里持续跟踪,保存时作为兜底。
 private lastPanelInput:HTMLInputElement|HTMLTextAreaElement|null=null;
 private panelInputTracked=false;
 private trackPanelInput(){
  if(this.panelInputTracked)return;
  this.panelInputTracked=true;
  const onFocusIn=(e:FocusEvent)=>{
   const t=e.target;
   if(t instanceof HTMLInputElement||t instanceof HTMLTextAreaElement)
    this.lastPanelInput=t.closest('.html-atelier-panel')?t:null; // 焦点到面板外输入框:作废
  };
  const doc=this.contentEl.ownerDocument;
  // View(Component) 的 registerDomEvent 随视图卸载自动清理
  this.registerDomEvent(doc,'focusin',onFocusIn,true);
 }

 // 工具栏跟随 editor.toolbarPlacement:'view' 时自绘,'sidebar' 时交给右侧栏面板。
 // 用固定的 toolbarHost 占位,避免在 contentEl 里插入/删除节点时打乱 [data-main]。
 syncToolbarPlacement(){
  if(!this.toolbarHost)return;
  const inView=this.callbacks.settings().editor.toolbarPlacement==='view';
  if(inView&&!this.toolbar){
   this.toolbar=new ViewToolbar(this.toolbarHost,()=>this.toolbarTarget(),this.callbacks.t,{showTitle:true,showSave:true});
  }else if(!inView&&this.toolbar){
   this.toolbar.destroy();this.toolbar=null;
  }
  this.toolbarHost.toggleClass('html-atelier-hidden',!inView);
  this.refreshToolbar();
 }

 // 工具栏作用于本视图。面板持有的是活动视图的这个对象,因此两处共用同一份语义。
 private targetCache:ToolbarTarget|null=null;
 toolbarTarget():ToolbarTarget{
  if(!this.targetCache)this.targetCache={
   hasFile:()=>!!this.file,
   title:()=>this.file?.name??'',
   dirty:()=>!!this.session&&this.session.dirty,
   canBack:()=>this.callbacks.nav.canBack(this),
   canForward:()=>this.callbacks.nav.canForward(this),
   goBack:()=>this.goBack(),
   goForward:()=>this.goForward(),
   mode:()=>this.mode,
   setMode:(m:ToolbarMode)=>this.setMode(m),
   refreshPreview:()=>this.renderFrame(true),
   canSave:()=>!!this.session&&this.session.dirty&&this.session.operation==='idle',
   save:()=>{if(this.file&&this.session)void this.callbacks.save(this.file,this.session);},
   widthMenu:(a:HTMLElement)=>this.showWidthMenu(a),
   zoomMenu:(a:HTMLElement)=>this.showZoomMenu(a),
   moreMenu:(a:HTMLElement)=>this.showMoreMenu(a),
  };
  return this.targetCache;
 }

 // 语言切换后重新求值工具栏标签(可视部分只有图标,文字在 aria-label 上)
 relabelToolbar(){
  this.toolbar?.relabel(this.callbacks.t);
 }

 private toolbar:ViewToolbar|null=null;
 private toolbarHost:HTMLElement|null=null;

 // ---- 状态持久化(D0-10 实测:getState/setState 跨重启恢复)----
 getState():Record<string,unknown>{
  return {...super.getState(),mode:this.mode,width:this.width,zoom:this.zoom,
   selected:this.selected??null};
 }
 async setState(state:unknown,result:ViewStateResultLike){void result;
  await super.setState(state,result);
  const st=(state??{}) as {mode?:HtmlFileView['mode']; width?:number|'auto'; zoom?:number};
  if(st.mode)this.mode=st.mode;
  if(st.width!==undefined)this.width=st.width;
  if(st.zoom!==undefined)this.zoom=st.zoom;
 }

 async onLoadFile(file:TFile){
  const token=++this.loadToken;
  try{
   const s=await this.callbacks.getSession(file);
   if(token!==this.loadToken)return;
   this.session=s;
   this.lastSession=s;
   this.lastFile=file;
   const st=this.callbacks.nav.lastPosition(file.path);
   // preview.rememberViewport 关闭时不恢复缩放/宽度(设置项必须真的有效)
   const pv=this.callbacks.settings().preview;
   if(st&&pv.rememberViewport){this.zoom=st.zoom;this.width=st.width;}
   // 首次打开:按设置决定初始模式与视口(preview.defaultWidth / preview.defaultZoom /
   // editor.defaultMode 此前都没有读取方 —— 审计 round4 缺陷 38)
   if(!this.viewDefaultsApplied){
    this.viewDefaultsApplied=true;
    this.mode=this.callbacks.settings().editor.defaultMode;
    if(this.width==='auto')this.width=pv.defaultWidth;
    if(this.zoom===100)this.zoom=pv.defaultZoom;
   }
   // 目标文件记录的阅读位置:帧加载完成后恢复它(而不是"正要离开那个窗口"的比例)
   this.pendingRestoreRatio=st&&pv.rememberPosition?st.scrollRatio:null;
   this.mountMain();
   this.renderFrame(true);
   const pending=(window as unknown as {htmlAtelierPendingAnchor?:string}).htmlAtelierPendingAnchor;
   if(pending){this.currentAnchor=pending;(window as unknown as {htmlAtelierPendingAnchor?:string}).htmlAtelierPendingAnchor=undefined;}
   const loadedPath=this.file?.path??file.path;
   if(this.pendingTraverse===loadedPath){ // 后退/前进造成的加载:对齐索引而非压栈,保住前进分支
    this.pendingTraverse=null;
    this.callbacks.nav.alignToPath(this,loadedPath);
   }else this.pushNav();
   this.callbacks.onSelectChanged(null,s);
  }catch(e){
   console.error(e);
   this.contentEl.setText(this.callbacks.t('viewLoadFailed'));
  }
 }

 async onUnloadFile(){
  // 切文件前先把待写的源码编辑提交给"它自己的会话":此刻 this.session 仍是旧文件的,
  // 编辑器里也还是旧文件的文本。不这样做,防抖窗口内的输入要么被写进新文件(旧缺陷),
  // 要么被直接丢弃(两者的取舍见审计复检 §3.13)。
  this.flushSourceSync();
  ++this.loadToken;
  this.cancelSourceSync();
  this.detachSource();this.iframe=null;this.visibleFrame=null;this.session=null;this.selected=null;this.callbacks.onSelectChanged(null,null);
 }
 async onClose(){
  this.captureScroll();this.flushSourceSync();this.cancelSourceSync();this.detachSource();
  // drafts.closeBehavior='ask':关闭视图时询问是否写入文件(keep 则只保留草稿)。
  // 两条路径都不丢内容:取消保存时草稿仍在。此前该设置无读取方(审计 round4 缺陷 38)。
  const session=this.session??this.lastSession;
  const file=this.file??this.lastFile;
  // 卸载(退出应用/禁用插件)时不询问:此时草稿由宿主的 onunload 尽最大努力提交
  if(session?.dirty&&file&&!this.callbacks.isUnloading()
   &&this.callbacks.settings().drafts.closeBehavior==='ask'
   &&window.confirm(this.callbacks.t('draftsAskOnClose',{path:file.path})))
   await this.callbacks.save(file,session);
 }

 private lastSession:DocumentSession|null=null;
 private lastFile:TFile|null=null;

 private mountMain(){
  const main=this.contentEl.querySelector('[data-main]')??this.contentEl.createDiv({cls:'html-atelier-main',attr:{'data-main':''}});
  main.empty();
  // empty() 会移除旧 iframe:它的窗口随即被丢弃(documentElement 变 null)。
  // 若继续持有,后续 renderFrame/抓取滚动都会读到死窗口(实测会让重绘整体失败)。
  this.iframe=null;this.visibleFrame=null;this.lastNavWin=null;
  this.iframeWrap=main.createDiv({cls:'html-atelier-viewport'});
  this.sourceHost=main.createDiv({cls:'html-atelier-sourcehost'});
  this.applyMode();
  this.applyViewport();
 }

 // ---- 模式与视口 ----
 setMode(mode:HtmlFileView['mode']){
  this.mode=mode;
  this.applyMode();
  this.applyViewport();
  if(mode==='source'||mode==='split')this.mountSource();
  // 选中/悬停框只在编辑/分栏绘制:切模式要重画一次,否则从编辑切到预览时上次的
  // 选中框留在预览上(宣传片 08 镜头实测:预览模式下导语还套着实线框)。
  // 悬停一并清掉:切模式时指针在工具栏上,预览里没有被指着的文字;大纲/搜索定位
  // 设下的悬停高亮是一次性的,不该在下次切回编辑时又冒出来(定位入口先切模式、
  // 后设悬停,不受影响)
  this.hovered=null;
  this.drawSelection();
  this.refreshToolbar();
  this.pushNav();
 }

 private applyMode(){
  if(!this.iframeWrap||!this.sourceHost)return;
  const showPreview=this.mode==='preview'||this.mode==='edit'||this.mode==='split';
  const showSource=this.mode==='source'||this.mode==='split';
  this.iframeWrap.toggleClass('html-atelier-hidden',!showPreview);
  this.sourceHost.toggleClass('html-atelier-hidden',!showSource);
  this.iframeWrap.toggleClass('html-atelier-editmode',this.mode==='edit'||this.mode==='split');
  this.contentEl.toggleClass('html-atelier-issplit',this.mode==='split');
  this.updateEmptySlots();
 }

 // 空块占位只在编辑/分栏生效:预览要保持与浏览器一致的还原度
 private updateEmptySlots(){
  if(this.emptySlotStyle)this.emptySlotStyle.disabled=!(this.mode==='edit'||this.mode==='split');
 }

 applyViewport(){
  if(!this.iframeWrap)return;
  const w=this.width==='auto'?'100%':`${this.width}px`;
  setCss(this.iframeWrap,'width',w);
  const z=this.zoom/100;
  const frame=this.iframe;
  if(frame){
   setCss(frame,'transform-origin','top left');
   setCss(frame,'width',`${100/z}%`);
   setCss(frame,'height',`${100/z}%`);
   setCss(frame,'transform',`scale(${z})`);
  }
 }

 showWidthMenu(anchor:HTMLElement){
  const t=this.callbacks.t;
  const menu=new Menu();
  const set=(w:number|'auto',label:string)=>menu.addItem(i=>{i.setTitle(label).onClick(()=>{this.width=w;this.applyViewport();this.pushNav();});});
  set('auto',t('widthAuto'));set(1440,t('widthDesktop'));set(768,t('widthTablet'));set(390,t('widthMobile'));
  menu.addSeparator();
  menu.addItem(i=>i.setTitle(t('widthCustom')).onClick(()=>{
   const v=window.prompt(this.callbacks.t('widthCustom'),String(this.width==='auto'?1280:this.width));
   if(v===null)return;
   const n=Math.round(Math.min(3840,Math.max(240,Number(v)||0)));
   if(n){this.width=n;this.applyViewport();this.pushNav();}
  }));
  showMenuAt(menu,anchor);
 }

 showZoomMenu(anchor:HTMLElement){
  const menu=new Menu();
  for(const z of [25,50,75,100,125,150,200]){
   menu.addItem(i=>i.setTitle(`${z}%`).onClick(()=>{this.zoom=z;this.applyViewport();this.pushNav();}));
  }
  menu.addSeparator();
  menu.addItem(i=>i.setTitle(this.callbacks.t('tbZoomReset')).onClick(()=>{this.zoom=100;this.applyViewport();this.pushNav();}));
  showMenuAt(menu,anchor);
 }

 showMoreMenu(anchor:HTMLElement){
  const t=this.callbacks.t;
  const menu=new Menu();
  menu.addItem(i=>i.setTitle(t('menuSaveAs')).onClick(()=>this.pluginEvent('save-as')));
  menu.addItem(i=>i.setTitle(t('menuOpenBrowserCurrent')).onClick(()=>this.openCurrentInBrowser()));
  menu.addSeparator();
  menu.addItem(i=>i.setTitle(t('menuCopyPageLink')).onClick(()=>this.pluginEvent('copy-page-link')));
  menu.addItem(i=>i.setTitle(t('menuCopySectionLink')).onClick(()=>this.pluginEvent('copy-section-link')));
  menu.addItem(i=>i.setTitle(t('menuCopyEmbed')).onClick(()=>this.pluginEvent('copy-embed')));
  menu.addSeparator();
  menu.addItem(i=>i.setTitle(t('menuDraftManager')).onClick(()=>this.pluginEvent('draft-manager')));
  menu.addItem(i=>i.setTitle(t('menuConflict')).onClick(()=>this.pluginEvent('conflict')));
  showMenuAt(menu,anchor);
 }

 private pluginEvent(name:string){
  window.dispatchEvent(new CustomEvent('html-atelier-cmd',{detail:{name,view:this}}));
 }

 openCurrentInBrowser(){
  if(!this.file||!this.session)return;
  // links.unsavedBrowserAction:草稿未保存时先问(ask),或只打开已保存版本(saved,先落盘)
  // (此前该设置无读取方 —— 审计 round4 缺陷 38)
  const act=this.callbacks.settings().links.unsavedBrowserAction;
  if(this.session.dirty){
   if(act==='saved')void this.callbacks.save(this.file,this.session);
   else if(!window.confirm(this.callbacks.t('linksConfirmOpenUnsaved')))return;
  }
  void this.callbacks.router.openHtmlInBrowser({kind:'library-html',raw:'',target:this.file.path,query:'',fragment:'',file:this.file});
 }

 // ---- 导航(F06)----
 private pushNav(){
  if(!this.file)return;
  const entry=currentNavEntry(this.file,this.currentAnchor,this.lastNavWin??this.iframe?.contentWindow??null,this.zoom,this.width);
  if(entry)this.callbacks.nav.push(this,entry);
  this.refreshToolbar();
 }

 // 抓取当前位置并更新栈顶。必须在用户**滚动时**与**离开页面前**调用:
 // 新页面加载那一刻窗口还是空白的,那时抓到的 scrollRatio 恒为 0,
 // Back/Forward 于是永远回到顶部(审计 round4 BUG 34)。
 private scrollCaptureTimer:number|null=null;
 private captureScroll(){
  if(!this.file||!this.session)return;
  const win=this.lastNavWin??this.iframe?.contentWindow??null;
  if(!win)return;
  try{
   const entry=currentNavEntry(this.file,this.currentAnchor,win,this.zoom,this.width);
   if(entry)this.callbacks.nav.updateTop(this,entry);
  }catch{/* 窗口已卸载:忽略 */}
 }
 // 帧的 load 事件到达时,长文档的布局可能还没完成(scrollHeight 仍小),此时按比例算出的
 // 目标位置约等于 0。因此按需重试几次,直到实际滚动位置与目标一致(审计 round4 BUG 34 的
 // 后半段:比例已经记录正确,但恢复落空)。
 private restoreScrollWhenReady(win:Window|null,ratio:number,attempt=0){
  if(!win||!this.session)return;
  // 重试期间帧可能已被重绘/卸载:此时窗口的 documentElement 已为 null,
  // 再读就是未捕获异常(定时器里的抛错还会污染全局错误处理)
  if(!win.document||!win.document.documentElement)return;
  if(this.iframe&&this.iframe.contentWindow!==win)return;
  const max=()=>win.document.documentElement.scrollHeight-win.innerHeight;
  if(ratio<=0)return;
  const target=max()*ratio;
  if(max()>0)win.scrollTo(0,target);
  if(attempt>=6)return;
  // 布局未完成时 max()===0,不能用 |scrollY-target| 判断(两者都是 0,会误判为成功)
  if(max()===0||Math.abs(win.scrollY-target)>4){
   window.setTimeout(()=>this.restoreScrollWhenReady(win,ratio,attempt+1),60);
  }
 }

 private scheduleScrollCapture(){
  if(this.scrollCaptureTimer!==null)window.clearTimeout(this.scrollCaptureTimer);
  this.scrollCaptureTimer=window.setTimeout(()=>{this.scrollCaptureTimer=null;this.captureScroll();},300);
 }

 currentAnchor='';
 goBack(){
  const e=this.callbacks.nav.back(this);
  if(!e)return;
  this.navigateEntry(e);
 }
 goForward(){
  const e=this.callbacks.nav.forward(this);
  if(!e)return;
  this.navigateEntry(e);
 }
 private navigateEntry(e:NavEntry){
  this.zoom=e.zoom;this.width=e.width;
  if(this.file&&e.path!==this.file.path){
   this.pendingAnchor=e.anchor;
   // 对齐只对这次遍历的目标生效;打开失败时清掉,由后续加载按普通导航处理
   this.pendingTraverse=e.path;
   // 必须在本叶子里打开:openLinkText 的 'active' 会把目标送到当时的活动叶子,
   // 于是"另一个标签的前进键"会改写别的标签(报告 §5.1/A10 两标签位置独立)。
   const target=this.app.vault.getAbstractFileByPath(e.path);
   if(target instanceof TFile){
    // 展开目标叶子,但手动收起抑制期间不强行展开(§5.1 与 A10 同时成立)
    if(!this.callbacks.sidebarSuppressed())void this.app.workspace.revealLeaf(this.leaf);
    void this.leaf.openFile(target).catch(err=>{
     this.pendingTraverse=null;
     (window as unknown as {htmlAtelierNavError?:string}).htmlAtelierNavError=String(err);
    });
    return;
   }
   // 解析不出 TFile(宿主实现差异/索引未就绪)时退回按路径打开,不静默失败
   void this.app.workspace.openLinkText(e.path,'','active' as unknown as boolean).catch(err=>{
    this.pendingTraverse=null;
    (window as unknown as {htmlAtelierNavError?:string}).htmlAtelierNavError=String(err);
   });
  }else{
   this.currentAnchor=e.anchor;
   this.scrollToAnchor(e.anchor);
   this.applyViewport();
  }
 }
 private pendingAnchor='';

 scrollToAnchor(anchor:string){
  const win=this.iframe?.contentWindow;
  if(!win)return;
  this.currentAnchor=anchor;
  const id=anchor.replace(/^#/,'');
  if(!id){win.scrollTo(0,0);return;}
  let target:Element|null=null;
  try{target=win.document.getElementById(decodeURIComponent(id));}catch{target=win.document.getElementById(id);}
  // 大纲/搜索给的是文字标记 id(不是元素 id),此前一律找不到而静默回到页首
  // (审计复检 §3.22:F10 文字列表与 F12 搜索命中的点击定位都不工作)。
  if(!target){
   const dom=this.textNodes.get(id);
   if(dom?.parentElement)target=dom.parentElement;
  }
  if(target)target.scrollIntoView();
  else win.scrollTo(0,0);
 }

 // 逻辑区间 → 预览定位(F10 文字列表)。按容器与逻辑偏移反查源节点,再经预览标记
 // 找到对应的 DOM 文字节点并滚动;查不到时返回 false,由调用方决定降级。
 // 面板定位入口(大纲/文案/搜索命中共用)在滚动之前必须先让预览**可见**:
 // 源码模式下 iframe 是 display:none,scrollIntoView 打在隐藏元素上等于什么都没发生
 // (用户反馈"点右侧大纲没反应"的第三种成因)。预览模式则切到编辑,才能显示选中高亮。
 prepareLocate(){
  if(this.mode==='source')this.setMode('split');
  else if(this.mode==='preview')this.setMode('edit');
 }

 // 搜索命中 → 在预览里选中那段文字,与点击预览文字走同一条选择路径
 // (视图 selected、侧栏表单、撤销分组键都以它为准)。
 selectText(segmentId:string){
  if(!this.session)return;
  this.prepareLocate();
  this.selected={kind:'text',segmentId};
  this.describeSelection();
  // 大纲定位留下的悬停(locateLogical)优先级高于选中,不清掉就看不到选中框
  this.hovered=null;
  this.scrollToAnchor(`#${segmentId}`);
  this.callbacks.onSelectChanged(this.selected,this.session);
  this.drawSelection();
 }

 locateLogical(containerIndex:number,lStart:number,lEnd:number):boolean{
  void lEnd;
  if(!this.session)return false;
  this.prepareLocate();
  const {index,map}=this.currentTextMap();
  const c=map[containerIndex];
  if(!c||!c.map.length)return false;
  const at=Math.min(Math.max(0,lStart),c.map.length-1);
  // 容器可能以内联元素开头(<h2><a href="#x">标题</a></h2>、<h2><em>T</em></h2>):
  // 只要求 map[at] 本身是文字节点时,这类标题永远定位失败,点击落回源码/分栏
  // (用户反馈"点大纲没反应"的第二种成因)。改为从请求位置向两侧找**第一个
  // 能落到预览文字节点上**的节点;找到了就滚过去,没找到才返回 false 让调用方降级。
  const ordered=[...c.map.slice(at),...c.map.slice(0,at).reverse()];
  const model=this.currentModel();
  let segId:string|null=null;
  let dom:Text|null=null;
  for(const m of ordered){
   const node=index.nodes[m.nodeId];
   if(!node||node.kind!=='text')continue;
   const seg=model.segments.find(x=>x.start>=node.start&&x.start<node.end);
   const candidate=seg?this.textNodes.get(seg.id):null;
   if(seg&&candidate){segId=seg.id;dom=candidate;break;}
  }
  if(!segId||!dom)return false;
  // 标题这类短文本整段居中会把它推到视口正中,长段落才需要居中(短文本对齐顶端更好读)
  const short=dom.data.trim().length<=80;
  dom.parentElement?.scrollIntoView({block:short?'start':'center'});
  this.hovered=segId;
  this.drawSelection();
  return true;
 }

 refreshToolbar(){
  this.toolbar?.refresh();
  // 工具栏在侧栏承载时,本视图没有可刷新的 DOM,必须把状态推给面板
  this.callbacks.onViewStateChanged();
 }

 // ---- 预览渲染 ----
 renderCount=0;
 renderFrame(reposition=false){
  if(!this.session||!this.file||!this.iframeWrap)return;
  this.renderCount++;
  // 旧窗口可能已被丢弃(mountMain/empty 之后):只有文档还在时才用它算滚动比例。
  // 必须读可见帧:预加载期间 this.iframe 指向隐藏的空白帧,读它会得到比例 0,
  // 连续两次外部重绘(双次 renderFrame 重叠)时第二次就把跳顶 bug 复活(审计 M1)
  const oldWin=(this.visibleFrame??this.iframe)?.contentWindow??null;
  let ratio=0;
  if(oldWin?.document?.documentElement&&reposition)ratio=this.callbacks.nav.scrollRatioOf(oldWin);
  // 预加载替换(2026-09-30 复查:保存后闪白帧的根因是先 empty 再等 srcdoc 异步构建,
  // 中间约 7ms 预览区空白):旧帧保持可见,新帧隐藏加载,load 完成初始化后再原子替换。
  // 期间再次 renderFrame 时,尚未就绪的隐藏帧被同步丢弃,可见帧不动。
  if(this.iframe&&this.iframe!==this.visibleFrame)this.iframe.remove();
  const previous=this.visibleFrame;
  this.nonce=Math.random().toString(36).slice(2,10);
  const resource=this.app.vault.getResourcePath(this.file);
  const base=resource.slice(0,resource.lastIndexOf('/')+1);
  const frame=this.iframeWrap.createEl('iframe',{cls:'html-atelier-frame',attr:{sandbox:'allow-same-origin',title:`${this.file.name} — HTML Atelier`,referrerpolicy:'no-referrer'}});
  frame.addClass('html-atelier-hidden');
  this.iframe=frame;
  frame.addEventListener('load',()=>{
   // 插入即触发的 about:blank 初始 load(srcdoc 未设置):不算内容就绪
   if(!frame.getAttribute('srcdoc'))return;
   const doc=frame.contentDocument;
   if(!doc)return;
   if(this.iframe!==frame){frame.remove();return;} // 已被更新的渲染淘汰
   // 先替换显示,再做依赖布局的初始化:滚动恢复/选中框都要求新帧可见可布局,
   // 隐藏帧的 scrollHeight 为 0,先恢复会全部落空
   previous?.remove();
   frame.toggleClass('html-atelier-hidden',false);
   this.visibleFrame=frame;
   // 导航/滚动抓取的目标窗口跟随可见帧切换(此前在 renderFrame 末尾就指向隐藏帧,
   // 预加载窗口里抓到的 scrollRatio 恒为 0,污染导航栈与保存焦点——审计 M1)
   this.lastNavWin=frame.contentWindow;
   this.applyViewport();
   this.textNodes.clear();
   const re=markerRegex(this.nonce);
   const walker=doc.createTreeWalker(doc,128);
   let comment:Node|null;
   while((comment=walker.nextNode())){
    const match=re.exec(comment.nodeValue??'');
    if(match&&comment.nextSibling?.nodeType===3)this.textNodes.set(match[1],comment.nextSibling as Text);
   }
   const styleEl=doc.createElement('style');
   styleEl.textContent=OVERLAY_CSS;
   doc.head?.append(styleEl);
   // 上一份文档里的高亮样式随 iframe 一起没了,置空避免悬空引用
   this.changeStyle=null;
   const slotStyle=doc.createElement('style');
   slotStyle.textContent=EMPTY_SLOT_CSS;
   doc.head?.append(slotStyle);
   this.emptySlotStyle=slotStyle;
   this.updateEmptySlots();
   const layer=doc.createElement('html-atelier-selection-layer');
   doc.documentElement?.append(layer);
   this.overlay=layer.attachShadow({mode:'open'});
   const shadowStyle=doc.createElement('style');
   shadowStyle.textContent=OVERLAY_CSS;
   this.overlay.append(shadowStyle);
   this.wirePreviewEvents(doc);
   this.syncTextNodes();
   this.applyChangeHighlights();
   const anchor=this.pendingAnchor||this.currentAnchor;
   this.pendingAnchor='';
   if(anchor)this.scrollToAnchor(anchor);
   else if(this.pendingRestoreRatio!==null){
    // 换文件:恢复**目标文件**记录的位置。用"正要离开的那个窗口"的比例是错的
    // (离开时它通常已在顶部,于是 Back 永远回到顶部 —— 审计 round4 BUG 34)。
    const target=this.pendingRestoreRatio;
    this.pendingRestoreRatio=null;
    this.callbacks.nav.restoreScroll(frame.contentWindow,target);
   }
   else if(reposition)this.restoreScrollWhenReady(frame.contentWindow,ratio);
   this.drawSelection();
   this.refreshToolbar();
  });
  // 预览文档构建含异步步骤(读库内 CSS 做内联),期间可能又发生一次 renderFrame:
  // 代次令牌保证只有最新一次构建能写 srcdoc,旧构建整体丢弃。构建异常时同步回退
  // (不内联 CSS),不让隐藏帧悬死、旧帧永远不被替换。构建期间内容又被编辑的,
  // 快照已过期:按当前内容重排一次,不让新帧把旧版源"回放"出来(审计 m2)。
  const buildToken=++this.previewBuildToken;
  const source=this.session.workingSource;
  const filePath=this.file.path;
  const allowNetwork=this.callbacks.settings().preview.allowNetworkAssets;
  const commit=(preview:string)=>{
   if(buildToken!==this.previewBuildToken||this.iframe!==frame)return;
   if(this.session&&this.session.workingSource!==source){void this.renderFrame(reposition);return;}
   frame.srcdoc=preview;
  };
  void this.buildPreviewSource(source,filePath,base).then(commit).catch(e=>{
   console.error('预览构建失败,回退不内联',e);
   commit(makePreview(parseDocument(source),base,this.nonce,{allowNetwork}));
  });
 }

 private previewBuildToken=0;
 // 当前可见帧:预加载期间 this.iframe 指向隐藏的新帧,可见的仍是它
 private visibleFrame:HTMLIFrameElement|null=null;

 // 预览源生成:库内本地样式表先内联成 <style>(宿主 CSP 拦截 app:// 样式表加载,
 // 2026-09-30 真机定因,见 services/cssInline.ts);内联失败回退原始源,与旧行为一致。
 private async buildPreviewSource(source:string,filePath:string,base:string):Promise<string>{
  const io:CssInlineIO={
   readCss:async p=>{
    const f=this.app.vault.getAbstractFileByPath(p);
    return f instanceof TFile?await this.app.vault.cachedRead(f).catch(()=>null):null;
   },
   resourceUrl:p=>{
    const f=this.app.vault.getAbstractFileByPath(p);
    return f instanceof TFile?this.app.vault.getResourcePath(f):null;
   },
  };
  const inlined=await inlineLocalStylesheets(source,filePath,io);
  return makePreview(parseDocument(inlined),base,this.nonce,
   {allowNetwork:this.callbacks.settings().preview.allowNetworkAssets});
 }

 // 事件:选择(F20 编辑入口)、链接路由(F02/F04)、菜单(F03)、悬停(F05)
 private wirePreviewEvents(doc:Document){
  const findText=(event:MouseEvent):string|null=>{
   // 键盘激活或程序化 dispatch 的 click 不带坐标(0,0),按位置查找会落到页面左上角
   const hasCoords=event.clientX!==0||event.clientY!==0;
   if(hasCoords){
    const pos=(doc as Document&{caretPositionFromPoint?(x:number,y:number):{offsetNode:Node; offset:number}|null}).caretPositionFromPoint?.(event.clientX,event.clientY);
    let range:Range|null=null;
    if(pos){range=doc.createRange();range.setStart(pos.offsetNode,pos.offset);range.collapse(true);}
    else range=(doc as Document&{caretRangeFromPoint(x:number,y:number):Range|null}).caretRangeFromPoint(event.clientX,event.clientY);
    if(range){for(const [id,node] of this.textNodes)if(node===range.startContainer&&this.containsPoint(node,event.clientX,event.clientY))return id;}
   }
   const target=event.target as Element;
   if(target.nodeType===3)for(const [id,node] of this.textNodes)if(node===(target as unknown as Text))return id;
   const matches=[...this.textNodes].filter(([,node])=>target.contains(node));
   if(matches.length===1)return matches[0][0];
   // 无法按位置消歧时,只有"无坐标"事件可以退回首个非空白片段;真实点击落在
   // 多个片段的容器上仍返回 null(不猜用户指的是哪一段)
   if(!hasCoords)return matches.find(([,node])=>node.data.trim().length>0)?.[0]??null;
   return null;
  };
  doc.addEventListener('mousemove',event=>{
   if(this.mode!=='edit'&&this.mode!=='split')return;
   const id=findText(event);
   if(id!==this.hovered){this.hovered=id;this.drawSelection();}
  });
  doc.addEventListener('mouseleave',()=>{this.hovered=null;this.drawSelection();});
  doc.addEventListener('scroll',()=>{this.drawSelection();this.scheduleScrollCapture();},true);
  // 预览尺寸变了(切分栏、拖侧栏、换宽度预设)页面会重排,框要按新布局重画,不然停在旧位置
  doc.defaultView?.addEventListener('resize',()=>this.drawSelection());
  doc.addEventListener('click',event=>{
   const target=event.target as Element;
   const anchorEl=target.closest('a');
   const st=this.callbacks.settings();
   // 顺序是有意的:**编辑/分栏模式下先做文字选择,链接不跳转**。
   // 这两种模式的用途是"点文字改文案",链接文字同样是可编辑文字;链接导航是
   // 预览模式的职责(用户 2026-09-15 确认这是期望行为)。别把链接分支提到前面,
   // 那会让编辑模式里点链接变成跳转,反而失去选中文字的能力。
   if(this.mode==='edit'||this.mode==='split'){
    const id=findText(event);
    if(id){
     event.preventDefault();event.stopPropagation();
     this.selected={kind:'text',segmentId:id};
     this.describeSelection();
     this.callbacks.onSelectChanged(this.selected,this.session);
     this.drawSelection();
     return;
    }
   }
   if(anchorEl){
    event.preventDefault();event.stopPropagation();
    const href=anchorEl.getAttribute('href')??'';
    const resolved=resolveLink(this.app,href,this.file?.path??'');
    const gesture=st.links.browserGesture;
    const mod=event.ctrlKey||event.metaKey;
    const gestureHit=(gesture==='Mod'&&mod&&!event.altKey&&!event.shiftKey)
     ||(gesture==='Alt'&&event.altKey&&!mod)
     ||(gesture==='Mod+Shift'&&mod&&event.shiftKey);
    if(gesture!=='off'&&gestureHit){
     if(this.callbacks.router.openInBrowser(resolved))return;
     // 手势对锚点/笔记等类别无浏览器语义:继续走下方普通路由
    }
    if(resolved.kind==='anchor'){this.scrollToAnchor(resolved.fragment);this.pushNav();return;}
    if(resolved.kind==='library-html'&&resolved.fragment){this.pendingAnchor=resolved.fragment;}
    // links.respectBlankTarget:target="_blank" 的库内链接开在新叶子(此前该设置无读取方)
    const blank=(anchorEl.getAttribute('target')??'').toLowerCase()==='_blank';
    const wantsNewLeaf=(st.links.respectBlankTarget&&blank)||event.ctrlKey||event.metaKey;
    void this.callbacks.router.open(resolved,{newLeaf:wantsNewLeaf,inAppExternal:true});
   }else{
    const img=target.closest('img');
    if(img&&(this.mode==='edit'||this.mode==='split')){
     const index=this.currentIndex();
     const node=index.nodes.find(n=>n.kind==='element'&&n.tag==='img'&&n.start>=0&&img.outerHTML&&sourceHasImg(this.session!.workingSource,n.start));
     void node;
     event.preventDefault();
     this.selectImageByElement(img);
    }
   }
  },true);
  doc.addEventListener('contextmenu',event=>{
   const target=event.target as Element;
   const anchorEl=target.closest('a');
   if(!anchorEl)return;
   event.preventDefault();event.stopPropagation();
   const href=anchorEl.getAttribute('href')??'';
   const resolved=resolveLink(this.app,href,this.file?.path??'');
   this.callbacks.router.showMenu(event,resolved,{
    onEdit:()=>{this.selectLinkByElement(anchorEl);},
    onRelink:()=>this.relinkLink(anchorEl,href),
    onOpenCurrent:()=>{if(resolved.kind==='anchor')this.scrollToAnchor(resolved.fragment);else void this.callbacks.router.open(resolved,{newLeaf:false,inAppExternal:true});},
    onOpenNew:()=>void this.callbacks.router.open(resolved,{newLeaf:true,inAppExternal:true}),
   });
  },true);
  doc.addEventListener('mouseover',event=>{
   if(!this.callbacks.settings().links.showHoverTarget)return;
   const anchorEl=(event.target as Element).closest('a');
   if(!anchorEl){this.callbacks.onHoverStatus(null);return;}
   const resolved=resolveLink(this.app,anchorEl.getAttribute('href')??'',this.file?.path??'');
   const t=this.callbacks.t;
   if(resolved.kind==='anchor'||resolved.kind==='library-html')this.callbacks.onHoverStatus(t('statusHoverLocal',{target:resolved.file?resolved.file.path:resolved.target+resolved.fragment}));
   else if(resolved.kind==='http')this.callbacks.onHoverStatus(t('statusHoverRemote',{host:new URL(resolved.target).host}));
   else if(resolved.reason==='not-found')this.callbacks.onHoverStatus(t('statusHoverMissing',{target:resolved.target}));
   else this.callbacks.onHoverStatus(null);
  });
  doc.addEventListener('submit',e=>e.preventDefault(),true);
  doc.addEventListener('keydown',e=>{
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(this.file&&this.session)void this.callbacks.save(this.file,this.session);}
  });
 }

 private describeSelection(){
  if(!this.session)return;
  const sel=this.selected;
  if(!sel)return;
  if(sel.kind==='text'&&sel.segmentId){
   const seg=parseDocument(this.session.workingSource).segments.find(x=>x.id===sel.segmentId);
   sel.description=seg?.kind;
   sel.offset=seg?.start;
  }
 }

 containsPoint(node:Text,x:number,y:number){
  const r=node.ownerDocument.createRange();
  r.selectNodeContents(node);
  return [...r.getClientRects()].some(rect=>x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom);
 }

 drawSelection(){
  if(!this.overlay)return;
  const editing=this.mode==='edit'||this.mode==='split';
  const id=editing?(this.hovered??(this.selected?.kind==='text'?this.selected.segmentId:null)):null;
  const node=id?this.textNodes.get(id):undefined;
  let rects:Iterable<DOMRect>=[];
  if(node){
   const range=node.ownerDocument.createRange();
   range.selectNodeContents(node);
   rects=range.getClientRects();
  }
  // 只替换旧框,shadow root 里的 <style> 要留着(见 renderSelectionBoxes)
  renderSelectionBoxes(this.overlay,rects,id===this.selected?.segmentId);
 }

 // ---- 内容更新管线 ----
 // 解析结果按 revision 登记:revision 一变缓存立即失效并重解析(会话里声明的
 // "只有匹配当前 revision 的解析结果可开放可视化编辑"这道门禁此前从未被调用 ——
 // 审计 round4 缺陷 42)。保存只改 baseSource、不动 workingSource,因此不会误判失效。
 currentIndex():SourceIndex{
  const s=this.session;
  if(!s)return new SourceIndex('');
  if(!s.canUseVisualEdits()||!(s.index instanceof SourceIndex))s.setParsed(new SourceIndex(s.workingSource));
  return s.index as SourceIndex;
 }
 currentModel():DocumentModel{return parseDocument(this.session?.workingSource??'');}
 currentTextMap():{index:SourceIndex; map:TextContainer[]}{const i=this.currentIndex();return {index:i,map:buildTextMap(i).containers};}

 syncTextNodes(){
  if(!this.session)return;
  const model=this.currentModel();
  for(const [id,node] of this.textNodes){
   const seg=model.segments.find(x=>x.id===id);
   const value=seg?.text??'';
   if(node.data!==value)node.data=value;
  }
  this.drawSelection();
 }

 // 编辑应用入口(可视化):段文本补丁
 applyTextPatch(patch:TextPatch,origin?:'edit'|'restore'){
  if(!this.session)return;
  try{
   this.session.applyEdit([patch],{origin,kind:'text',groupingKey:this.selected?.segmentId??'text'});
  }catch(e){
   new Notice(e instanceof PatchError?this.callbacks.t('noticePatchRejected'):this.callbacks.t('noticeSaveFailed'));
   console.error(e);
   return;
  }
  this.afterEdit();
 }

 // silent:调用方(如查找替换)会自行降级并汇总结果,不需要中途弹出失败提示
  applyPatches(patches:TextPatch[],kind:'text'|'attribute'|'image'|'structure'|'source',groupingKey:string|null,origin?:'edit'|'restore',silent=false):boolean{
  if(!this.session)return false;
  try{
   this.session.applyEdit(patches,{origin,kind,groupingKey});
  }catch(e){
   debugLog(`applyErr ${e instanceof Error?e.message:String(e)}`);
   // 补丁校验失败不是磁盘问题:报"保存失败"会让用户去查磁盘(审计复检 §3.3)
   if(!silent)new Notice(e instanceof PatchError?this.callbacks.t('noticePatchRejected'):this.callbacks.t('noticeSaveFailed'));
   console.error(e);
   return false;
  }
  this.afterEdit();
  return true;
 }

 private afterEdit(){
  this.syncTextNodes();
  this.applyChangeHighlights();
  if(this.sourceEditor&&this.sourceEditor.getDoc()!==this.session!.workingSource)this.sourceEditor.setDoc(this.session!.workingSource);
  this.refreshToolbar();
  if(this.file&&this.session)this.callbacks.onSessionEdited(this.file,this.session);
 }

 // ---- 修改标记(editor.showChangeHighlights)----
 // 用 CSS Custom Highlight API 做 Range 级高亮:不改 DOM 结构,所以 marker 注释与
 // 文字节点的相邻关系(选择/编辑全靠它)不受影响。宿主不支持时退到元素级属性高亮。
 private changeStyle:HTMLStyleElement|null=null;

 private changedSegmentIds():Set<string>{
  const out=new Set<string>();
  if(!this.session)return out;
  const base=parseDocument(this.session.baseSource);
  const work=parseDocument(this.session.workingSource);
  const before=new Map(base.segments.map(s=>[s.id,s.text]));
  for(const seg of work.segments){
   const old=before.get(seg.id);
   if(old===undefined||old!==seg.text)out.add(seg.id);
  }
  return out;
 }

 applyChangeHighlights(){
  const win=this.iframe?.contentWindow;
  const doc=win?.document;
  const CH='html-atelier-changed';
  if(!doc||!this.session)return;
  if(this.changeStyle){this.changeStyle.remove();this.changeStyle=null;}
  const highlights=(win as unknown as {CSS?:{highlights?:{delete(n:string):void;set(n:string,h:unknown):void}}}).CSS?.highlights;
  const HighlightCtor=(win as unknown as {Highlight?:new(...ranges:Range[])=>unknown}).Highlight;
  try{highlights?.delete(CH);}catch{/* 尚未注册:忽略 */}
  doc.querySelectorAll('[data-atelier-changed]').forEach(el=>el.removeAttribute('data-atelier-changed'));
  if(!this.callbacks.settings().editor.showChangeHighlights)return;
  const ids=this.changedSegmentIds();
  if(!ids.size)return;
  const style=doc.createElement('style');
  style.setAttribute('data-atelier-change','');
  style.textContent=`::highlight(${CH}){background-color:rgba(146,117,223,.28);text-decoration:underline wavy rgba(146,117,223,.85)}[data-atelier-changed]{background-color:rgba(146,117,223,.18)}`;
  doc.head?.append(style);
  this.changeStyle=style;
  const ranges:Range[]=[];
  for(const [id,node] of this.textNodes){
   if(!ids.has(id))continue;
   const range=doc.createRange();
   range.selectNodeContents(node);
   ranges.push(range);
  }
  if(!ranges.length)return;
  if(highlights&&HighlightCtor){
   try{highlights.set(CH,new HighlightCtor(...ranges));return;}catch{/* 落到元素级 */ }
  }
  for(const range of ranges)(range.startContainer.parentElement)?.setAttribute('data-atelier-changed','');
 }

 // 行号/软换行变化后重建源码编辑器:CM 扩展在构造时固定,重建比引入 compartment 更稳
 reconfigureSourceEditor(){
  if(!this.sourceEditor)return;
  this.flushSourceSync();
  this.detachSource();
  if(this.mode==='source'||this.mode==='split')this.mountSource();
 }

 // 源码编辑 → 400ms 防抖 → 统一事务(F19)
 // 定时器必须绑定"当初那个会话与那次加载":在防抖窗口内切换文件时,旧编辑器的文本
 // 会被提交给新会话,把 A 的内容写进 B(A→B 切换即复现,审计复检 §3.13 BLOCKER)。
 private cancelSourceSync(){
  if(this.previewTimer===null)return;
  window.clearTimeout(this.previewTimer);
  this.previewTimer=null;
 }

 // 立即提交待写的源码编辑(不等防抖)。只在会话与编辑器仍属于同一份文档时生效。
 private flushSourceSync(){
  if(this.previewTimer===null)return;
  window.clearTimeout(this.previewTimer);
  this.previewTimer=null;
  if(!this.session||!this.sourceEditor)return;
  const doc=this.sourceEditor.getDoc();
  if(doc===this.session.workingSource)return;
  this.applyPatches([{start:0,end:this.session.workingSource.length,expected:this.session.workingSource,replacement:doc}],'source','source-editor');
 }

 private scheduleSourceSync(){
  this.cancelSourceSync();
  const ownerSession=this.session;
  const ownerToken=this.loadToken;
  this.previewTimer=window.setTimeout(()=>{
   this.previewTimer=null;
   if(!this.session||!this.sourceEditor)return;
   // 会话或加载代次已经变了:这次待提交的文本属于上一个文件,直接丢弃
   if(this.session!==ownerSession||this.loadToken!==ownerToken)return;
   // 输入法组合中:doc 里是拼音,提交等于把它写进文档。重新排一次防抖,
   // 等组合结束(compositionend)后再提交,用户确认的文字一个字都不会少。
   if(this.sourceEditor.isComposing()){this.scheduleSourceSync();return;}
   const doc=this.sourceEditor.getDoc();
   if(doc===this.session.workingSource)return;
   this.applyPatches([{start:0,end:this.session.workingSource.length,expected:this.session.workingSource,replacement:doc}],'source','source-editor');
  },this.callbacks.settings().source.previewDelayMs);
 }

 private mountSource(){
  if(!this.sourceHost)return;
  if(!this.sourceEditor){
   void import('./sourceEditor').then(({SourceEditor})=>{
    if(!this.sourceHost)return;
    this.sourceHost.empty();
    this.sourceEditor=new SourceEditor({
     parent:this.sourceHost,
     lineNumbers:this.callbacks.settings().source.lineNumbers,
     lineWrapping:this.callbacks.settings().source.lineWrapping,
     doc:this.session?.workingSource??'',
     onDocChanged:()=>this.scheduleSourceSync(),
    });
   });
  }else this.sourceEditor.setDoc(this.session?.workingSource??'');
 }

 private detachSource(){
  this.sourceEditor?.destroy();
  this.sourceEditor=null;
 }

 // F11「修改」清单的定位:预览与源码都要能到那处改动。
 // 模式切换与 prepareLocate 同策略(用户反馈 2026-09-16:修改清单点定位不应被
 // 强切到分栏):源码模式切分栏(预览不可见时高亮落空),预览模式切编辑,
 // 编辑/分栏保持原样;只有源码面板可见时才滚源码。
 // 预览侧没有可指目标时(源码级改动 —— 链接/图片等属性编辑落不到文字节点;
 // 或该文字节点不在预览),必须退到分栏滚源码:编辑模式下静默不动等于"点了没反应"。
 locateChange(offset:number,segmentId?:string){
  const seg=segmentId?this.currentModel().segments.find(x=>x.id===segmentId):null;
  const dom=seg?this.textNodes.get(seg.id):null;
  if(!seg||!dom){
   if(this.mode!=='split')this.setMode('split');
   this.locateInSource(offset);
   return;
  }
  if(this.mode==='source')this.setMode('split');
  else if(this.mode==='preview')this.setMode('edit');
  if(this.mode==='source'||this.mode==='split')this.locateInSource(offset);
  dom.parentElement?.scrollIntoView({block:'center'});
  this.hovered=seg.id;
  this.drawSelection();
 }

 locateInSource(offset:number){
  if(!(this.mode==='source'||this.mode==='split'))this.setMode('split');
  const tryReveal=()=>{if(this.sourceEditor)this.sourceEditor.revealOffset(offset);else window.setTimeout(tryReveal,120);};
  tryReveal();
 }

 locateFromSource(offset:number){
  // 源码光标 → 预览滚动:找 offset 所在文字节点
  const index=this.currentIndex();
  let best:{id:string; start:number}|null=null;
  for(const seg of this.currentModel().segments){
   if(seg.start<=offset&&offset<=seg.end&&(!best||seg.start>best.start))best={id:seg.id,start:seg.start};
  }
  void index;
  if(best){
   const node=this.textNodes.get(best.id);
   node?.parentElement?.scrollIntoView({block:'center'});
  }
 }

 // 链接/图片选择(F08/F15)
 // F07:失效本地链接重新选择目标(草稿级修改,可撤销)
 private relinkLink(anchorEl:Element,href:string){
  void import('./modals').then(({RelinkModal})=>{
   new RelinkModal(this.app,(file)=>{
    const index=this.currentIndex();
    const el=index.nodes.find((n):n is Extract<SourceNode,{kind:'element'}>=>n.kind==='element'&&n.tag==='a'&&n.start>=0);
    const target=el?el.attrs.find((a:{name:string})=>a.name==='href'):null;
    if(!target){new Notice(this.callbacks.t('noticeSaveFailed'));return;}
    // 重链接必须按原引号转义新路径:路径里出现引号/& 时原样写入会截断属性
    const quote=target.quote;
    const next=file.path+resolvedFragmentOf(href);
    this.applyPatches([{start:target.valueStart,end:target.valueEnd,expected:target.value,
     replacement:escapeAttrValue(next,quote)}],'attribute','relink');
    new Notice(this.callbacks.t('noticeCopied'));
   }).open();
  });
 }

 // 被点击元素在同类标签中的序号。DOM 顺序与 SourceIndex 的登记顺序一致,
 // 因此序号可精确定位到源节点。此前按属性值反查,两个同值元素永远命中第一个,
 // 于是"编辑第二个链接/改第二张图"会改到第一个上(审计复检 §3.19)。
 private sourceElementAt(domEl:Element,tag:string):Extract<SourceNode,{kind:'element'}>|null{
  const doc=domEl.ownerDocument;
  const sameTag=[...doc.querySelectorAll(tag)];
  const pos=sameTag.indexOf(domEl);
  const sourceEls=this.currentIndex().elements(tag);
  if(pos>=0&&pos<sourceEls.length)return sourceEls[pos];
  return null;
 }

 selectLinkByElement(anchorEl:Element){
  const index=this.currentIndex();
  const href=anchorEl.getAttribute('href');
  const node=this.sourceElementAt(anchorEl,'a')
   ??index.nodes.find((n):n is Extract<SourceNode,{kind:'element'}>=>n.kind==='element'&&n.tag==='a'&&n.attrs.find(a=>a.name==='href')?.value===(href??''));
  this.selected=node?{kind:'link',nodeId:node.id,offset:node.start,tagName:'a'}:null;
  this.callbacks.onSelectChanged(this.selected,this.session);
 }

 selectImageByElement(img:Element){
  const index=this.currentIndex();
  const src=img.getAttribute('src')??'';
  const rect=img.getBoundingClientRect();
  const node=this.sourceElementAt(img,'img')
   ??index.nodes.find((n):n is Extract<SourceNode,{kind:'element'}>=>
    n.kind==='element'&&n.tag==='img'&&n.attrs.find(a=>a.name==='src')?.value===src);
  this.selected=node?{kind:'image',nodeId:node.id,offset:node.start,tagName:'img',
   description:`${Math.round(rect.width)}×${Math.round(rect.height)}`}:null;
  this.callbacks.onSelectChanged(this.selected,this.session);
 }

 // F26:保存后焦点恢复(滚动/选中/焦点与光标)
 saveFocus():void{
  this.preSaveSelection=this.selected;
  // 滚动比例取可见帧(预加载期间 this.iframe 是隐藏空白帧,会取到 0——审计 M1)
  const capWin=(this.visibleFrame??this.iframe)?.contentWindow??null;
  this.preSaveScroll=capWin?this.callbacks.nav.scrollRatioOf(capWin):null;
  // 记录面板表单里持有焦点的输入框与光标区间:保存按钮点击或命令执行会把焦点顶到
  // 按钮/body 上,结束后要放回原处才能继续打字(2026-09-30 复查:保存后焦点离开侧栏文字框)。
  // 按钮路径下 activeElement 已是按钮,用跟踪到的最近面板输入框兜底。
  const active=this.contentEl.ownerDocument.activeElement;
  let focusEl:HTMLInputElement|HTMLTextAreaElement|null=null;
  if(active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement)focusEl=active;
  else if(this.lastPanelInput?.isConnected&&this.lastPanelInput.closest('.html-atelier-panel'))focusEl=this.lastPanelInput;
  this.preSaveFocus=focusEl?{el:focusEl,start:focusEl.selectionStart,end:focusEl.selectionEnd}:null;
 }
 restoreFocusAfterSave(){
  if(!this.callbacks.settings().editor.restoreFocusAfterSave)return;
  const resWin=(this.visibleFrame??this.iframe)?.contentWindow??null;
  if(this.preSaveScroll!==null&&resWin)this.callbacks.nav.restoreScroll(resWin,this.preSaveScroll);
  if(this.preSaveSelection?.kind==='text'&&this.preSaveSelection.segmentId){
   const exists=this.currentModel().segments.some(x=>x.id===this.preSaveSelection!.segmentId);
   if(exists){
    // 选中本就没丢(保存不重建预览、不改 selected)时跳过 onSelectChanged:它会
    // force 重建面板,把焦点恢复的目标输入框换掉(2026-09-30 复查:保存后焦点
    // 离开侧栏文字框的真凶之一)
    if(this.selected!==this.preSaveSelection){this.selected=this.preSaveSelection;this.callbacks.onSelectChanged(this.selected,this.session);}
    this.syncTextNodes();
   }
   else{this.selected=null;this.callbacks.onSelectChanged(null,this.session);}
  }
  // 焦点只在"当前焦点是保存动作的副作用"(body/面板按钮)或仍在原控件上时恢复;
  // 用户保存期间已切到别的输入框/别的视图时,不抢焦点
  const f=this.preSaveFocus;
  if(f){
   const doc=this.contentEl.ownerDocument;
   const cur=doc.activeElement;
   // 视图自绘工具栏(toolbarPlacement:'view')不在侧栏面板里,同样是保存动作的
   // 焦点副作用,漏掉它的话该布局下"保存后焦点不回输入框"依旧复现(审计 m3)
   const sideEffectOnly=cur===f.el||cur===doc.body||cur===null
    ||(cur instanceof HTMLElement&&cur.tagName==='BUTTON'&&!!cur.closest('.html-atelier-panel,.html-atelier-toolbarhost'));
   if(sideEffectOnly){
    // 保存期间面板可能被重建(焦点在保存按钮上时,输入框的防重建保护不生效),
    // 原节点随之被换掉:面板里恰好只有一个文本域时,按"同一字段"的替身恢复
    let target:HTMLInputElement|HTMLTextAreaElement=f.el;
    if(!f.el.isConnected){
     const tas=doc.querySelectorAll<HTMLTextAreaElement>('.html-atelier-panel textarea');
     if(tas.length===1)target=tas[0];
    }
    if(target.isConnected){
     target.focus();
     if(f.start!==null&&f.end!==null){
      const len=target.value?.length??0;
      try{target.setSelectionRange(Math.min(f.start,len),Math.min(f.end,len));}catch{/* 非文本类输入框 */}
     }
    }
   }
  }
 }
 private preSaveSelection:SelectionInfo|null=null;
 private preSaveScroll:number|null=null;
 private preSaveFocus:{el:HTMLInputElement|HTMLTextAreaElement; start:number|null; end:number|null}|null=null;

}

function resolvedFragmentOf(href:string):string{
 const i=href.indexOf('#');
 return i>=0?href.slice(i):'';
}

function sourceHasImg(source:string,offset:number){return offset>=0&&offset<source.length;}

function setCss(el:Element,key:string,value:string){(el as HTMLElement).style.setProperty(key,value);return el;}

