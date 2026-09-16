import {ItemView, Notice, WorkspaceLeaf, setIcon} from 'obsidian';
import {DocumentSession} from '../core/session';
import {parseDocument,alignSegments} from '../model';
import {SourceIndex} from '../parsing/sourceIndex';
import {buildTextMap,replaceLogical,rangesForLogical,TextContainer} from '../parsing/textMap';
import {planParagraphEdit,containerIndexForOffset,containerForOffset} from '../parsing/paragraphEdit';
import {escapeAttrValue,escapeText} from '../parsing/escape';
import {SelectionInfo} from './selectionTypes';
import {ViewToolbar,ToolbarTarget} from './toolbar';
import {debugLog} from '../services/debug';
import type {AtelierSettings} from '../settings/schema';
import type {Translator} from '../i18n';

// HTML 专属侧栏(F08/F09/F10/F11/F17/F26,§4.2):
// 工具栏(后退/前进/模式/刷新/宽度/缩放/更多)→ 文件名 → 搜索 → 编辑/大纲/修改/资源
// → 内容 → 状态与保存。所有修改入口进入同一 DocumentSession。
// editor.toolbarPlacement='sidebar' 时,工具栏只在这里存在,作用于**当前活动的
// HTML 视图**(与面板的其它控件一致)。

// 属性暴露信息:ElemNode.attrs 的元素结构(值区间用于原地改值,name 区间用于补值)
type AttrInfo={name:string; value:string; start:number; end:number; valueStart:number; valueEnd:number; quote:'"'|"'"|''; hasEqual:boolean};

export const HTML_PANEL='html-atelier-panel';

// 标签顺序是排版的一部分:滑动指示块的宽度等于 1/标签数,顺序/数量变了 CSS 也要跟着变
const TAB_KEYS=['edit','outline','changes','resources'] as const;
type PanelTab=typeof TAB_KEYS[number];
interface OutlineState {
 open:boolean;
 selected:{htmlId:string|null;tag:string;text:string;start:number;source:string}|null;
}

export interface PanelCallbacks {
 settings:()=>AtelierSettings;
 t:Translator;
 // 工具栏的作用对象:当前活动的 HTML 文件视图(没有时返回全禁用的空目标)
 toolbarTarget:()=>ToolbarTarget;
 getActiveSession():{session:DocumentSession; filePath:string}|null;
 activeFilePath():string|null;
 applyTextPatch(patch:import('../core/patch').TextPatch,origin?:'edit'|'restore'):void;
 applyPatches(patches:import('../core/patch').TextPatch[],kind:'text'|'attribute'|'image'|'structure'|'source',groupingKey:string|null,origin?:'edit'|'restore',silent?:boolean):boolean;
 locateInSource(offset:number):void;
 // 「修改」清单的定位:源码与预览都要到那处改动(F11)
   locateChange(offset:number,segmentId:string|null):void;
 locatePreview(segmentId:string):void;
 // 返回是否真的定位到了:大纲点击需要据此决定要不要退回锚点/源码
 revealInPreview(containerIndex:number,lStart:number,lEnd:number):boolean;
 saveActive():void;
 undo():void;
 redo():void;
 openFileByPath(path:string):void;
 pickLibraryFile(filter:(f:{path:string; extension:string})=>boolean):Promise<string|null>;
 importImage():Promise<string|null>;
 copyPageLink():void;
 copySectionLink():void;
 conflictOpen():void;
 adoptRemote():void;
 exportDraftAsCopy():void;
 searchAll(q:string,caseSensitive:boolean,includeHidden:boolean):SearchHit[];
}

export interface SearchHit {containerIndex:number; start:number; end:number; preview:string; path:string; hidden:boolean}

export class HtmlPanelView extends ItemView {
 private fileLabel!:HTMLElement;
 private fileName!:HTMLElement;
 private fileFolder!:HTMLElement;
 private replaceToggle!:HTMLButtonElement;
 private replaceAllBtn!:HTMLButtonElement;
 private replaceWrap!:HTMLElement;
 private searchBox!:HTMLInputElement;
 private searchCase!:HTMLInputElement;
 private searchResults!:HTMLElement;
 private tabsEl!:HTMLElement;
 private content!:HTMLElement;
 private statusFile!:HTMLElement;
 private statusDraft!:HTMLElement;
 private saveBtn!:HTMLButtonElement;
 private undoBtn!:HTMLButtonElement;
 private redoBtn!:HTMLButtonElement;
 private tab:PanelTab='edit';
 // 整段表单里点「文字片段」置位,下一次 renderEditTab 消费:这一次强制片段表单
 private segmentOverride=false;
 private searchHits:SearchHit[]=[];private searchAt=-1;
 private replaceBox!:HTMLInputElement;
 private lastRenderedRev=-1;
 private lastRenderedSession:DocumentSession|null=null;
 private outlineStates=new WeakMap<DocumentSession,OutlineState>();
 private outlineOwner:DocumentSession|null=null;
 callbacks:PanelCallbacks;

 constructor(leaf:WorkspaceLeaf,callbacks:PanelCallbacks){
  super(leaf);
  this.callbacks=callbacks;
 }

 getViewType(){return HTML_PANEL;}
 getDisplayText(){return 'HTML Atelier';}
 getIcon(){return 'text-cursor-input';}

 async onOpen(){
  const t=this.callbacks.t;
  this.tab=this.callbacks.settings().sidebar.defaultTab;
  const root=this.contentEl;
  root.empty();
  root.addClass('html-atelier-panel');
  this.fileLabel=root.createDiv({cls:'html-atelier-file'});
  const fileIcon=this.fileLabel.createSpan({cls:'html-atelier-fileicon',attr:{'aria-hidden':'true'}});setIcon(fileIcon,'file-code-2');
  const fileInfo=this.fileLabel.createDiv({cls:'html-atelier-fileinfo'});
  this.fileName=fileInfo.createDiv({cls:'html-atelier-filename'});
  this.fileFolder=fileInfo.createDiv({cls:'html-atelier-filefolder'});
  this.toolbarHost=root.createDiv({cls:'html-atelier-toolbarhost'});
  // 搜索与替换合成一张卡片:两块输入框各自描边、各自贴边会显得很碎
  const searchBlock=root.createDiv({cls:'html-atelier-searchblock'});
  const searchWrap=searchBlock.createDiv({cls:'html-atelier-searchwrap'});
  const searchIcon=searchWrap.createSpan({cls:'html-atelier-searchicon',attr:{'aria-hidden':'true'}});setIcon(searchIcon,'search');
  this.searchBox=searchWrap.createEl('input',{cls:'html-atelier-search',attr:{type:'search','aria-label':t('searchLabel'),placeholder:''}});
  // 大小写开关:此前是一个没有说明文字的裸复选框。改成 "Aa" 小标签,
  // 真正的 checkbox 铺满标签(透明),所以点击与键盘焦点都落在原生控件上。
  this.searchCase=searchWrap.createEl('input',{attr:{type:'checkbox','aria-label':t('searchCase')}});
  const caseLabel=searchWrap.createEl('label',{cls:'html-atelier-caselabel',attr:{'title':t('searchCase')},text:'Aa'});
  caseLabel.prepend(this.searchCase);
  this.replaceToggle=searchWrap.createEl('button',{cls:'html-atelier-replacetoggle',attr:{type:'button',title:t('panelToggleReplace'),'aria-label':t('panelToggleReplace'),'aria-expanded':'false'}});
  setIcon(this.replaceToggle,'replace');
  this.replaceToggle.addEventListener('click',()=>{
   this.replaceWrap.hidden=!this.replaceWrap.hidden;
   this.replaceToggle.setAttribute('aria-expanded',String(!this.replaceWrap.hidden));
   if(!this.replaceWrap.hidden)this.replaceBox.focus();
  });
  const syncCase=()=>caseLabel.toggleClass('html-atelier-caselabel-on',this.searchCase.checked);
  syncCase();
  this.searchBox.addEventListener('input',()=>this.runSearchDebounced());
  this.searchCase.addEventListener('change',()=>{syncCase();this.runSearch();});
  // F13 查找替换:普通文本,全文正文范围;命中预览后一次事务替换
  const replaceWrap=searchBlock.createDiv({cls:'html-atelier-searchwrap html-atelier-replacewrap'});
  this.replaceWrap=replaceWrap;replaceWrap.hidden=true;
  this.replaceBox=replaceWrap.createEl('input',{cls:'html-atelier-search',attr:{type:'text','aria-label':t('searchReplace'),placeholder:''}});
  this.replaceBox.placeholder=t('searchReplace');
  const replaceAllBtn=replaceWrap.createEl('button',{cls:'html-atelier-btnrow',attr:{type:'button'},text:t('searchReplaceAll')});
  this.replaceAllBtn=replaceAllBtn;
  replaceAllBtn.addEventListener('click',()=>this.replaceAll());
  this.replaceBox.addEventListener('keydown',e=>{if(e.key==='Enter')this.replaceAll();});
  this.searchResults=root.createDiv({cls:'html-atelier-searchresults'});
  this.tabsEl=root.createDiv({cls:'html-atelier-tabs'});
  this.content=root.createDiv({cls:'html-atelier-panelcontent'});
  const statusbar=root.createDiv({cls:'html-atelier-statusbar'});
  const statusInfo=statusbar.createDiv({cls:'html-atelier-statusinfo'});
  this.statusFile=statusInfo.createDiv({cls:'html-atelier-statusfile',attr:{'aria-live':'polite'}});
  this.statusDraft=statusInfo.createDiv({cls:'html-atelier-statusdraft',attr:{'aria-live':'polite'}});
  const actions=statusbar.createDiv({cls:'html-atelier-statusactions'});
  this.undoBtn=actions.createEl('button',{attr:{'type':'button','aria-label':t('panelUndo'),title:t('panelUndo')}});
  const undoIcon=this.undoBtn.createSpan();setIcon(undoIcon,'undo-2');
  this.undoBtn.addEventListener('click',()=>this.callbacks.undo());
  this.redoBtn=actions.createEl('button',{attr:{'type':'button','aria-label':t('panelRedo'),title:t('panelRedo')}});
  const redoIcon=this.redoBtn.createSpan();setIcon(redoIcon,'redo-2');
  this.redoBtn.addEventListener('click',()=>this.callbacks.redo());
  this.saveBtn=actions.createEl('button',{cls:'html-atelier-savebtn',attr:{'type':'button'}});
  this.saveBtn.addEventListener('click',()=>this.callbacks.saveActive());
  this.buildTabs();
  this.syncToolbarPlacement();
  // 组合输入状态(冒泡到根:覆盖面板内所有输入控件)
  root.addEventListener('compositionstart',()=>{this.composing=true;});
  root.addEventListener('compositionend',()=>{this.composing=false;});
  // 失焦意味着组合已结束或被打断:兜底清标志,避免它卡住导致此后永不重绘
  root.addEventListener('focusout',()=>{this.composing=false;});
  this.refresh(true);
 }

 // ---- 工具栏(F16:editor.toolbarPlacement='sidebar' 时只在这里) ----
 // 保存按钮不重复:面板状态行已有;文件名与脏标记也用状态行与文件名标签呈现。
 syncToolbarPlacement(){
  if(!this.toolbarHost)return;
  const here=this.callbacks.settings().editor.toolbarPlacement==='sidebar';
  if(here&&!this.toolbar){
   this.toolbar=new ViewToolbar(this.toolbarHost,()=>this.callbacks.toolbarTarget(),this.callbacks.t,{showTitle:false,showSave:false});
  }else if(!here&&this.toolbar){
   this.toolbar.destroy();this.toolbar=null;
  }
  this.toolbarHost.toggleClass('html-atelier-hidden',!here);
  this.refreshToolbar();
 }

 refreshToolbar(){this.toolbar?.refresh();}

 // 语言热切:面板静态文案此前只在 onOpen 求值一次,切换语言后标签页与占位符
 // 会留在旧语言(工具栏更明显——它是现在唯一的模式入口)。
 relabel(){
  if(!this.content)return;
  const t=this.callbacks.t;
  for(const [button,key] of [[this.undoBtn,'panelUndo'],[this.redoBtn,'panelRedo']] as const){
   button.setAttribute('aria-label',t(key));button.title=t(key);
  }
  this.searchBox.setAttribute('aria-label',t('searchLabel'));
  this.replaceBox.setAttribute('aria-label',t('searchReplace'));
  this.searchCase.setAttribute('aria-label',t('searchCase'));
  if(this.searchCase.parentElement)this.searchCase.parentElement.title=t('searchCase');
  this.buildTabs();
  this.searchBox.placeholder=this.callbacks.t('searchPlaceholder');
  this.replaceBox.placeholder=this.callbacks.t('searchReplace');
  this.replaceToggle.setAttribute('aria-label',this.callbacks.t('panelToggleReplace'));
  this.replaceToggle.title=this.callbacks.t('panelToggleReplace');
  this.replaceAllBtn.setText(this.callbacks.t('searchReplaceAll'));
  this.toolbar?.relabel(this.callbacks.t);
  this.refresh(true);
 }

 private toolbar:ViewToolbar|null=null;
 private toolbarHost:HTMLElement|null=null;

 // 只建一次按钮;切换标签走 setTab()。此前每次点击都重建整条标签栏:
 // 指示块的过渡会被重新挂载(视觉上闪一下),外部持有的按钮引用也会失效。
 private buildTabs(){
  const t=this.callbacks.t;
  this.tabsEl.empty();
  for(const key of TAB_KEYS){
   const label={edit:t('tabEdit'),outline:t('tabOutline'),changes:t('tabChanges'),resources:t('tabResources')}[key];
   const b=this.tabsEl.createEl('button',{attr:{'type':'button',title:label,'aria-label':label}});
   const icon=b.createSpan({attr:{'aria-hidden':'true'}});setIcon(icon,{edit:'sliders-horizontal',outline:'list-tree',changes:'git-compare-arrows',resources:'layers'}[key]);
   b.createSpan({cls:'html-atelier-tablabel',text:label});
   b.addEventListener('click',()=>this.setTab(key));
  }
  this.syncTabs();
 }

 // 切换当前标签(含指示块位置与入场动效)。段落表单/大纲的"回到编辑"入口也走这里,
 // 否则手工改 this.tab 后高亮会停在旧标签上。
 setTab(key:PanelTab){
  if(this.tab===key)return;
  this.tab=key;
  this.syncTabs();
  this.playEnter();
  this.refresh(true);
 }

 private syncTabs(){
  const index=Math.max(0,TAB_KEYS.indexOf(this.tab));
  [...this.tabsEl.children].forEach((el,i)=>{el.toggleClass('html-atelier-active',i===index);el.setAttribute('aria-pressed',String(i===index));});
  // 选中指示块由 CSS 变量定位(索引 × 自身宽度),位移交给 CSS 过渡 → 滑块滑过去
  this.tabsEl.style.setProperty('--html-atelier-tab',String(index));
 }

 // 切标签时的入场动画。同一个类不能连续触发两次动画(第二次不会重放),
 // 所以先摘掉、强制重排、再挂上。
 private playEnter(){
  const el=this.content;
  if(!el)return;
  el.toggleClass('html-atelier-enter',false);
  void el.offsetWidth;
  el.toggleClass('html-atelier-enter',true);
 }

 refresh(force=false){
  if(!this.content)return;
  // Read the live details state before replacing DOM; toggle events may still be queued.
  const details=this.content.querySelector<HTMLDetailsElement>('.html-atelier-textlistdetails');
  if(details&&this.outlineOwner)this.outlineState(this.outlineOwner).open=details.open;
  // 工具栏状态不随 revision 变化,必须放在下面的"内容未变就不重绘"早退之前
  this.refreshToolbar();
  const active=this.callbacks.getActiveSession();
  const t=this.callbacks.t;
  const file=this.callbacks.activeFilePath();
  const parts=file?.split('/')??[];
  this.fileName.setText(parts.pop()??t('panelNoActiveHtml'));
  this.fileFolder.setText(file?(parts.join('/')||'HTML'):'HTML Atelier');
  this.fileLabel.toggleClass('html-atelier-fileempty',!file);
  this.fileLabel.title=file??t('panelNoActiveHtml');
  const s=active?.session??null;
  this.undoBtn.disabled=!s||s.controller.undoDepth===0||s.operation!=='idle';
  this.redoBtn.disabled=!s||s.controller.redoDepth===0||s.operation!=='idle';
  this.saveBtn.disabled=!s||!s.dirty||s.operation!=='idle'||s.contentState==='conflict';
  this.saveBtn.setText(t('tbSave'));
  // 状态栏:文件状态 + 草稿状态(§4.2)
  let fileStatus:string;
  if(!s)fileStatus=t('statusClean');
  else if(s.operation==='saving')fileStatus=t('statusSaving');
  else if(s.operation==='merging')fileStatus=t('statusMerging');
  else if(s.contentState==='conflict')fileStatus=t('statusConflictDraft');
  // 文件已被删除/重命名时要区别于"没有打开 HTML":两者此前共用一句提示,
  // 用户无法判断是没打开还是文件没了(审计复检 §3.23 M9)
  else if(s.contentState==='missing')fileStatus=t('statusFileMissing');
  else if(s.dirty)fileStatus=t('statusDirty',{n:this.countChanges(s)});
  else fileStatus=t('statusClean');
  this.statusFile.setText(fileStatus);
  this.statusFile.toggleClass('html-atelier-statusdirty',!!s?.dirty);
  this.statusFile.toggleClass('html-atelier-conflict-text',s?.contentState==='conflict');
  this.statusDraft.setText(s?{pending:t('statusDraftPending'),writing:t('statusDraftWriting'),saved:t('statusDraftSaved'),failed:t('statusDraftFailed'),disabled:t('statusDraftDisabled')}[s.draftStatus]:'');
  // 内容:revision 未变且非强制时不重绘(保持输入焦点)
  const rev=s?s.revision*4+s.parsedRevision:-1;
  // 输入法组合中任何重绘都会打断候选词,一律推迟(见 composing 的说明)
  if(this.composing)return;
  if(!force&&s===this.lastRenderedSession&&rev===this.lastRenderedRev)return;
  // 面板里正在输入时也不重建:每次提交都会推进 revision,而这里重建 DOM 会把
  // 输入框换掉——焦点与插入点全丢,结果是"敲了一个字母就再也打不进去"
  // (用户反馈 2026-09-14)。值本身由用户自己的输入维持,只需要同步派生状态;
  // 切标签(setTab)与外部变化等路径是 force=true,不受此限制。
  if(!force&&this.isEditingInPane()){this.syncDerived();return;}
  this.lastRenderedRev=rev;
  this.lastRenderedSession=s;
  this.derivedSyncs=[];
  this.searchBox.placeholder=t('searchPlaceholder');
  if(!s){this.content.empty();this.content.createDiv({cls:'html-atelier-panelnote',text:t('formEmptyNoSelection')});return;}
  if(this.tab==='edit')this.renderEditTab(s);
  else if(this.tab==='outline')this.renderOutlineTab(s);
  else if(this.tab==='changes')this.renderChangesTab(s);
  else this.renderResourcesTab(s);
 }

 // 输入期间不重建面板 DOM,但表单里的**派生状态**(按钮禁用等)必须跟上,
 // 否则用户改完文字后「恢复此项」还是灰的、点不动(不重建的直接后果)
 private derivedSyncs:(()=>void)[]=[];
 private syncDerived(){for(const fn of this.derivedSyncs)fn();}

 // 面板内容区里是否有正在输入的控件(输入框/文本域/contenteditable)
 private isEditingInPane():boolean{
  const el=this.contentEl?.ownerDocument?.activeElement;
  if(!el||!this.content?.contains(el))return false;
  const tag=el.tagName;
  return tag==='INPUT'||tag==='TEXTAREA'||(el as HTMLElement).isContentEditable===true;
 }

 // 输入法组合(中文/日文)状态。composition 事件会冒泡,所以挂在根上即可覆盖
 // 面板内所有输入控件:组合期间的 input 事件带的是拼音,既不该提交进文档,
 // 也不该在此时重建 DOM。
 private composing=false;

 private countChanges(s:DocumentSession):number{
  // 按 alignSegments 对齐计数:按 id 对齐会在增删文字节点后把后续段落全算成"已修改"
  const base=parseDocument(s.baseSource).segments;
  const work=parseDocument(s.workingSource).segments;
  let n=0;
  for(const pr of alignSegments(base,work))if(!pr.base||!pr.work||pr.base.text!==pr.work.text)n++;
  if(s.workingSource!==s.baseSource&&!n)n=1;
  return n;
 }

 // ---- 编辑标签:按选择类型渲染表单(F08/F15/F20) ----
 private renderEditTab(s:DocumentSession){
  const t=this.callbacks.t;
  const sel=this.currentSelection();
  this.content.empty();
  // segmentFormOnce 必须在任何早退之前消费:整段表单里点「文字片段」后的一次性例外,
  // 若选择为空时未消费会泄漏到下一次文字选择(那一次会绕过默认整段设置)
  const segmentFormOnce=this.segmentOverride;
  this.segmentOverride=false;
  if(s.contentState==='conflict'){
   // 冲突操作条在编辑标签常显,不受选中对象影响(报告 §11.1)
   const bar=this.content.createDiv({cls:'html-atelier-conflictbar'});
   bar.createDiv({text:t('conflictTitle')});
   const b1=bar.createEl('button',{attr:{'type':'button'},text:t('conflictApply')});
   b1.addEventListener('click',()=>this.callbacks.conflictOpen());
   const b2=bar.createEl('button',{attr:{'type':'button'},text:t('conflictUseDiskVersion')});
   b2.addEventListener('click',()=>this.callbacks.adoptRemote());
   const b3=bar.createEl('button',{attr:{'type':'button'},text:t('panelExportDraft')});
   b3.addEventListener('click',()=>this.callbacks.exportDraftAsCopy());
  }
  if(!sel){
   this.content.createDiv({cls:'html-atelier-panelnote',text:this.callbacks.settings().editor.defaultMode==='preview'?t('formEmptyPreview'):t('formEmptyNoSelection')});
   return;
  }
  // editor.defaultTextMode==='paragraph' 时直接进整段表单(此前该设置无读取方)
  if(sel.kind==='text'&&sel.segmentId){
   if(this.callbacks.settings().editor.defaultTextMode==='paragraph'&&!segmentFormOnce){
    const {index,map}=this.rebuild();
    const model=parseDocument(s.workingSource);
    const seg=model.segments.find(x=>x.id===sel.segmentId);
    const node=seg?index.nodes.find(n=>n.kind==='text'&&n.start===seg.start):undefined;
    const ci=node&&node.kind==='text'?containerIndexForOffset(map,node.start,index):-1;
    if(ci>=0){this.renderParagraphForm(s,{...sel,kind:'paragraph',containerIndex:ci});return;}
   }
   this.renderTextForm(s,sel);
  }
  else if(sel.kind==='link')this.renderLinkForm(s,sel);
  else if(sel.kind==='image')this.renderImageForm(s,sel);
  else if(sel.kind==='paragraph')this.renderParagraphForm(s,sel);
 }

 private currentSelection():SelectionInfo|null{
  const ev=(window as unknown as {htmlAtelierSelection?:SelectionInfo|null}).htmlAtelierSelection;
  return ev??null;
 }

 private renderTextForm(s:DocumentSession,sel:SelectionInfo){
  const t=this.callbacks.t;
  const model=parseDocument(s.workingSource);
  const seg=model.segments.find(x=>x.id===sel.segmentId);
  if(!seg){this.content.createDiv({cls:'html-atelier-panelnote',text:t('formEmptyNoSelection')});return;}
  const wrap=this.content.createDiv({cls:'html-atelier-form'});
  const head=wrap.createDiv({cls:'html-atelier-formhead'});
  head.createSpan({text:t('formTextLabel')});
  head.createSpan({cls:'html-atelier-muted',text:seg.kind});
  const ta=wrap.createEl('textarea',{cls:'html-atelier-textarea',attr:{rows:'5','aria-label':t('formTextLabel'),spellcheck:'false'}});
  ta.value=seg.text;
  const hint=wrap.createDiv({cls:'html-atelier-hint',text:t('formHintSegment')});
  const btnRow=wrap.createDiv({cls:'html-atelier-btnrow'});
  const paraBtn=btnRow.createEl('button',{attr:{'type':'button'},text:t('formParagraph')});
  paraBtn.addEventListener('click',()=>{
   const {index,map}=this.rebuild();
   // 按源偏移定位容器:两个内容相同的段落必须落到用户实际点的那一个(round4 BUG 9);
   // 缩进开头的节点由按节点回退兜住(paragraphEdit.ts 的说明)
   const node=index.nodes.find(n=>n.kind==='text'&&n.start===seg.start);
   let ci=node?containerIndexForOffset(map,node.start,index):-1;
   if(ci<0)ci=map.findIndex(c=>c.logical.includes(seg.text));
   if(ci>=0){(window as unknown as {htmlAtelierSelection?:SelectionInfo|null}).htmlAtelierSelection={kind:'paragraph',containerIndex:ci};this.refresh(true);}
   else new Notice(t0(this.callbacks,'noticeParagraphUnavailable'));
  });
  const restore=btnRow.createEl('button',{attr:{'type':'button'},text:t('formRestore')});
  // 快照会过期:输入期间面板不再逐键重建表单,所以"基准段/当前段"都必须按 id
  // 现算,否则恢复会用过期偏移替换,或按钮禁用状态停在旧值(用户改完文字后还是灰的)
  const liveSeg=()=>parseDocument(s.workingSource).segments.find(x=>x.id===seg.id)??null;
  // 基准段按对齐取:id 跨解析不稳定,错位后"恢复此项"会用错文本(与 restoreItem 同理)
  const baseAt=()=>alignSegments(parseDocument(s.baseSource).segments,parseDocument(s.workingSource).segments)
   .find(pr=>pr.work?.id===seg.id)?.base??null;
  const syncRestore=()=>{
   const live=liveSeg();const base=baseAt();
   restore.disabled=!base||!live||base.text===live.text;
  };
  syncRestore();
  this.derivedSyncs.push(syncRestore);
  restore.addEventListener('click',()=>{
   const base=baseAt();const live=liveSeg();
   if(!base||!live)return;
   // 直接按源偏移恢复:live 就是当前工作稿里该文字节点的区间(与 commit 同理,
   // 不走逻辑映射 —— 逻辑文本规范化空白后 indexOf 会失配,恢复被静默丢弃)
   this.callbacks.applyTextPatch({start:live.start,end:live.end,
    expected:s.workingSource.slice(live.start,live.end),
    replacement:escapeText(base.text)},'restore');
  });
  void hint;
  let committed=ta.value;
  const commit=()=>{
   const value=ta.value;
   if(value===committed)return;
   committed=value;
   // 旧文本由 commitSegmentEdit 从当前工作稿现取(同上:不能用构建时快照)
   this.commitSegmentEdit(s,seg.id,value);
  };
  // 输入法组合期间的 input 事件带的是拼音,不是用户确认的文字:直接提交会把
  // "wo" 这样的字母写进文档(用户反馈只进了一个字母,就是这一条)。组合结束后
  // 再提交一次,把确认的文字写进去。
  let composing=false;
  ta.addEventListener('compositionstart',()=>{composing=true;});
  ta.addEventListener('compositionend',()=>{composing=false;commit();});
  ta.addEventListener('input',(e)=>{
   if(composing||(e as InputEvent).isComposing)return;
   commit();
  });
  this.content.append(wrap);
 }

 private commitSegmentEdit(s:DocumentSession,segmentId:string,newText:string){
  // 旧文本必须从**当前工作稿**现取,不能用表单构建时的快照:输入期间面板不逐键
  // 重建表单,快照会过期,按过期前缀替换会在末尾留下尾巴(实测会复制出字符)
  const live=parseDocument(s.workingSource).segments.find(x=>x.id===segmentId);
  if(!live)return;
  // 首选:**按源偏移直接替换该文字节点**。段落的原始源码文本常带换行/缩进
  // (「</p> 前的格式化空白」),而 TextMap 的逻辑文本会规范化空白 —— 走
  // indexOf(live.text) 定位必然 -1,编辑被**静默丢弃**(用户实测
  // "文字编辑没有效果",2026-09-16)。live.start/end 就是这个文字节点的源码
  // 区间,文字内容表单编辑的永远只是这一个节点,直接补丁即可,无需逻辑映射。
  const direct={start:live.start,end:live.end,
   expected:s.workingSource.slice(live.start,live.end),
   replacement:escapeText(newText)};
  if(this.callbacks.applyPatches([direct],'text',`seg:${segmentId}`))return;
  // 回退:直接补丁不适用时才走逻辑映射(跨内联分布,F20 结构保留)
  const {index,map}=this.rebuild();
  // 先按该 segment 的源偏移定位(内容相同的段落必须区分开),再退回内容匹配
  const container=containerForOffset(map,live.start,index)
   ??map.find(c=>c.logical===live.text)??map.find(c=>c.logical.includes(live.text));
  if(!container)return;
  const at=container.logical===live.text?0:container.logical.indexOf(live.text);
  if(at<0)return;
  const res=replaceLogical(index,container,at,at+live.text.length,newText);
  if(res.ok)this.callbacks.applyTextPatch(res.patch);
  else{
   // 跨节点:分布到各命中节点(按节点文本占比,F20 结构保留)
   this.commitCrossNode(index,container,at,at+live.text.length,newText);
  }
 }

 private commitCrossNode(index:SourceIndex,container:TextContainer,lStart:number,lEnd:number,replacement:string){
  debugLog(`commitCrossNode l=${lStart}-${lEnd} old=${container.logical.slice(0,20)} new=${replacement.slice(0,20)}`);
  // 补丁规划在 src/parsing/paragraphEdit.ts(纯函数):单元测试与审计探针都直接调用
  // 同一实现。内嵌版本只能被"忠实转写"的探针复制,修复因此无法被观察(round4 BUG 1/BUG 11)。
  const patches=planParagraphEdit(index,container,lStart,lEnd,replacement);
  if(!patches.length)return;
  debugLog(`patches ${patches.length}`);
  this.callbacks.applyPatches(patches,'text',`para:${lStart}`);
 }

 private renderParagraphForm(s:DocumentSession,sel:SelectionInfo){
  const t=this.callbacks.t;
  const {index,map}=this.rebuild();
  const ci=sel.containerIndex??0;
  const c=map[ci];
  this.content.empty();
  if(!c){this.content.createDiv({cls:'html-atelier-panelnote',text:t('formEmptyNoSelection')});return;}
  const wrap=this.content.createDiv({cls:'html-atelier-form'});
  wrap.createDiv({cls:'html-atelier-formhead'}).createSpan({text:t('formParagraph')});
  const ta=wrap.createEl('textarea',{cls:'html-atelier-textarea',attr:{rows:'6','aria-label':t('formParagraph')}});
  ta.value=c.logical;
  wrap.createDiv({cls:'html-atelier-hint',text:t('formParagraphHint')});
  ta.addEventListener('change',()=>{
   const oldLogical=c.logical;
   const newLogical=ta.value;
   if(oldLogical===newLogical)return;
   this.commitCrossNode(index,c,0,oldLogical.length,newLogical);
  });
  const seg=wrap.createDiv({cls:'html-atelier-btnrow'});
  const segBtn=seg.createEl('button',{attr:{'type':'button'},text:t('formSegment')});
  // 「文字片段」= 退出整段模式回到片段表单。此前只是 setTab('edit'),而段落表单
  // 本来就在编辑标签上,setTab 同键早退,按钮点了永远没反应(用户反馈 2026-09-16)。
  // 改为选中该段落里第一个非空片段;容器已查不到(结构化编辑改掉了)就清空选择,
  // 面板回到待点选状态。rebuild() 在点击时现取:textarea 的 change 先于 click
  // 触发,渲染期快照可能已过期。segmentOverride 配合 renderEditTab,保证
  // editor.defaultTextMode==='paragraph' 时这一次不会被弹回整段表单。
  segBtn.addEventListener('click',()=>{
   const {index,map}=this.rebuild();
   const container=map[ci];
   const model=parseDocument(s.workingSource);
   let next:string|null=null;
   if(container)for(const m of container.map){
    const node=index.nodes[m.nodeId];
    if(!node||node.kind!=='text')continue;
    const seg2=model.segments.find(x=>x.start>=node.start&&x.start<node.end);
    if(seg2&&seg2.text.trim()){next=seg2.id;break;}
   }
   this.segmentOverride=true;
   (window as unknown as {htmlAtelierSelection?:SelectionInfo|null}).htmlAtelierSelection=next?{kind:'text',segmentId:next}:null;
   this.refresh(true);
  });
  this.content.append(wrap);
 }

 private rebuild(){const index=new SourceIndex(this.callbacks.getActiveSession()?.session.workingSource??'');return {index,map:buildTextMap(index).containers};}

 private renderLinkForm(s:DocumentSession,sel:SelectionInfo){
  const t=this.callbacks.t;
  const index=new SourceIndex(s.workingSource);
  const el=index.nodes.find(n=>n.kind==='element'&&n.id===sel.nodeId);
  if(!el||el.kind!=='element'){this.content.createDiv({cls:'html-atelier-panelnote',text:t('formEmptyNoSelection')});return;}
  const href=el.attrs.find(a=>a.name==='href');
  const wrap=this.content.createDiv({cls:'html-atelier-form'});
  wrap.createDiv({cls:'html-atelier-formhead'}).createSpan({text:t('formLinkHref')});
  const hrefInput=wrap.createEl('input',{cls:'html-atelier-input',attr:{type:'text','aria-label':t('formLinkHref'),spellcheck:'false'}});
  hrefInput.value=href?.value??'';
  const resolvedWrap=wrap.createDiv({cls:'html-atelier-hint'});
  const updateResolved=()=>{
   const v=hrefInput.value.trim();
   resolvedWrap.setText(v?this.describeLink(v,s):'');
  };
  updateResolved();
  hrefInput.addEventListener('input',updateResolved);
  const commitHref=()=>{
   if(!href){ // 无 href 属性:在标签名后插入
    const insert=el.startTagStart+2;
    this.callbacks.applyTextPatch({start:insert,end:insert,expected:'',replacement:` href="${escapeAttrValue(hrefInput.value,'"')}"`});
    return;
   }
   if(href.value===hrefInput.value)return;
   const q=href.quote===''?'':href.quote;
   this.callbacks.applyTextPatch({start:href.valueStart,end:href.valueEnd,expected:href.value,
    replacement:escapeAttrValue(hrefInput.value,q===''?'':q)});
  };
  hrefInput.addEventListener('change',commitHref);
  hrefInput.addEventListener('blur',commitHref);
  const btnRow=wrap.createDiv({cls:'html-atelier-btnrow'});
  const pick=btnRow.createEl('button',{attr:{'type':'button'},text:t('formLinkBrowse')});
  pick.addEventListener('click',()=>{void (async()=>{
   const path=await this.callbacks.pickLibraryFile(f=>['html','htm'].includes(f.extension.toLowerCase()));
   if(path){hrefInput.value=path;commitHref();}
  })();});
  const test=btnRow.createEl('button',{attr:{'type':'button'},text:t('formLinkOpenTest')});
  test.addEventListener('click',()=>{window.open(hrefInput.value,'_blank','noopener');});
  // 链接文字(单节点内)
  const textSeg=this.linkTextSegment(s,el.start,el.end);
  if(textSeg){
   wrap.createDiv({cls:'html-atelier-formhead'}).createSpan({text:t('formLinkText')});
   const ta=wrap.createEl('textarea',{cls:'html-atelier-textarea',attr:{rows:'2','aria-label':t('formLinkText')}});
   ta.value=textSeg.text;
   ta.addEventListener('change',()=>{
    const idx2=new SourceIndex(s.workingSource);
    const cur=idx2.nodes.find((n):n is TextNodeInfo=>n.kind==='text'&&n.start===textSeg.start);
    if(cur&&cur.raw!==ta.value)this.callbacks.applyTextPatch({start:cur.start,end:cur.end,expected:cur.raw,replacement:escapeText(ta.value)});
   });
  }
  void sel;
  this.content.append(wrap);
 }

 private linkTextSegment(s:DocumentSession,elStart:number,elEnd:number){
  const model=parseDocument(s.workingSource);
  return model.segments.find(seg=>seg.start>elStart&&seg.end<elEnd)??null;
 }

 private describeLink(href:string,s:DocumentSession):string{
  const resolved=this.describeLinkResolved(href,s);
  return resolved;
 }

 private describeLinkResolved(href:string,_s:DocumentSession):string{
  void _s;
  if(!href)return '';
  if(/^https?:\/\//i.test(href))return href;
  if(/^#/i.test(href))return `#${href.slice(1)}`;
  const active=this.callbacks.activeFilePath()??'';
  const dir=active.includes('/')?active.slice(0,active.lastIndexOf('/')+1):'';
  const clean=href.split('#')[0].split('?')[0];
  const norm=normJoinDir(dir,clean);
  return norm+(href.includes('#')?'#'+href.split('#')[1]:'');
 }

 private renderImageForm(s:DocumentSession,sel:SelectionInfo){
  const t=this.callbacks.t;
  const index=new SourceIndex(s.workingSource);
  const el=index.nodes.find(n=>n.kind==='element'&&n.id===sel.nodeId);
  if(!el||el.kind!=='element'){this.content.createDiv({cls:'html-atelier-panelnote',text:t('formEmptyNoSelection')});return;}
  const src=el.attrs.find(a=>a.name==='src');
  const alt=el.attrs.find(a=>a.name==='alt');
  const wrap=this.content.createDiv({cls:'html-atelier-form'});
  wrap.createDiv({cls:'html-atelier-formhead'}).createSpan({text:t('formImageSrc')});
  const srcInput=wrap.createEl('input',{cls:'html-atelier-input',attr:{type:'text','aria-label':t('formImageSrc'),spellcheck:'false'}});
  srcInput.value=src?.value??'';
  srcInput.addEventListener('change',()=>this.commitAttr(s,index,el.id,'src',src,srcInput.value));
  const altWrap=wrap.createDiv({cls:'html-atelier-formhead'});
  altWrap.createSpan({text:t('formImageAlt')});
  const altInput=wrap.createEl('input',{cls:'html-atelier-input',attr:{type:'text','aria-label':t('formImageAlt')}});
  altInput.value=alt?.value??'';
  altInput.addEventListener('change',()=>this.commitAttr(s,index,el.id,'alt',alt,altInput.value));
  const btnRow=wrap.createDiv({cls:'html-atelier-btnrow'});
  const pick=btnRow.createEl('button',{attr:{'type':'button'},text:t('formImagePick')});
  pick.addEventListener('click',()=>{void (async()=>{
   const path=await this.callbacks.pickLibraryFile(f=>['png','jpg','jpeg','webp','gif','svg','bmp','avif'].includes(f.extension.toLowerCase()));
   if(path){srcInput.value=path;this.commitAttr(s,index,el.id,'src',src,path);}
  })();});
  const imp=btnRow.createEl('button',{attr:{'type':'button'},text:t('formImageImport')});
  imp.addEventListener('click',()=>{void (async()=>{
   const path=await this.callbacks.importImage();
   if(path){srcInput.value=path;this.commitAttr(s,index,el.id,'src',src,path);}
  })();});
  // picture/srcset 提示(F15)
  const inPicture=index.nodes.some(n=>n.kind==='element'&&n.tag==='picture'&&n.childIds.includes(el.id));
  const srcset=el.attrs.find(a=>a.name==='srcset');
  if(inPicture||srcset){
   const warn=wrap.createDiv({cls:'html-atelier-hint html-atelier-warn',text:t('formImageResponsive')});
   void warn;
   const single=wrap.createEl('button',{attr:{'type':'button'},text:t('formImageReplaceSingle')});
   single.addEventListener('click',()=>{
    const src2=this.callbacks.getActiveSession()?.session.workingSource??'';
    const patches:import('../core/patch').TextPatch[]=[];
    // 删除整个属性的区间计算在 panelHelpers.planSrcsetRemoval(纯函数):
    // 探针与单测直接调用同一实现,否则"忠实转写"只会复刻旧算法(round4 BUG 12)
    if(srcset){
     const removal=planSrcsetRemoval(src2,srcset);
     if(removal)patches.push(removal);
    }
    if(src)patches.push({start:src.valueStart,end:src.valueEnd,expected:src2.slice(src.valueStart,src.valueEnd),replacement:escapeAttrValue(srcInput.value,src.quote===''?'':src.quote)});
    this.callbacks.applyPatches(patches,'image','img-replace');
   });
  }
  this.content.append(wrap);
 }

 private commitAttr(s:DocumentSession,index:SourceIndex,elId:number,attrName:string,attr:AttrInfo|undefined,value:string){
  const el=index.nodes.find(n=>n.kind==='element'&&n.id===elId);
  if(!el||el.kind!=='element')return;
  if(attr&&attr.hasEqual){
   if(attr.value===value)return;
   this.callbacks.applyTextPatch({start:attr.valueStart,end:attr.valueEnd,expected:attr.value,
    replacement:escapeAttrValue(value,attr.quote===''?'':attr.quote)});
  }else if(attr){
   // 无值属性(<img alt>):在属性名之后补值。此前这一支什么都不做,输入被静默丢弃
   this.callbacks.applyTextPatch({start:attr.end,end:attr.end,expected:'',
    replacement:`="${escapeAttrValue(value,'"')}"`});
  }else{
   // 属性名必须来自调用方:此前恒用 attrNameOf(tag)(img 恒为 "src"),
   // 于是在 alt 字段输入会写出第二个 src,图片被写坏且 alt 依然缺失(审计 round4 BUG 18)
   const insert=el.startTagStart+1+el.tag.length;
   this.callbacks.applyTextPatch({start:insert,end:insert,expected:'',replacement:` ${attrName}="${escapeAttrValue(value,'"')}"`});
  }
  void s;
 }

 // ---- 大纲/文案列表(F10) ----
 private outlineState(s:DocumentSession):OutlineState{
  let state=this.outlineStates.get(s);
  if(!state){state={open:false,selected:null};this.outlineStates.set(s,state);}
  return state;
 }

 private renderOutlineTab(s:DocumentSession){
  const t=this.callbacks.t;
  const index=new SourceIndex(s.workingSource);
  const containers=buildTextMap(index).containers;
  this.content.empty();
  this.outlineOwner=s;
  const state=this.outlineState(s);
  const wrap=this.content.createDiv({cls:'html-atelier-outline'});
    // 标题
  const outlineHead=wrap.createDiv({cls:'html-atelier-listhead',text:t('outlineTabOutline')});
  const list=wrap.createDiv({cls:'html-atelier-list'});
  const byContainer=new Map(containers.map(c=>[c.nodeId,c.logical] as const));
  const containerAt=new Map(containers.map((c,i)=>[c.nodeId,i] as const));
  const headingsList=index.nodes.filter((n):n is Extract<SourceNode2,{kind:'element'}>=>n.kind==='element'&&/^h[1-6]$/.test(n.tag));
  const selected=state.selected;
  const candidates=selected?headingsList.filter(h=>{
   if(selected.htmlId)return h.attrs.some(a=>a.name==='id'&&a.value===selected.htmlId);
   if(selected.source===s.workingSource)return h.start===selected.start&&h.tag===selected.tag;
   return h.tag===selected.tag&&(byContainer.get(h.id)??'')===selected.text;
  }):[];
  const selectedHeading=candidates.length===1?candidates[0]:null;
  if(selectedHeading&&selected)state.selected={...selected,start:selectedHeading.start,text:byContainer.get(selectedHeading.id)??'',source:s.workingSource};
  else if(selected)state.selected=null;
  outlineHead.createSpan({cls:'html-atelier-count',text:String(headingsList.length)});
  if(!headingsList.length&&!containers.length){list.createDiv({cls:'html-atelier-panelnote',text:t('outlineEmpty')});}
  for(const h of headingsList){
   const id=h.attrs.find(a=>a.name==='id');
   // 标题文字取该标题容器的**完整逻辑文本**:只看 childIds[0] 时,标题以元素开头
   // (<h2><a href="#s">T</a></h2>、<h2><em>T</em></h2>)或内联元素后还有文字时,
   // 都会退化成裸标签名,同一面板下方的段落列表却显示正确(审计 round4 缺陷 45)。
   const logical=byContainer.get(h.id)??'';
   const label=logical.trim()||h.tag;
   const row=list.createEl('button',{cls:`html-atelier-row html-atelier-outlinerow html-atelier-h${h.tag.slice(1)}`,attr:{type:'button',title:label}});
   row.createSpan({cls:'html-atelier-headinglevel',text:h.tag.toUpperCase(),attr:{'aria-hidden':'true'}});
   row.createSpan({cls:'html-atelier-rowlabel',text:label});
   if(h===selectedHeading){row.classList.add('html-atelier-selected');row.setAttribute('aria-current','location');}
   row.addEventListener('click',()=>{
    state.selected={htmlId:id?.value??null,tag:h.tag,text:logical,start:h.start,source:s.workingSource};
    for(const other of list.children){other.classList.remove('html-atelier-selected');other.removeAttribute('aria-current');}
    row.classList.add('html-atelier-selected');row.setAttribute('aria-current','location');
    // 标题优先跳**预览**,按容器定位而不是按锚点:库里 HTML 的标题大多没有 id,
    // 走锚点只会落到源码/分栏,预览一动不动,用户看到的就是"点了没反应"
    // (用户反馈 2026-09-14)。定位失败时才退回锚点/源码,不让点击静默失效。
    const ci=containerAt.get(h.id);
    if(ci!==undefined&&this.callbacks.revealInPreview(ci,0,logical.length))return;
    if(id)this.callbacks.locatePreview(`#${id.value}`);
    else this.callbacks.locateInSource(h.start);
   });
  }
  const texts=wrap.createEl('details',{cls:'html-atelier-textlistdetails'});
  texts.open=state.open;
  texts.addEventListener('toggle',()=>{if(texts.isConnected)state.open=texts.open;});
  const summary=texts.createEl('summary',{cls:'html-atelier-listhead',text:t('outlineTabTexts')});
  summary.createSpan({cls:'html-atelier-count',text:String(containers.length)});
  const textList=texts.createDiv({cls:'html-atelier-list'});
  for(const [ci,c] of containers.entries()){
   const blank=!c.logical.trim();
   const row=textList.createEl('button',{cls:`html-atelier-row html-atelier-textrow${blank?' html-atelier-muted':''}`,attr:{type:'button'}});
   // 空段落也要列出来:此前直接 continue,段落被清空后就从列表里彻底消失,
   // 用户再也找不回它(审计复检 §3.23 M8)。
   row.setText(blank?t('outlineBlankRow'):c.logical.slice(0,80));
   row.addEventListener('click',()=>{
    if(blank){
     // 空容器没有文字节点可定位:直接打开整段表单,让用户把内容写回去
     (window as unknown as {htmlAtelierSelection?:SelectionInfo|null}).htmlAtelierSelection={kind:'paragraph',containerIndex:ci};
     this.setTab('edit');
     return;
    }
    this.callbacks.revealInPreview(ci,0,c.logical.length);
   });
  }
 }

 // ---- 修改清单(F11) ----
 private renderChangesTab(s:DocumentSession){
  const t=this.callbacks.t;
  const base=parseDocument(s.baseSource).segments;
  const work=parseDocument(s.workingSource).segments;
  this.content.empty();
  const wrap=this.content.createDiv({cls:'html-atelier-changes'});
  const items:{kind:string; id:string; before:string; after:string; start:number; end:number; raw:string; locateId:string|null}[]=[];
  // 段 id 是文档顺序流水号,跨"基准/工作稿"两次解析不稳定:清空/新增文字节点后
  // 后续 id 全部错位,按 id 配对会出成串幻影条目(实测 2026-09-16:清空一段,
  // 之后每段都显示"已修改")。改为按 alignSegments(前后缀+LCS)对齐;
  // 修改/新增登记 work 侧 id 与偏移,删除登记 base 侧。
  // locateId 只传 work 侧段 id:删除项的 base 侧 id 会在工作稿里撞上别的片段,
  // 定位会滚到错误位置 —— 删除/源码项传 null,由 locateChange 降级到分栏滚源码。
  for(const {base:b,work:w} of alignSegments(base,work)){
   if(b&&w){
    if(b.text!==w.text)items.push({kind:'text',id:w.id,before:b.text,after:w.text,start:w.start,end:w.end,raw:w.text,locateId:w.id});
   }else if(w)items.push({kind:'text',id:w.id,before:'(新增)',after:w.text,start:w.start,end:w.end,raw:w.text,locateId:w.id});
   else if(b)items.push({kind:'text',id:b.id,before:b.text,after:'(删除)',start:b.start,end:b.end,raw:b.text,locateId:null});
  }
  if(s.workingSource!==s.baseSource&&!items.length)items.push({kind:'source',id:'src',before:s.baseSource.slice(0,200),after:s.workingSource.slice(0,200),start:0,end:s.workingSource.length,raw:s.workingSource,locateId:null});
  if(!items.length){wrap.createDiv({cls:'html-atelier-panelnote',text:t('changesEmpty')});return;}
  const head=wrap.createDiv({cls:'html-atelier-btnrow'});
  const restoreAll=head.createEl('button',{attr:{'type':'button'},text:t('changesRestoreAll')});
  restoreAll.addEventListener('click',()=>{
   if(!window.confirm(t('changesConfirmAll',{n:String(items.length)})))return;
   for(const item of [...items].reverse())this.restoreItem(s,item);
  });
  for(const item of items){
   const row=wrap.createDiv({cls:'html-atelier-change'});
   const rowHead=row.createDiv({cls:'html-atelier-changehead'});
   rowHead.createSpan({cls:'html-atelier-muted',text:t('changesKindText')});
   const btns=rowHead.createDiv({cls:'html-atelier-btnrow'});
   const loc=btns.createEl('button',{attr:{'type':'button'},text:t('changesLocation')});
   loc.addEventListener('click',()=>this.callbacks.locateChange(item.start,item.locateId));
   const restore=btns.createEl('button',{attr:{'type':'button'},text:t('changesRestoreOne')});
   // 删除/源码类条目(locateId===null)没有可写回的工作稿节点:恢复是静默无操作,
   // 与其让按钮点了没反应,不如置灰(2026-09-16)
   restore.disabled=s.operation!=='idle'||item.locateId===null;
   restore.addEventListener('click',()=>this.restoreItem(s,item));
   const diff=row.createDiv({cls:'html-atelier-diff'});
   diff.createDiv({cls:'html-atelier-diffline html-atelier-diffold',text:item.before});
   diff.createDiv({cls:'html-atelier-difflinet html-atelier-diffnew',text:item.after});
  }
 }

 private restoreItem(s:DocumentSession,item:{id:string; before:string; after:string; start:number; end:number; raw:string}){
  const idx=new SourceIndex(s.workingSource);
  const node=idx.nodes.find((n):n is TextNodeInfo=>n.kind==='text'&&n.start===item.start&&n.raw===item.raw);
  // 基准段必须按对齐取(id 跨解析不稳定,错位后会把别的段落的原文写进本段落)
  const baseSeg=alignSegments(parseDocument(s.baseSource).segments,parseDocument(s.workingSource).segments)
   .find(pr=>pr.work?.id===item.id)?.base??null;
  if(node&&baseSeg){
   this.callbacks.applyTextPatch({start:node.start,end:node.end,expected:node.raw,replacement:escapeText(baseSeg.text)},'restore');
  }else if(baseSeg){
   const {index,map}=this.rebuild();
   const c=map.find(cc=>cc.logical===item.raw);
   if(c){const at=c.logical.indexOf(item.raw);const r=replaceLogical(index,c,at,at+item.raw.length,baseSeg.text);if(r.ok)this.callbacks.applyTextPatch(r.patch,'restore');}
  }
 }

 // ---- 资源(F17) ----
 private renderResourcesTab(s:DocumentSession){
  const t=this.callbacks.t;
  const index=new SourceIndex(s.workingSource);
  const file=this.callbacks.activeFilePath()??'';
  const exists=(p:string)=>!!this.appFileExists(p);
  const allow=this.callbacks.settings().preview.allowNetworkAssets;
  const list=collectResourcesIndexed(index,file,exists,allow);
  this.content.empty();
  const wrap=this.content.createDiv({cls:'html-atelier-resources'});
  const head=wrap.createDiv({cls:'html-atelier-btnrow'});
  const refresh=head.createEl('button',{attr:{'type':'button'},text:t('resourcesRefresh')});
  refresh.addEventListener('click',()=>this.refresh(true));
  if(!list.length){wrap.createDiv({cls:'html-atelier-panelnote',text:t('resourcesEmpty')});return;}
  for(const r of list){
   const row=wrap.createDiv({cls:'html-atelier-row html-atelier-resource'});
   row.createSpan({cls:'html-atelier-muted',text:r.tag});
   row.createSpan({text:r.raw.slice(0,60)});
   // 文案按 status 取,不要按 local/remote 二选一:那样 'blocked'(按设置拦截的网络资源)
   // 会显示成"远程",用户看不出资源为什么加载不了(审计 round4 缺陷 36)。
   const badge=row.createSpan({cls:`html-atelier-badge html-atelier-badge-${r.status}`,
    text:resourceStatusText(r.status,k=>t(k as never))});
   void badge;
   const jump=row.createEl('button',{attr:{'type':'button'},text:t('resourcesJumpSource')});
   jump.addEventListener('click',()=>this.callbacks.locateInSource(r.offset));
  }
 }

 private appFileExists(path:string):boolean{
  const w=window as unknown as {htmlAtelierExists?(p:string):boolean};
  return w.htmlAtelierExists?.(path)??false;
 }

 // ---- 搜索(F09) ----
 private searchDebounceTimer:number|null=null;
 private runSearchDebounced(){
  if(this.searchDebounceTimer)window.clearTimeout(this.searchDebounceTimer);
  this.searchDebounceTimer=window.setTimeout(()=>this.runSearch(),150);
 }

 private runSearch(){
  const q=this.searchBox.value;
  this.searchResults.empty();
  this.searchHits=[];
  this.searchAt=-1;
  if(!q)return;
  const s=this.callbacks.getActiveSession()?.session;
  if(!s)return;
  const {index,map}=this.rebuild();
  void index;
  const containers=map;
  const caseSensitive=this.searchCase.checked;
  const needle=caseSensitive?q:q.toLowerCase();
  for(const [ci,c] of containers.entries()){
   if(c.hidden&&!this.callbacks.settings().search.includeHidden)continue;
   const hay=caseSensitive?c.logical:c.logical.toLowerCase();
   let at=hay.indexOf(needle);
   while(at>=0){
    this.searchHits.push({containerIndex:ci,start:at,end:at+q.length,
     preview:c.logical.slice(Math.max(0,at-20),at+q.length+20),path:c.tag,hidden:c.hidden});
    at=hay.indexOf(needle,at+Math.max(1,q.length));
   }
  }
  const t=this.callbacks.t;
  if(!this.searchHits.length){this.searchResults.createDiv({cls:'html-atelier-hint',text:t('searchNoResults')});return;}
  for(const [i,hit] of this.searchHits.entries()){
   const row=this.searchResults.createDiv({cls:'html-atelier-row html-atelier-searchhit'});
   row.setText(`${hit.path}: …${hit.preview}…${hit.hidden?t('outlineHiddenMark'):''}`);
   row.addEventListener('click',()=>{
    const s2=this.callbacks.getActiveSession()?.session;
    if(!s2)return;
    const {index:idx,map}=this.rebuild();
    const c=map[hit.containerIndex];
    const r=rangesForLogical(c,hit.start,hit.end);
    if(r.length===1){
     const seg=this.segmentAt(idx,r[0].srcStart);
     if(seg){
      (window as unknown as {htmlAtelierSelection?:SelectionInfo|null}).htmlAtelierSelection={kind:'text',segmentId:seg.id};
      this.callbacks.locatePreview(seg.id);
      this.refresh(true);
     }
    }else this.callbacks.revealInPreview(hit.containerIndex,hit.start,hit.end);
   });
   void i;
  }
 }

 // F13:全部替换(普通文本,单节点命中;跨节点命中计数跳过;一次事务,可整体撤销)
 private replaceAll(){
  const q=this.searchBox.value;
  const replacement=this.replaceBox.value;
  if(!q||!this.searchHits.length)return;
  const s=this.callbacks.getActiveSession()?.session;
  if(!s)return;
  const {index,map}=this.rebuild();
  const patches:import('../core/patch').TextPatch[]=[];
  let skipped=0;
  for(const hit of this.searchHits){
   const c=map[hit.containerIndex];
   const ranges=rangesForLogical(c,hit.start,hit.end);
   if(ranges.length!==1){skipped++;continue;}
   const r=ranges[0];
   patches.push({start:r.srcStart,end:r.srcEnd,expected:index.source.slice(r.srcStart,r.srcEnd),replacement:escapeText(replacement)});
  }
  if(!patches.length){new Notice(t0(this.callbacks,'searchNoResults'));return;}
  try{
   // applyPatches 内部已捕获 PatchError 并提示,不会抛出;必须看返回值
   const applied=this.callbacks.applyPatches(patches,'text','replace-all',undefined,true);
   if(applied){if(skipped)new Notice(t0(this.callbacks,'searchSkipped',{n:String(skipped)}));return;}
  }catch{
   // 相邻命中且替换长度变化时,单事务会被相邻边界防护拒绝(patch.ts)。
   // 真降级:一次一处、各自独立事务(一次撤销一步),好过整批不动
   // (审计复检 §3.3:原注释承诺了降级,代码里并没有)。
  }
  let done=0;
  // 按原命中逐个应用,并用累计位移重定位后续命中。
  // 不能"每步重新搜索第一个匹配":替换文本会与其后的原文拼出新的匹配,同一处被反复
  // 改写(实测 '谢谢谢谢' + '非常感谢' 得到 '非常感非常感非常感谢')。
  const ordered=[...patches].sort((a,b)=>a.start-b.start);
  let delta=0;
  for(const p of ordered){
   const session=this.callbacks.getActiveSession()?.session;
   if(!session)break;
   const src=session.workingSource;
   const start=p.start+delta,end=p.end+delta;
   if(start<0||end>src.length||start>end)break;
   const one=this.callbacks.applyPatches([{start,end,expected:src.slice(start,end),replacement:p.replacement}],'text','replace-all',undefined,true);
   if(!one)break; // 单点都无法应用:停止,避免死循环
   delta+=p.replacement.length-(p.end-p.start);
   done++;
  }
  if(!done)new Notice(t0(this.callbacks,'searchNoResults'));
  else if(done<patches.length)new Notice(t0(this.callbacks,'searchSkipped',{n:String(patches.length-done)}));
 }

 private segmentAt(index:SourceIndex,offset:number){
  const model=parseDocument(this.callbacks.getActiveSession()?.session.workingSource??'');
  void index;
  return model.segments.find(seg=>offset>=seg.start&&offset<=seg.end)??null;
 }
}

// boundaryOffset / graphemes 已移到 src/parsing/paragraphEdit.ts,与补丁规划同处一地,
// 便于单元测试与审计探针直接调用产品实现(而不是各自转写一份)。

import {type SourceNode as SourceNode2,TextNodeInfo} from '../parsing/sourceIndex';

function t0(cb:PanelCallbacks,key:'searchNoResults'|'searchSkipped'|'noticeParagraphUnavailable',params?:Record<string,string>):string{
 const tt=cb.t as unknown as (k:string,p?:Record<string,string>)=>string;
 return tt(key,params);
}
import {normJoinDir,collectResourcesIndexed,resourceStatusText,planSrcsetRemoval} from './panelHelpers';
