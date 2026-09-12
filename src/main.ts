import {FileView, ItemView, Modal, Notice, Plugin, TFile, WorkspaceLeaf, setIcon} from 'obsidian';
import {applyText, EditSession, makePreview} from './model';

const HTML_VIEW='html-atelier-preview', PANEL_VIEW='html-atelier-panel';
const OVERLAY_CSS='html-atelier-selection-layer{all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647}html-atelier-selection-box{position:fixed;pointer-events:none;box-sizing:border-box;left:var(--html-atelier-x);top:var(--html-atelier-y);width:var(--html-atelier-w);height:var(--html-atelier-h);border:var(--html-atelier-border);border-radius:2px}';
interface Draft {source:string; changes:[string,string][]}
interface Stored {drafts:Record<string,Draft>}
const isHtml=(file:TFile|null):file is TFile=>!!file&&['html','htm'].includes(file.extension.toLowerCase());

export default class HtmlAtelier extends Plugin {
 sessions=new Map<string,EditSession>(); stored:Stored={drafts:{}};active:HtmlView|null=null;
 private pendingSessions=new Map<string,Promise<EditSession>>();
 private writeQueue=Promise.resolve();private panelPromise:Promise<void>|null=null;private ending=false;
 async onload(){
  const data=(await this.loadData()) as Stored|null;if(data?.drafts)this.stored.drafts=data.drafts;
  this.registerView(HTML_VIEW,leaf=>new HtmlView(leaf,this));
  this.registerView(PANEL_VIEW,leaf=>new HtmlPanel(leaf,this));
  for(const ext of ['html','htm']){try{this.registerExtensions([ext],HTML_VIEW);}catch{new Notice(`HTML Atelier：.${ext} 已被其他插件接管。停用旧 HTML 插件后重启即可自动打开，也可使用文件右键菜单。`,10000);}}
  this.addCommand({id:'show-panel',name:'打开 HTML 右侧栏',callback:()=>void this.showPanel()});
  this.addCommand({id:'save-html',name:'保存当前 HTML',checkCallback:checking=>{const s=this.currentSession();if(!s)return false;if(!checking)void this.save(this.active!.file!,s);return true;}});
  this.addCommand({id:'toggle-mode',name:'切换 HTML 预览 / 编辑',checkCallback:checking=>{const s=this.currentSession();if(!s)return false;if(!checking){s.mode=s.mode==='edit'?'preview':'edit';this.refresh();void this.showPanel();}return true;}});
  this.registerEvent(this.app.workspace.on('active-leaf-change',leaf=>{
   if(leaf?.view instanceof HtmlView){const changed=this.active!==leaf.view;this.active=leaf.view;this.refresh();if(changed)void this.showPanel();}
   else if(leaf?.view.getViewType()!==PANEL_VIEW){this.active=null;this.refresh();}
  }));
  this.registerEvent(this.app.workspace.on('file-open',file=>{const view=this.app.workspace.getActiveViewOfType(HtmlView);if(isHtml(file)&&view){this.active=view;this.refresh();void this.showPanel();}}));
  this.registerEvent(this.app.vault.on('modify',file=>{if(file instanceof TFile)void this.externalChange(file);}));
  this.registerEvent(this.app.vault.on('rename',(file,old)=>{
   const s=this.sessions.get(old);if(s){this.sessions.delete(old);this.sessions.set(file.path,s);}
   const draft=this.stored.drafts[old];if(draft){delete this.stored.drafts[old];this.stored.drafts[file.path]=draft;void this.persist();}
   for(const view of this.views())if(view.file===file)view.renderFrame();this.refresh();
  }));
  this.registerEvent(this.app.workspace.on('file-menu',(menu,file)=>{if(file instanceof TFile&&isHtml(file))menu.addItem(item=>item.setTitle('使用 HTML Atelier 打开').setIcon('file-code-2').onClick(async()=>{const leaf=this.app.workspace.getLeaf(false);await leaf.setViewState({type:HTML_VIEW,state:{file:file.path},active:true});}));}));
  this.app.workspace.onLayoutReady(()=>{const view=this.app.workspace.getActiveViewOfType(HtmlView);if(view){this.active=view;void this.showPanel();}});
 }
 onunload(){this.ending=true;void this.persist();}
 views(){return this.app.workspace.getLeavesOfType(HTML_VIEW).map(l=>l.view as HtmlView);}
 currentSession(){return this.active?.session??null;}
 async getSession(file:TFile){
  const existing=this.sessions.get(file.path);if(existing)return existing;
  const pending=this.pendingSessions.get(file.path);if(pending)return pending;
  const load=this.loadSession(file);this.pendingSessions.set(file.path,load);
  try{return await load;}finally{this.pendingSessions.delete(file.path);}
 }
 private async loadSession(file:TFile){
  const source=await this.app.vault.read(file);const d=this.stored.drafts[file.path];
  const session=new EditSession(d?.source??source);
  if(d){for(const [id,text] of d.changes)session.set(id,text);session.history=[];session.conflict=source!==d.source;new Notice(session.conflict?'HTML 草稿已恢复，但原文件已变化。请先处理右侧栏中的冲突。':'已恢复该 HTML 的未保存文案草稿。');}
  this.sessions.set(file.path,session);return session;
 }
 async showPanel(){
  if(this.ending)return;if(this.panelPromise)return this.panelPromise;
  this.panelPromise=(async()=>{let leaf=this.app.workspace.getLeavesOfType(PANEL_VIEW)[0];if(!leaf){const right=this.app.workspace.getRightLeaf(false);if(!right)return;leaf=right;await leaf.setViewState({type:PANEL_VIEW,active:false});}await this.app.workspace.revealLeaf(leaf);(leaf.view as HtmlPanel).refresh();})();
  try{await this.panelPromise;}finally{this.panelPromise=null;}
 }
 refresh(){for(const view of this.views())view.sync();for(const leaf of this.app.workspace.getLeavesOfType(PANEL_VIEW))(leaf.view as HtmlPanel).refresh();}
 changed(file:TFile,s:EditSession){this.cacheDraft(file,s);this.refresh();}
 cacheDraft(file:TFile,s:EditSession){if(s.dirty)this.stored.drafts[file.path]={source:s.model.source,changes:[...s.changes]};else delete this.stored.drafts[file.path];void this.persist();}
 persist(){const snapshot=JSON.parse(JSON.stringify(this.stored)) as Stored;this.writeQueue=this.writeQueue.catch(()=>{}).then(()=>this.saveData(snapshot));this.writeQueue.catch(e=>{console.error('HTML Atelier draft persistence',e);new Notice('HTML 草稿备份失败，请及时保存原文件。');});return this.writeQueue;}
 async save(file:TFile,s:EditSession){
  if(s.busy||!s.dirty)return !s.dirty;s.busy=true;this.refresh();
  try{
   const output=applyText(s.model,s.changes);
   await this.app.vault.process(file,current=>{if(current!==s.model.source)throw new Error('external-conflict');return output;});
   s.saved(output);this.cacheDraft(file,s);for(const view of this.views())if(view.session===s)view.renderFrame();new Notice('HTML 文案已保存');return true;
  }catch(e){if(e instanceof Error&&e.message==='external-conflict'){s.conflict=true;new Notice('原文件已被其他程序修改。已阻止覆盖，你的文案草稿仍保留。',7000);}else{console.error(e);new Notice('保存失败，文案草稿已保留。');}return false;
  }finally{s.busy=false;this.refresh();}
 }
 async externalChange(file:TFile){const s=this.sessions.get(file.path);if(!s||s.busy)return;const source=await this.app.vault.read(file);if(source===s.model.source)return;if(s.dirty){s.conflict=true;this.refresh();}else{s.saved(source);for(const view of this.views())if(view.session===s)view.renderFrame();this.refresh();}}
 async reload(file:TFile,s:EditSession){const source=await this.app.vault.read(file);s.saved(source);this.cacheDraft(file,s);for(const view of this.views())if(view.session===s)view.renderFrame();this.refresh();}
 async exportDraft(file:TFile,s:EditSession){
  try{const parent=file.parent?.path;const stem=(parent&&parent!=='/'?parent+'/':'')+file.basename+'-文案草稿-'+Date.now();let path=stem+'.html';let n=1;while(this.app.vault.getAbstractFileByPath(path))path=stem+'-'+n+++'.html';await this.app.vault.create(path,applyText(s.model,s.changes));new Notice('已另存草稿：'+path);}catch(e){console.error(e);new Notice('另存草稿失败，原草稿仍保留。');}
 }
}

class HtmlView extends FileView {
 session:EditSession|null=null;iframe:HTMLIFrameElement|null=null;private loadToken=0;
 private textNodes=new Map<string,Text>();private overlay:ShadowRoot|null=null;private hovered:string|null=null;
 constructor(leaf:WorkspaceLeaf,readonly plugin:HtmlAtelier){super(leaf);}
 getViewType(){return HTML_VIEW;}getIcon(){return 'file-code-2';}canAcceptExtension(ext:string){return ['html','htm'].includes(ext.toLowerCase());}
 async onOpen(){this.contentEl.addClass('html-atelier-view');}
 async onLoadFile(file:TFile){
  const token=++this.loadToken;
  try{const s=await this.plugin.getSession(file);if(token!==this.loadToken)return;this.session=s;this.renderFrame();if(this.app.workspace.getActiveViewOfType(HtmlView)===this){this.plugin.active=this;void this.plugin.showPanel();}this.plugin.refresh();}
  catch(e){console.error(e);this.contentEl.empty();this.contentEl.createDiv({text:'无法读取 HTML 文件。请检查文件是否存在。',cls:'html-atelier-empty'});}
 }
 async onUnloadFile(file:TFile){++this.loadToken;if(this.session)this.plugin.cacheDraft(file,this.session);this.session=null;this.iframe=null;if(this.plugin.active===this)this.plugin.active=null;this.plugin.refresh();}
 async onClose(){if(this.file&&this.session)this.plugin.cacheDraft(this.file,this.session);if(this.plugin.active===this)this.plugin.active=null;this.plugin.refresh();}
 renderFrame(){
  if(!this.session||!this.file)return;
  const old=this.iframe?.contentWindow;let scrollX=0,scrollY=0;try{scrollX=old?.scrollX??0;scrollY=old?.scrollY??0;}catch{/* the frame may already be detached */}
  this.contentEl.empty();const frame=this.contentEl.createEl('iframe',{cls:'html-atelier-frame',attr:{sandbox:'allow-same-origin',title:this.file.name+' — HTML 预览',referrerpolicy:'no-referrer'}});this.iframe=frame;
  frame.addEventListener('load',()=>{
   const doc=frame.contentDocument;if(!doc)return;
   this.textNodes.clear();const walker=doc.createTreeWalker(doc,128);let comment:Node|null;
   while((comment=walker.nextNode())){const match=/^html-atelier-text:(t\d+)$/.exec(comment.nodeValue??'');if(match&&comment.nextSibling?.nodeType===3)this.textNodes.set(match[1],comment.nextSibling as Text);}
   // Overlay elements live in the frame document, so they are created through the frame's own createElement.
   const styleEl=doc.createElement('style');styleEl.textContent=OVERLAY_CSS;doc.head.append(styleEl);
   const layer=doc.createElement('html-atelier-selection-layer');doc.documentElement.append(layer);this.overlay=layer.attachShadow({mode:'open'});
   const shadowStyle=doc.createElement('style');shadowStyle.textContent=OVERLAY_CSS;this.overlay.append(shadowStyle);
   this.sync();frame.contentWindow?.scrollTo(scrollX,scrollY);
   const findText=(event:MouseEvent)=>{
    const pos=(doc as Document&{caretPositionFromPoint?(x:number,y:number):{offsetNode:Node;offset:number}|null}).caretPositionFromPoint?.(event.clientX,event.clientY);
    let range:Range|null=null;
    if(pos){range=doc.createRange();range.setStart(pos.offsetNode,pos.offset);range.collapse(true);}
    else{
     // Fallback for app builds that predate caretPositionFromPoint.
     range=(doc as Document&{caretRangeFromPoint(x:number,y:number):Range|null}).caretRangeFromPoint(event.clientX,event.clientY);
    }
    if(range){for(const [id,node] of this.textNodes)if(node===range.startContainer&&this.containsPoint(node,event.clientX,event.clientY))return id;}
    const target=event.target as Element;const matches=[...this.textNodes].filter(([,node])=>target.contains(node));return matches.length===1?matches[0][0]:null;};
   doc.addEventListener('mousemove',event=>{if(this.session?.mode!=='edit')return;const id=findText(event);if(id!==this.hovered){this.hovered=id;this.drawSelection();}});
   doc.addEventListener('mouseleave',()=>{this.hovered=null;this.drawSelection();});
   doc.addEventListener('scroll',()=>this.drawSelection(),true);frame.contentWindow?.addEventListener('resize',()=>this.drawSelection());
   doc.addEventListener('click',event=>{
    const target=event.target as Element;const s=this.session;if(!s)return;
    if(s.mode==='edit'){
     event.preventDefault();event.stopPropagation();
     const id=findText(event);
     if(id){s.selected=id;this.plugin.active=this;this.plugin.refresh();void this.plugin.showPanel();}
    }else{
     const anchor=target.closest('a');if(anchor){const href=anchor.getAttribute('href')||'';event.preventDefault();if(href.startsWith('#')){try{doc.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();}catch{/* ignore malformed anchors */}}else if(/^https?:|^mailto:/i.test(href)){window.open(href,'_blank','noopener,noreferrer');}else new Notice('此预览仅支持页内锚点和网页链接。');}
    }
   },true);
   doc.addEventListener('submit',event=>event.preventDefault(),true);
   doc.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();if(this.file&&this.session)void this.plugin.save(this.file,this.session);}});
  });
  const resource=this.app.vault.getResourcePath(this.file);const base=resource.slice(0,resource.lastIndexOf('/')+1);frame.srcdoc=makePreview(this.session.model,base);
 }
 containsPoint(node:Text,x:number,y:number){const r=node.ownerDocument.createRange();r.selectNodeContents(node);return [...r.getClientRects()].some(rect=>x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom);}
 drawSelection(){if(!this.overlay)return;this.overlay.replaceChildren();const s=this.session;if(s?.mode!=='edit')return;
  for(const id of new Set([this.hovered,s.selected])){if(!id)continue;const node=this.textNodes.get(id);if(!node)continue;const range=node.ownerDocument.createRange();range.selectNodeContents(node);for(const rect of range.getClientRects()){
    // Created through the frame's own createElement; see renderFrame.
    const box=node.ownerDocument.createElement('html-atelier-selection-box');
    box.style.setProperty('--html-atelier-x',`${rect.left-3}px`);
    box.style.setProperty('--html-atelier-y',`${rect.top-2}px`);
    box.style.setProperty('--html-atelier-w',`${rect.width+6}px`);
    box.style.setProperty('--html-atelier-h',`${rect.height+4}px`);
    box.style.setProperty('--html-atelier-border',`${id===s.selected?'2px solid':'1px dashed'} #9275df`);
    this.overlay.append(box);}}
 }
 sync(){const s=this.session;const doc=this.iframe?.contentDocument;if(!s||!doc)return;
  for(const [id,node] of this.textNodes){const value=s.value(id);if(node.data!==value)node.data=value;}this.drawSelection();
 }
}

function button(parent:HTMLElement,label:string,icon:string,run:()=>void,cls=''){const b=parent.createEl('button',{cls:'html-atelier-button '+cls,attr:{'aria-label':label,'type':'button'}});const i=b.createSpan();setIcon(i,icon);b.createSpan({text:label});b.addEventListener('click',run);return b;}

class HtmlPanel extends ItemView {
 private fileLabel!:HTMLElement;private modes!:HTMLElement;private actions!:HTMLElement;private preview!:HTMLButtonElement;private edit!:HTMLButtonElement;private undo!:HTMLButtonElement;private saveBtn!:HTMLButtonElement;
 private editor!:HTMLElement;private empty!:HTMLElement;private kind!:HTMLElement;private text!:HTMLTextAreaElement;private original!:HTMLElement;private restore!:HTMLButtonElement;private status!:HTMLElement;private conflict!:HTMLElement;
 private current:EditSession|null=null;private selected:string|null=null;
 constructor(leaf:WorkspaceLeaf,readonly plugin:HtmlAtelier){super(leaf);}
 getViewType(){return PANEL_VIEW;}getDisplayText(){return 'HTML';}getIcon(){return 'text-cursor-input';}
 async onOpen(){
  const root=this.contentEl;root.empty();root.addClass('html-atelier-panel');
  this.fileLabel=root.createDiv({cls:'html-atelier-file'});
  const controls=root.createDiv({cls:'html-atelier-controls'});this.modes=controls.createDiv({cls:'html-atelier-modes'});
  this.preview=button(this.modes,'预览','eye',()=>this.setMode('preview'));
  this.edit=button(this.modes,'编辑文案','mouse-pointer-2',()=>this.setMode('edit'));
  this.actions=controls.createDiv({cls:'html-atelier-actions'});
  this.undo=button(this.actions,'撤销','undo-2',()=>{const s=this.plugin.currentSession();if(s&&!s.busy){s.undo();this.change();}});
  this.saveBtn=button(this.actions,'保存','save',()=>{const v=this.plugin.active;if(v?.file&&v.session)void this.plugin.save(v.file,v.session);},'html-atelier-save');
  this.conflict=root.createDiv({cls:'html-atelier-conflict'});
  this.conflict.createDiv({text:'原文件已变化。为避免覆盖，请先另存文案草稿，再重新载入原文件。'});
  button(this.conflict,'另存草稿','copy',()=>{const v=this.plugin.active;if(v?.file&&v.session)void this.plugin.exportDraft(v.file,v.session);});
  button(this.conflict,'重新载入原文件','refresh-cw',()=>{const v=this.plugin.active;if(v?.file&&v.session)new ConfirmReload(this.plugin,v.file,v.session).open();});
  this.empty=root.createDiv({cls:'html-atelier-empty'});this.editor=root.createDiv({cls:'html-atelier-editor'});
  const heading=this.editor.createDiv({cls:'html-atelier-heading'});heading.createSpan({text:'文案'});this.kind=heading.createSpan({cls:'html-atelier-muted'});
  const label=this.editor.createEl('label',{text:'文字内容',cls:'html-atelier-label'});this.text=label.createEl('textarea',{attr:{rows:'7',spellcheck:'false','aria-label':'文字内容'}});
  this.text.addEventListener('input',()=>{const s=this.plugin.currentSession();if(s?.selected&&!s.busy){s.set(s.selected,this.text.value);this.change();}});
  this.text.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();const v=this.plugin.active;if(v?.file&&v.session)void this.plugin.save(v.file,v.session);}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.shiftKey){e.preventDefault();const s=this.plugin.currentSession();if(s&&!s.busy){s.undo();this.change();}}});
  this.editor.createDiv({text:'修改即时预览 · 保存后写入原文件',cls:'html-atelier-hint'});
  const before=this.editor.createDiv({cls:'html-atelier-before'});const beforeHead=before.createDiv({cls:'html-atelier-heading'});beforeHead.createSpan({text:'保存前'});
  this.restore=button(beforeHead,'恢复','rotate-ccw',()=>{const s=this.plugin.currentSession();if(s&&!s.busy){s.restore();this.change();}},'html-atelier-restore');this.restore.setAttribute('aria-label','恢复当前文案到最近一次保存');this.restore.setAttribute('title','仅恢复当前文案；可撤销');
  this.original=before.createDiv({cls:'html-atelier-original'});
  this.editor.createDiv({text:'点击页面中的其他文字，切换编辑对象。',cls:'html-atelier-hint html-atelier-footer-hint'});
  this.status=root.createDiv({cls:'html-atelier-status',attr:{'aria-live':'polite'}});this.refresh();
 }
 setMode(mode:'preview'|'edit'){const s=this.plugin.currentSession();if(s){s.mode=mode;this.plugin.refresh();}}
 change(){const v=this.plugin.active;if(v?.file&&v.session)this.plugin.changed(v.file,v.session);}
 refresh(){
  if(!this.fileLabel)return;const view=this.plugin.active;const s=view?.session??null;const seg=s?.model.segments.find(x=>x.id===s.selected);const switched=this.current!==s||this.selected!==s?.selected;
  this.current=s;this.selected=s?.selected??null;this.fileLabel.setText(view?.file?.name??'HTML Atelier');this.fileLabel.title=view?.file?.path??'';
  this.modes.hidden=!s;this.actions.hidden=!s;this.conflict.hidden=!s?.conflict;
  this.preview.setAttribute('aria-pressed',String(s?.mode==='preview'));this.edit.setAttribute('aria-pressed',String(s?.mode==='edit'));
  this.undo.disabled=!s?.history.length||!!s?.busy;this.saveBtn.disabled=!s?.dirty||!!s?.busy||!!s?.conflict;this.saveBtn.setAttribute('aria-label',s?.busy?'正在保存':'保存');
  this.editor.hidden=!s||s.mode!=='edit'||!seg;this.empty.hidden=!!s&&s.mode==='edit'&&!!seg;
  this.empty.setText(!s?'打开一个 HTML 文件，开始预览和编辑文案。':s.mode==='preview'?'正在预览。切换到「编辑文案」，点击页面文字即可修改。':s.model.segments.length?'点击页面中的标题、段落或按钮文字。嵌套样式中的文字分段编辑。':'未找到可编辑文字。此版本不执行网页脚本。');
  if(s&&seg){this.kind.setText(seg.kind);const value=s.value(seg.id);if(switched||this.text.value!==value)this.text.value=value;this.text.disabled=s.busy;this.original.setText(seg.text);this.restore.disabled=!s.changes.has(seg.id)||s.busy;}
  this.status.setText(!s?'静态 HTML · 文案编辑':s.busy?'正在保存…':s.conflict?'原文件变化 · 草稿保留':s.dirty?`${s.changes.size} 处未保存 · 自动保留草稿`:'无未保存更改');
 }
}

class ConfirmReload extends Modal {
 constructor(private plugin:HtmlAtelier,private file:TFile,private session:EditSession){super(plugin.app);}
 onOpen(){this.titleEl.setText('重新载入原文件？');this.contentEl.createEl('p',{text:'这会放弃当前文件的全部未保存文案。需要保留时，请先取消并使用「另存草稿」。'});const actions=this.contentEl.createDiv({cls:'html-atelier-actions'});button(actions,'取消','x',()=>this.close());button(actions,'放弃修改并载入','refresh-cw',()=>{void this.plugin.reload(this.file,this.session).then(()=>this.close()).catch(()=>new Notice('读取失败，草稿仍保留。'));});}
 onClose(){this.contentEl.empty();}
}
