import {MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf} from 'obsidian';
import {DocumentSession} from './core/session';
import {TextPatch} from './core/patch';
import {AtelierSettings,normalizeSettings} from './settings/schema';
import {AtelierSettingTab} from './settings/tab';
import {createTranslator,resolveLocale,Translator} from './i18n';
import {LinkRouter,electronBrowserLauncher} from './services/links';
import {NavigationService} from './services/nav';
import {SidebarCoordinator} from './services/sidebar';
import {DraftsService,getDeviceId} from './services/draftsService';
import {MergeService} from './services/mergeService';
import {NoteReferenceService,embedCode} from './services/noteRef';
import {SaveAsService} from './services/saveService';
import {createAssetRefresher} from './services/assetRefresh';
import {isPageDependency} from './services/assets';
import {guardCommand} from './services/commands';
import {TaskHost,WorkerTransport} from './services/regexp/workerHost';
import {RegExpSearchAdapter} from './services/regexp/regexpSearch';
import {HtmlFileView,HTML_VIEW,SelectionInfo} from './views/htmlView';
import {HtmlPanelView,HTML_PANEL} from './views/panel';
import {disabledTarget} from './views/toolbar';
import {SaveAsModal,ConflictModal,DraftManagerModal,filePickerModal} from './views/modals';
import {EmbedRenderChild} from './embed/index';
import {migrateLegacyDrafts} from './drafts/migrate';
import {clearDebugLog} from './services/debug';

const WORKER_SRC='/*__HTML_ATELIER_WORKER_BUNDLE__*/';

interface PluginData {settings:unknown; retained?:Record<string,unknown>; nav?:unknown; migratedV1?:boolean}
interface LegacyStored {drafts:Record<string,{source:string; changes:[string,string][]}>}

export default class HtmlAtelier extends Plugin {
 private hostLang='';
 settings!:AtelierSettings;
 nav=new NavigationService();
 sidebar!:SidebarCoordinator;
 drafts!:DraftsService;
 merge=new MergeService(this.app);
 noteRef!:NoteReferenceService;
 saveAs!:SaveAsService;
 regexp!:RegExpSearchAdapter;
 sessions=new Map<string,DocumentSession>();
 active:HtmlFileView|null=null;
 retainedUnknown:Record<string,unknown>={};
 private translator:Translator=createTranslator('zh-CN');
 // 稳定的委派函数:所有服务/视图在构造时拿到的都是这一个引用,因此
 // ui.language 变更只需替换 translator 即可全场生效(此前 t 是快照,
 // 设置回调只存盘,切换语言必须重载插件 —— 审计 round4 缺陷 33)
 private t:Translator=(key,params)=>this.translator(key,params);
 private settingTab!:AtelierSettingTab;
 private router!:LinkRouter;
 private prevLeafWasHtml=false;
 // 卸载中:关闭视图不再弹确认框(应用退出/禁用插件时不该拦一个模态)
 private unloading=false;
 private assetRefresh!:ReturnType<typeof createAssetRefresher>;

 async onload(){
  const data=(await this.loadData().catch(()=>null)) as PluginData|null;
  const parsed=normalizeSettings(data?.settings===undefined?data:data.settings);
  this.settings=parsed.settings;
  this.retainedUnknown=parsed.retainedUnknown;
  const hostLang=(globalThis as {moment?:{locale:()=>string}}).moment?.locale()??'';
  this.translator=createTranslator(resolveLocale(this.settings.ui.language,hostLang));
  this.hostLang=hostLang;
  // 诊断数组挂在 window 上,不清空会跨插件重载累积(审计 round4 缺陷 32)
  clearDebugLog();
  // 全部服务先构造,再执行一次性迁移(迁移依赖 drafts;顺序错误会在有旧草稿的库中
  // 中断 onload,导致视图/命令全部未注册——实测教训)
  this.sidebar=new SidebarCoordinator(this.app,()=>this.settings,this.t);
  this.drafts=new DraftsService(this.app,()=>this.settings,getDeviceId());
  this.noteRef=new NoteReferenceService(this.app,this.t);
  this.saveAs=new SaveAsService(this.app,this.t);
  this.assetRefresh=createAssetRefresher(()=>void this.refreshDependentViews());
  this.regexp=new RegExpSearchAdapter(new TaskHost(blobWorkerTransport(WORKER_SRC),{timeoutMs:1000}));
  this.routerInit();
  this.nav.fromJSON(data?.nav);
  if(!data?.migratedV1&&data&&(data as unknown as LegacyStored).drafts){
   try{await this.migrateV1Drafts((data as unknown as LegacyStored).drafts);}
   catch(e){console.error('v1 草稿迁移失败,保留原始数据',e);}
  }

  this.registerView(HTML_VIEW,(leaf:WorkspaceLeaf)=>new HtmlFileView(leaf,this.viewCallbacks()));
  this.registerView(HTML_PANEL,(leaf:WorkspaceLeaf)=>new HtmlPanelView(leaf,this.panelCallbacks()));
  for(const ext of ['html','htm']){
   try{this.registerExtensions([ext],HTML_VIEW);}
   catch{new Notice(this.t('noticeExtensionTakenOver',{ext}),10000);}
  }
  this.registerCommands();
  this.registerEvents();
  this.settingTab=new AtelierSettingTab(this.app,this,()=>this.settings,s=>this.applySettings(s));
  this.addSettingTab(this.settingTab);
  (window as unknown as {htmlAtelierExists?:(p:string)=>boolean}).htmlAtelierExists=(p:string)=>!!this.app.vault.getAbstractFileByPath(p);
  this.registerDomEvent(window,'html-atelier-cmd' as unknown as 'click',((e:CustomEvent)=>{const {name}=e.detail as {name:string};
   if(name==='save-as')this.openSaveAs();
   else if(name==='copy-page-link')this.commandCopyPageLink();
   else if(name==='copy-section-link')this.commandCopySectionLink();
   else if(name==='copy-embed'){const v=this.activeHtmlView();if(v?.file)void navigator.clipboard.writeText(embedCode(v.file.path,'auto','auto',null,true));}
   else if(name==='draft-manager')new DraftManagerModal(this.t,this.drafts,p=>{void this.app.workspace.openLinkText(p,'',false);},this.app,()=>this.settings).open();
   else if(name==='conflict')this.openConflict();
  }) as unknown as EventListener);
  this.app.workspace.onLayoutReady(()=>{
   const view=this.app.workspace.getActiveViewOfType(HtmlFileView);
   if(view){this.active=view;void this.showPanel(false);}
  });
 }

 // 卸载(禁用插件/退出应用):设计 §11.3 要求"卸载尽最大努力提交"。
 // 此前没有 onunload,于是最后一个防抖窗口的内容只留在内存里。
 onunload(){
  this.unloading=true;
  // 尽最大努力提交(设计 §11.3):不等待写盘,退出流程不因我们变慢
  for(const session of this.sessions.values())if(session.dirty)void this.drafts.flush(session);
 }

 private viewCallbacks(){
  return {
   getSession:(file:TFile)=>this.getSession(file),
   save:(file:TFile,session:DocumentSession)=>this.saveFile(file,session),
   onSessionEdited:(_file:TFile,session:DocumentSession)=>{this.drafts.scheduleSave(session);this.refreshPanels();},
   onSelectChanged:(sel:SelectionInfo|null)=>{
    (window as unknown as {htmlAtelierSelection?:SelectionInfo|null}).htmlAtelierSelection=sel;
    this.refreshPanels(true);
   },
   onHoverStatus:(text:string|null)=>{(window as unknown as {htmlAtelierHover?:string|null}).htmlAtelierHover=text;},
   nav:this.nav,
   settings:()=>this.settings,
   t:this.t,
   router:this.router,
   openLibraryFile:(file:TFile,newLeaf:boolean)=>{void this.app.workspace.openLinkText(file.path,'',newLeaf);},
   openMarkdown:(path:string,fragment:string,newLeaf:boolean)=>{void this.app.workspace.openLinkText(path,fragment,newLeaf);},
   sidebarSuppressed:()=>this.sidebar.isSuppressed()||this.sidebar.isManuallyCollapsed(this.sidebar.panelLeaves().length>0),
   isUnloading:()=>this.unloading,
   // 工具栏在侧栏承载时,视图内的状态变化(模式/视口/导航栈/加载)只能通过这里
   // 传到面板;只刷新面板工具栏,不走 refreshPanels,避免与面板刷新互相触发
   onViewStateChanged:()=>this.refreshPanelToolbars(),
  };
 }

 private panelCallbacks(){
  return {
   settings:()=>this.settings,
   t:this.t,
   toolbarTarget:()=>this.activeHtmlView()?.toolbarTarget()??disabledTarget(),
   getActiveSession:()=>{
    const view=this.activeHtmlView();
    if(!view?.session||!view.file)return null;
    return {session:view.session,filePath:view.file.path};
   },
   activeFilePath:()=>this.activeHtmlView()?.file?.path??null,
   applyTextPatch:(patch:TextPatch,origin?:'edit'|'restore')=>this.activeHtmlView()?.applyTextPatch(patch,origin),
   applyPatches:(patches:TextPatch[],kind:'text'|'attribute'|'image'|'structure'|'source',groupingKey:string|null,origin?:'edit'|'restore',silent?:boolean)=>this.activeHtmlView()?.applyPatches(patches,kind,groupingKey,origin,silent)??false,
   locateInSource:(offset:number)=>this.activeHtmlView()?.locateInSource(offset),
   locateChange:(offset:number,segmentId:string|null)=>this.activeHtmlView()?.locateChange(offset,segmentId??undefined),
   locatePreview:(segmentId:string)=>{
    const v=this.activeHtmlView();
    if(!v)return;
    // 源码模式/预览模式都要先让预览可见,否则下面的滚动打在隐藏的 iframe 上
    v.prepareLocate();
    v.currentAnchor=segmentId.startsWith('#')?segmentId:`#${segmentId}`;
    v.scrollToAnchor(v.currentAnchor);
    v.syncTextNodes();
   },
   revealInPreview:(containerIndex:number,lStart:number,lEnd:number)=>{
    return this.activeHtmlView()?.locateLogical(containerIndex,lStart,lEnd)??false;
   },
   saveActive:()=>{const v=this.activeHtmlView();if(v?.file&&v.session)void this.saveFile(v.file,v.session);},
   undo:()=>{const v=this.activeHtmlView();try{v?.session?.undo();v?.syncTextNodes();this.refreshPanels();}catch(e){new Notice(e instanceof Error?e.message:String(e));}},
   redo:()=>{const v=this.activeHtmlView();try{v?.session?.redo();v?.syncTextNodes();this.refreshPanels();}catch(e){new Notice(e instanceof Error?e.message:String(e));}},
   openFileByPath:(path:string)=>{void this.app.workspace.openLinkText(path,'',false);},
   pickLibraryFile:async(filter:(f:{path:string; extension:string})=>boolean)=>{
    return new Promise<string|null>(resolve=>{
     filePickerModal(this.app,f=>filter({path:f.path,extension:f.extension}),path=>resolve(path));
    });
   },
   importImage:async()=>{
    const input=createEl('input');
    input.type='file';
    input.accept='image/*';
    const picked=await new Promise<File|null>(r=>{input.addEventListener('change',()=>r(input.files?.[0]??null));input.click();});
    if(!picked)return null;
    const view=this.activeHtmlView();
    const dir=view?.file?.parent?.path&&view.file.parent.path!=='/'?view.file.parent.path:'';
    const ext=picked.name.match(/(\.[^.]+)$/)?.[1]??'';
    const stem=picked.name.replace(/(\.[^.]+)$/,'');
    let name=picked.name;let n=1;
    while(this.app.vault.getAbstractFileByPath(dir?`${dir}/${name}`:name))name=`${stem}-${n++}${ext}`;
    const path=dir?`${dir}/${name}`:name;
    const buf=await picked.arrayBuffer();
    await this.app.vault.createBinary(path,buf);
    new Notice(this.t('imageImportDone',{path}));
    return path;
   },
   copyPageLink:()=>this.commandCopyPageLink(),
   copySectionLink:()=>this.commandCopySectionLink(),
   conflictOpen:()=>this.openConflict(),
   adoptRemote:()=>void this.adoptRemote(),
   exportDraftAsCopy:()=>this.openSaveAs(),
   searchAll:(q:string,caseSensitive:boolean,includeHidden:boolean)=>{
    void q;void caseSensitive;void includeHidden;return [];
   },
  };
 }

 private routerInit(){
  if(this.router)return this.router;
  this.router=new LinkRouter(this.app,()=>this.settings,this.t,electronBrowserLauncher(()=>this.settings),
   (path,fragment,newLeaf)=>{
    if(!path){this.activeHtmlView()?.scrollToAnchor(fragment);return;}
    if(fragment)(window as unknown as {htmlAtelierPendingAnchor?:string}).htmlAtelierPendingAnchor=fragment;
    void this.app.workspace.openLinkText(path,'',newLeaf);
   },
   (file,newLeaf)=>{void this.app.workspace.openLinkText(file.path,'',newLeaf);});
  return this.router;
 }

 private activeHtmlView():HtmlFileView|null{
  const view=this.app.workspace.getActiveViewOfType(HtmlFileView);
  if(view)return view;
  return this.app.workspace.getLeavesOfType(HTML_VIEW).map(l=>l.view as HtmlFileView).find(v=>v.session!==null)??null;
 }

 // ---- 会话与保存(§12.4/F26) ----
 private pendingSessions=new Map<string,Promise<DocumentSession>>();
 async getSession(file:TFile):Promise<DocumentSession>{
  const existing=this.sessions.get(file.path);
  if(existing)return existing;
  const pending=this.pendingSessions.get(file.path);
  if(pending)return pending;
  const load=this.loadSession(file);
  this.pendingSessions.set(file.path,load);
  try{return await load;}finally{this.pendingSessions.delete(file.path);}
 }
 private async loadSession(file:TFile):Promise<DocumentSession>{
  const disk=await this.app.vault.read(file);
  const recovered=await this.drafts.recover(file).catch(()=>null);
  const session=new DocumentSession(file.path,disk,recovered?.workingSource??disk,
   {maxEvents:this.settings.editor.historyLimit,maxBytes:32*1024*1024,mergeDelayMs:this.settings.editor.mergeDelayMs},
   // nowRevision 必须继承草稿里的 revision:草稿层按单调 revision 拒绝旧写入,新会话若从 0 开始,
   // 则重开后前 N 次编辑(N = 上次会话最终 revision)全部被拒、备份静默失效
   // (审计 round4 BUG 3:实测 39 次连续失败)。
   recovered?.revision??0);
  if(recovered)session.contentState=recovered.conflict?'conflict':'dirty';
  this.sessions.set(file.path,session);
  return session;
 }

 async saveFile(file:TFile,session:DocumentSession,quiet=false):Promise<boolean>{
  const view=this.activeHtmlView();
  view?.saveFocus();
  const io={process:async(decide:(current:string)=>string|null)=>{
   let result:'written'|'conflict'='conflict';
   await this.app.vault.process(file,current=>{
    const next=decide(current);
    if(next===null)throw new Error('html-atelier-conflict');
    result='written';
    return next;
   });
   return result;
  }};
  const outcome=await session.save(io);
  if(outcome.result==='written'){
   await this.drafts.clearDraft(file.path);
   for(const leaf of this.app.workspace.getLeavesOfType(HTML_VIEW)){
    const v=leaf.view as HtmlFileView;
    if(v.session===session)v.renderFrame(true);
   }
   view?.restoreFocusAfterSave();
   await this.drainQueuedExternal(file,session);
   this.refreshPanels();
   return true;
  }
  if(!quiet){
   if(outcome.result==='conflict')new Notice(this.t('noticeExternalConflict'),7000);
   else if(outcome.result==='io-error')new Notice(this.t('noticeSaveFailed'));
   else if(outcome.result==='missing')new Notice(this.t('noticeFileMissing'),7000);
   // 'blocked' 此前没有任何提示:正在保存/合并时点保存(工具栏按钮不随状态禁用)是
   // 静默无操作;本地冲突也走这条(审计 round4 BUG 6 的第二半)
   else if(outcome.result==='blocked')new Notice(this.t(session.contentState==='conflict'?'noticeExternalConflict':'noticeSaveBusy'),7000);
  }
  await this.drainQueuedExternal(file,session);
  this.refreshPanels();
  return false;
 }

 // 保存期间被排队的外部变化:保存一结束就读取磁盘补发,否则它会随标记一起被丢掉,
 // 会话自认干净而磁盘已是对方版本,下一次保存即覆盖(审计 round4 BUG 21)。
 private async drainQueuedExternal(file:TFile,session:DocumentSession):Promise<void>{
  if(!session.hasQueuedExternal||session.operation!=='idle')return;
  session.consumeQueuedExternal();
  const disk=await this.readOrNull(file);
  if(disk!==null)session.externalChange(disk);
 }

 // 设置变更的统一入口(设置页回调)。三级要求:
 // 1) 必须**快照**入参:设置页传进来的就是它自己那份可变副本,直接存引用会让
 //    this.settings 与 next 变成同一个对象 —— 下一次变更时 prev 和 next 是同一个引用,
 //    所有 *Changed 判定恒为 false,于是"改第二项设置不再生效"(语言选了英文但界面不变、
 //    开关拨了预览不重绘)。用户反馈设置页问题时暴露(2026-09-15)。
 // 2) ui.language 必须立即生效 —— translator 是稳定委派函数,替换实现即可让所有已持有
 //    该引用的服务/视图改用新语言(此前设置回调只存盘,必须重载插件 —— 审计 round4 缺陷 33);
 // 3) 影响渲染的设置必须让已经渲染出来的内容跟上:网络资源开关影响 meta CSP,
 //    只能重绘 iframe 才生效(此前要手动刷新 —— 审计 round4 缺陷 38 的附带项)。
 private applySettings(incoming:AtelierSettings){
  const prev=this.settings;
  const next=JSON.parse(JSON.stringify(incoming)) as AtelierSettings;
  const langChanged=next.ui.language!==prev.ui.language;
  const networkChanged=next.preview.allowNetworkAssets!==prev.preview.allowNetworkAssets;
  const highlightChanged=next.editor.showChangeHighlights!==prev.editor.showChangeHighlights;
  const sourceChanged=next.source.lineNumbers!==prev.source.lineNumbers||next.source.lineWrapping!==prev.source.lineWrapping;
  const toolbarMoved=next.editor.toolbarPlacement!==prev.editor.toolbarPlacement;
  const embeddingsChanged=next.embeds.enabled!==prev.embeds.enabled
   ||next.embeds.defaultHeight!==prev.embeds.defaultHeight
   ||next.embeds.autoHeightMax!==prev.embeds.autoHeightMax
   ||next.embeds.showDrafts!==prev.embeds.showDrafts
   ||next.embeds.showToolbar!==prev.embeds.showToolbar;
  this.settings=next;
  void this.saveData(this.buildPluginData());
  if(langChanged){
   this.translator=createTranslator(resolveLocale(next.ui.language,this.hostLang));
   this.settingTab.display();
   this.refreshPanels(true);
   for(const leaf of this.app.workspace.getLeavesOfType(HTML_VIEW))(leaf.view as HtmlFileView).relabelToolbar();
   // 面板承载工具栏时,它才是那段 aria-label 的所在地
   for(const leaf of this.app.workspace.getLeavesOfType(HTML_PANEL))(leaf.view as HtmlPanelView).relabel();
  }
  // 工具栏换位必须立即生效,否则用户改了设置却还看着旧位置那一条
  if(toolbarMoved){
   for(const leaf of this.app.workspace.getLeavesOfType(HTML_VIEW))(leaf.view as HtmlFileView).syncToolbarPlacement();
   for(const leaf of this.app.workspace.getLeavesOfType(HTML_PANEL))(leaf.view as HtmlPanelView).syncToolbarPlacement();
   if(this.panelNeeded())void this.showPanel(false);
  }
  if(networkChanged)this.rerenderFrames();
  if(highlightChanged)for(const leaf of this.app.workspace.getLeavesOfType(HTML_VIEW))(leaf.view as HtmlFileView).applyChangeHighlights();
  if(sourceChanged)for(const leaf of this.app.workspace.getLeavesOfType(HTML_VIEW))(leaf.view as HtmlFileView).reconfigureSourceEditor();
  if(embeddingsChanged)this.refreshEmbedHosts();
 }

 // 嵌入渲染参数改变后,已渲染的 Markdown 预览里仍是旧参数(乃至仍显示已关闭的嵌入)。
 // 代码块处理器只在 Markdown 重新渲染时被调用,所以这里主动让所有 Markdown 视图重绘。
 private refreshEmbedHosts(){
  for(const leaf of this.app.workspace.getLeavesOfType('markdown')){
   const v=leaf.view as unknown as {previewMode?:{rerender?:(full?:boolean)=>void}};
   try{v.previewMode?.rerender?.(true);}catch{/* 非阅读模式:忽略 */}
  }
 }

 // 当前文档是否还是 HTML。判据是宿主的 getActiveFile():它在活动叶子不是文档视图
 // (侧栏视图 view.navigation===false)时会退回到最近激活的导航视图,因此点侧栏页签
 // 不会改变它 —— 这正是"没有离开 HTML 文件"的语义判据。
 private htmlStillActive():boolean{
  const file=this.app.workspace.getActiveFile();
  if(!(file instanceof TFile))return false;
  const ext=file.extension.toLowerCase();
  return ext==='html'||ext==='htm';
 }

 // 活动叶子是否属于侧栏(左右侧栏都算,辅助判据)。三条信号都在真实 Obsidian 1.13.7
 // 实测过(probe/results/panel-tab-diag.json):
 //   我们的 HTML 视图:inSidedock=false inModRoot=true;getRoot()≠left/rightSplit
 //   文件列表(左):  inSidedock=true  inModLeft=true;getRoot()===leftSplit;parent 链 …=leftSplit
 //   反链(右):      inSidedock=true  inModRight=true;getRoot()===rightSplit
 //
 // **唯独不能用 getRoot().getType()**:宿主的 WorkspaceItem 根本没有 getType ——
 // obsidian.asar 里搜不到任何 getType 实现(但 getRoot() 本身存在且返回 sidedock),
 // 那种写法在真机上恒为 undefined,会被当成"主编辑区",面板照旧被关掉
 // (我上一版就是这样,用户实测问题依旧)。
 private isSidebarLeaf(leaf:WorkspaceLeaf|null):boolean{
  if(!leaf)return false;
  const ws=this.app.workspace as unknown as {leftSplit?:unknown;rightSplit?:unknown};
  // 1) DOM:View.containerEl(公开 API,0.9.7 起)的祖先里有 .mod-sidedock
  //    (宿主 WorkspaceSidedock 构造函数里 addClass("mod-sidedock")/("mod-"+side+"-split"))
  try{
   const host=(leaf as unknown as {view?:{containerEl?:HTMLElement}}).view?.containerEl;
   if(host?.closest?.('.mod-sidedock, .mod-left-split, .mod-right-split'))return true;
  }catch{/* 继续下一条 */}
  // 2) 模型:getRoot() 在侧栏叶子上就是 leftSplit/rightSplit(实测)
  try{
   const root=(leaf as unknown as {getRoot?:()=>unknown}).getRoot?.();
   if(root&&(root===ws.leftSplit||root===ws.rightSplit))return true;
  }catch{/* 继续下一条 */}
  // 3) parent 链最终指向 leftSplit/rightSplit
  try{
   let item:unknown=leaf;
   for(let i=0;i<8&&item;i++){
    if(item===ws.leftSplit||item===ws.rightSplit)return true;
    item=(item as {parent?:unknown}).parent;
   }
  }catch{/* 忽略 */}
  return false;
 }

 private refreshPanels(force=false){
  for(const leaf of this.app.workspace.getLeavesOfType(HTML_PANEL))(leaf.view as HtmlPanelView).refresh(force);
  for(const leaf of this.app.workspace.getLeavesOfType(HTML_VIEW))(leaf.view as HtmlFileView).refreshToolbar();
 }

 // 只要面板工具栏是模式切换的唯一入口,面板就属于必需而不是可选
 private panelNeeded():boolean{
  return this.settings.sidebar.autoShowHtml||this.settings.editor.toolbarPlacement==='sidebar';
 }

 private refreshPanelToolbars(){
  // ?.():插件重载瞬间,残留的面板叶子可能还挂着旧视图实例,没有新方法 ——
  // 真机实测此处抛 TypeError 会把 HtmlFileView.onOpen 一并带崩("Failed to open view")
  for(const leaf of this.app.workspace.getLeavesOfType(HTML_PANEL))(leaf.view as HtmlPanelView).refreshToolbar?.();
 }

 private rerenderFrames(){
  for(const leaf of this.app.workspace.getLeavesOfType(HTML_VIEW)){
   const v=leaf.view as HtmlFileView;
   // 不再跳过脏会话:renderFrame 从 session.workingSource 重建,不存在丢弃草稿的风险,
   // 而"正在改 HTML 同时调 CSS"恰恰是最需要自动刷新的场景(审计复检 §3.12)。
   if(v.session)v.renderFrame(true);
  }
 }

 // 资产变化 → 依赖判断 → 只刷新真正引用它的视图(设计 §7.4:依赖图有上限、有环检测)
 private pendingAssets=new Set<string>();
 private queueAssetRefresh(path:string){
  this.pendingAssets.add(path);
  this.assetRefresh();
 }

 private async refreshDependentViews(){
  const paths=[...this.pendingAssets];
  this.pendingAssets.clear();
  if(!paths.length)return;
  const readCss=async(p:string):Promise<string|null>=>{
   const f=this.app.vault.getAbstractFileByPath(p);
   if(!(f instanceof TFile))return null;
   return this.app.vault.cachedRead(f).catch(()=>null);
  };
  for(const leaf of this.app.workspace.getLeavesOfType(HTML_VIEW)){
   const v=leaf.view as HtmlFileView;
   const session=v.session;
   if(!session||!v.file)continue;
   try{
    for(const p of paths){
     if(await isPageDependency(p,session.workingSource,v.file.path,readCss)){v.renderFrame(true);break;}
    }
   }catch(e){console.error(e);}
  }
 }

 async showPanel(explicit=false){
  await this.sidebar.showPanel(leaf=>{
   (leaf.view as HtmlPanelView).refresh(true);
  },explicit);
 }

 // ---- 事件(F01/外部变化/F17) ----
 private registerEvents(){
  this.sidebar.observe();
  this.registerEvent(this.app.workspace.on('active-leaf-change',leaf=>{
   const view=leaf?.view instanceof HtmlFileView?leaf.view:null;
   if(view){
    this.active=view;
    if(this.panelNeeded()&&!this.sidebar.isSuppressed())void this.showPanel(false);
    this.refreshPanels();
    this.prevLeafWasHtml=true;
   }else if(leaf?.view.getViewType()!==HTML_PANEL){
    // 只有**当前文档不再是 HTML** 才算离开 HTML 文件。两条信号都从宿主自身取证:
    //
    // 1) 文档语义(主判据):宿主的 getActiveFile() 实现是
    //      `this.activeEditor?.file || this.getActiveFileView()?.file || null`,
    //    而 getActiveFileView() 在活动叶子 view.navigation===false(侧栏视图就是这种)时
    //    会退回"activeTime 最新的导航视图" —— 也就是用户真正在读的那个文档。
    //    所以点侧栏页签时它仍返回我们的 HTML 文件,不会误判成离开。
    // 2) 叶子位置(辅助):侧栏叶子的容器在 .mod-sidedock 内(宿主 WorkspaceSidedock
    //    构造函数加的类)。它只用来保留"切到关系图/空白标签也关面板"的老行为;
    //    即便这条判错,第 1 条也足以挡住"点侧栏页签被误判成离开"。
    if(!this.htmlStillActive()&&!this.isSidebarLeaf(leaf)){
     // 顺序很重要:先离开 HTML(此时记录里还是"进入 HTML 前那个面板"),再更新记录。
     // 反过来会用"用户刚切到的叶子"覆盖记录,于是 otherTarget='previous' 恢复出来的
     // 正是当前叶子本身(审计 round4 BUG 35)。
     if(this.prevLeafWasHtml){
      this.prevLeafWasHtml=false;
      void this.sidebar.closeOnLeave(this.app.workspace.getActiveFile());
     }
     this.active=null;
     this.refreshPanels();
    }
    if(leaf)this.sidebar.notePreviousLeaf(leaf);
   }
  }));
  this.registerEvent(this.app.workspace.on('file-open',file=>{
   const view=this.app.workspace.getActiveViewOfType(HtmlFileView);
   if(file instanceof TFile&&view){
    this.active=view;
    if(this.panelNeeded()&&!this.sidebar.isSuppressed())void this.showPanel(false);
    this.refreshPanels();
   }
  }));
  this.registerEvent(this.app.vault.on('modify',file=>{
   if(!(file instanceof TFile))return;
   const session=this.sessions.get(file.path);
   if(session){
    void (async()=>{
     const disk=await this.app.vault.read(file).catch(()=>null);
     if(disk===null)session.markMissing();
     else session.externalChange(disk);
     if(session.hasQueuedExternal&&session.operation==='idle'){
      const disk2=await this.app.vault.read(file).catch(()=>null);
      if(disk2!==null)session.externalChange(disk2);
     }
     for(const leaf of this.app.workspace.getLeavesOfType(HTML_VIEW)){
      const v=leaf.view as HtmlFileView;
      if(v.session===session)v.renderFrame(true);
     }
     this.refreshPanels(true);
    })();
   }
    if(this.settings.preview.autoRefreshAssets&&/\.(css|png|jpe?g|webp|gif|svg|avif|woff2?|ttf|otf|eot)$/i.test(file.path))
    this.queueAssetRefresh(file.path);
  }));
  this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{
   this.nav.rename(oldPath,file.path);
   const session=this.sessions.get(oldPath);
   if(session&&file instanceof TFile){
    this.sessions.delete(oldPath);
    this.sessions.set(file.path,session);
    (session as {filePath:string}).filePath=file.path;
    void this.drafts.flush(session);
    void this.drafts.storeRef.removeDraft(oldPath);
   }
  }));
  this.registerEvent(this.app.vault.on('delete',file=>{
   if(!(file instanceof TFile))return;
   this.sessions.get(file.path)?.markMissing();
  }));
  // F21 嵌入代码块
  this.registerMarkdownCodeBlockProcessor('html-atelier',(src,el,ctx)=>{
   // embeds.enabled 关闭时不渲染任何嵌入(此前该设置无读取方 —— 审计 round4 缺陷 38)
   if(!this.settings.embeds.enabled)return;
   const child=new EmbedRenderChild({vault:this.app.vault},el,src,ctx.sourcePath,
    {showDrafts:this.settings.embeds.showDrafts,defaultHeight:this.settings.embeds.defaultHeight,autoHeightMax:this.settings.embeds.autoHeightMax,
     showToolbar:this.settings.embeds.showToolbar,nonce:Math.random().toString(36).slice(2,8)},
    {getFileByPath:(p)=>{const f=this.app.vault.getAbstractFileByPath(p);return f instanceof TFile?f:null;},
     getResourcePath:(f)=>this.app.vault.getResourcePath(f),
     openHtml:(p)=>{void this.app.workspace.openLinkText(p,'',false);},
     isDirty:(p)=>this.sessions.get(p)?.dirty===true});
   ctx.addChild(child);
  });
 }

 // ---- 命令(F18 §8.2) ----
 private registerCommands(){
  const needView=()=>this.activeHtmlView();
  const needSession=()=>{const v=needView();return v?.session&&v.file?{v,s:v.session,f:v.file}:null;};
  // 守卫的返回值必须**原样返回**:此前的助手恒 return true,Obsidian 于是在 check 阶段
  // 认为命令永远可用 —— 20 个命令里 0 个真正受限(审计 round4 缺陷 41)。
  // 约定:run(checking) 返回该命令当前是否可用;checking=true 时只判定不执行。
  // 守卫包装在 src/services/commands.ts(抽出以便测试/探针调用同一实现)
  const cmd=(id:string,name:string,run:(checking:boolean)=>boolean)=>{
   this.addCommand({id,name,checkCallback:guardCommand(run)});
  };
  cmd('save-html','保存当前 HTML',c=>{const x=needSession();if(!x)return false;if(!c)void this.saveFile(x.f,x.s);return true;});
  cmd('save-as','另存当前 HTML…',c=>{const x=needSession();if(!x)return false;if(!c)this.openSaveAs();return true;});
  cmd('open-browser','在浏览器打开当前 HTML',c=>{const v=needSession()?needView():null;if(!v)return false;if(!c)v.openCurrentInBrowser();return true;});
  this.addCommand({id:'show-panel',name:'显示 HTML 侧栏',callback:()=>{void this.showPanel(true);}});
  cmd('toggle-mode','切换预览 / 编辑',c=>{const v=needView();if(!v)return false;if(!c)v.setMode(v.mode==='edit'?'preview':'edit');return true;});
  cmd('toggle-source','切换源码模式',c=>{const v=needView();if(!v)return false;if(!c)v.setMode(v.mode==='source'?'preview':'source');return true;});
  cmd('toggle-split','切换分栏',c=>{const v=needView();if(!v)return false;if(!c)v.setMode(v.mode==='split'?'preview':'split');return true;});
  cmd('refresh-preview','刷新预览',c=>{const v=needView();if(!v)return false;if(!c)v.renderFrame(true);return true;});
  cmd('zoom-reset','恢复 100% 缩放',c=>{const v=needView();if(!v)return false;if(!c){v.zoom=100;v.applyViewport();}return true;});
  cmd('nav-back','后退',c=>{const v=needView();if(!v||!this.nav.canBack(v))return false;if(!c)v.goBack();return true;});
  cmd('nav-forward','前进',c=>{const v=needView();if(!v||!this.nav.canForward(v))return false;if(!c)v.goForward();return true;});
  cmd('undo','撤销',c=>{const x=needSession();if(!x||x.s.controller.undoDepth===0)return false;if(!c){try{x.s.undo();x.v.syncTextNodes();this.refreshPanels();}catch(e){new Notice(e instanceof Error?e.message:String(e));}}return true;});
  cmd('redo','重做',c=>{const x=needSession();if(!x||x.s.controller.redoDepth===0)return false;if(!c){try{x.s.redo();x.v.syncTextNodes();this.refreshPanels();}catch(e){new Notice(e instanceof Error?e.message:String(e));}}return true;});
  this.addCommand({id:'draft-manager',name:'打开草稿管理',callback:()=>{new DraftManagerModal(this.t,this.drafts,path=>{void this.app.workspace.openLinkText(path,'',false);},this.app,()=>this.settings).open();}});
  cmd('conflict-manager','打开冲突处理',c=>{const x=needSession();if(!x||x.s.contentState!=='conflict')return false;if(!c)this.openConflict();return true;});
  cmd('copy-page-link','复制当前 HTML 页面链接',c=>{const x=needSession();if(!x)return false;if(!c)this.commandCopyPageLink();return true;});
  cmd('copy-section-link','复制当前章节链接',c=>{const x=needSession();if(!x)return false;if(!c)this.commandCopySectionLink();return true;});
  cmd('insert-embed','插入 HTML 嵌入',c=>{const md=this.app.workspace.getActiveViewOfType(MarkdownView);if(!md)return false;if(!c)this.commandInsertEmbed();return true;});
  cmd('locate-source','定位到源码',c=>{const sel=(window as unknown as {htmlAtelierSelection?:SelectionInfo|null}).htmlAtelierSelection;const x=needSession();if(!x||sel?.offset===undefined)return false;if(!c)this.activeHtmlView()?.locateInSource(sel.offset);return true;});
  this.addCommand({id:'disable-sidebar-auto',name:'关闭全部侧栏自动行为',callback:()=>{
   const patch=this.sidebar.disableAllActions();
   this.settings={...this.settings,...patch};
   void this.saveData(this.buildPluginData());
   new Notice(this.t('menuDisableSidebar'));
  }});
 }

 private commandCopyPageLink(){
  const file=this.activeHtmlView()?.file;
  if(file)void this.noteRef.copyPage(file,'md');
 }

 private commandCopySectionLink(){
  const v=this.activeHtmlView();
  const file=v?.file;
  if(!file)return;
  const anchor=v?.currentAnchor;
  // 没有锚点时什么都没复制,不能提示"已复制"(审计 round4 缺陷 40:文案与行为相反)
  if(!anchor){new Notice(this.t('noticeNoAnchor'));return;}
  void this.noteRef.copySection(file,anchor.replace(/^#/,''),'md');
 }

 private commandInsertEmbed(){
  const md=this.app.workspace.getActiveViewOfType(MarkdownView);
  filePickerModal(this.app,f=>['html','htm'].includes(f.extension.toLowerCase()),path=>{
   if(!md)return;
   md.editor.replaceSelection(`${embedCode(path,'auto','auto',null,true)}\n`);
  });
 }

 private openSaveAs(){
  const v=this.activeHtmlView();
  if(!v?.file||!v.session)return;
  new SaveAsModal(this.t,v.file,v.session.workingSource,()=>this.settings,this.saveAs,created=>{
   void this.app.workspace.openLinkText(created.path,'',false);
  },this.app).open();
 }

 private openConflict(){
  const v=this.activeHtmlView();
  if(!v?.file||!v.session||v.session.contentState!=='conflict')return;
  new ConflictModal(this.t,v.file,v.session,this.merge,()=>{v.renderFrame(true);this.refreshPanels();},
   ()=>this.commitMerged(v),()=>this.adoptDiskFor(v),this.app).open();
 }

 // 合并结果落盘:先备份草稿,再写 vault,最后如实返回结果。
 // 顺序很关键——先草稿后写盘,保证"已解决的合并"在任何失败下都还能恢复(审计 round4 BUG 5)。
 private async commitMerged(v:HtmlFileView):Promise<'written'|'conflict'|'missing'|'io-error'>{
  if(!v.file||!v.session)return 'io-error';
  await this.drafts.flush(v.session).catch(()=>{});
  const ok=await this.saveFile(v.file,v.session,true);
  if(ok)return 'written';
  const state=v.session.contentState;
  if(state==='conflict')return 'conflict';
  if(state==='missing')return 'missing';
  return 'io-error';
 }

 // 采用磁盘版本("使用磁盘版本(放弃草稿)")。必须:
 // 1) 捕获 adoptRemote 的抛错(会话忙时它会抛),否则弹窗卡住且用户毫无提示;
 // 2) 真的删掉被放弃的草稿,否则下次打开会作为冲突复活(审计 round4 BUG 8)。
 private async adoptDiskFor(v:HtmlFileView):Promise<boolean>{
  if(!v.file||!v.session){new Notice(this.t('panelNoActiveHtml'));return false;}
  const disk=await this.readOrNull(v.file);
  if(disk===null){
   // 文件已不在:无法采用磁盘版本。此时**故意保留草稿**——它是用户唯一的副本,
   // 删掉等于把还能救的内容彻底丢掉(与探测脚本"点了放弃就该删"的期望不同,以安全为先)。
   new Notice(this.t('conflictDiskMissing'),8000);
   return false;
  }
  try{
   v.session.adoptRemote(disk);
  }catch(e){
   new Notice(e instanceof Error?e.message:String(e),7000);
   return false;
  }
  await this.drafts.clearDraft(v.file.path).catch(()=>{});
  v.renderFrame(true);
  this.refreshPanels();
  new Notice(this.t('statusClean'));
  return true;
 }

 // 读不到文件一律归一为 null:mock 与某些适配器会返回 undefined 而不是抛错,
// 直接与 null 比较会让"文件缺失"分支失效。
 private async readOrNull(file:TFile):Promise<string|null>{
  const raw=await this.app.vault.read(file).catch(()=>null);
  return raw===undefined?null:raw;
 }

 private adoptRemote(){
  const v=this.activeHtmlView();
  if(!v)return;
  void this.adoptDiskFor(v);
 }

 private async migrateV1Drafts(legacy:LegacyStored['drafts']){
  let result;
  try{result=migrateLegacyDrafts({drafts:legacy},getDeviceId(),Date.now());}
  catch(e){console.error('v1 迁移解析失败',e);return;}
  for(const record of result.records){
   try{await this.drafts.storeRef.saveDraft(record);}catch{/* 失败保留原始数据,不阻塞加载(A33) */}
  }
  if(result.manual.length)new Notice(this.t('noticeDraftRestoredConflict'));
 }

 buildPluginData():PluginData{
  const retained=this.retainedUnknown;
  return {settings:{...this.settings},retained,nav:this.nav.toJSON(this.settings.preview.positionLimit),migratedV1:true};
 }
}

// Blob URL Worker 传输(D0-08 实测可用)
function blobWorkerTransport(src:string){
 return ():WorkerTransport=>{
  const blob=new Blob([src],{type:'text/javascript'});
  const url=URL.createObjectURL(blob);
  const w=new Worker(url);
  let onMsg:(m:unknown)=>void=()=>{};
  w.onmessage=e=>onMsg(e.data);
  return {
   post:(msg:unknown)=>w.postMessage(msg),
   terminate:()=>{w.terminate();URL.revokeObjectURL(url);},
   onMessage:(cb:(m:unknown)=>void)=>{onMsg=cb;},
  };
 };
}
