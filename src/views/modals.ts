import {App, FuzzySuggestModal, Modal, Notice, TFile, TFolder, setIcon} from 'obsidian';
import {DocumentSession} from '../core/session';
import {MergeChunk} from '../services/merge/diff3';
import {MergeService,MergeSessionState} from '../services/mergeService';
import {SaveAsService} from '../services/saveService';
import {DraftsService} from '../services/draftsService';
import {utf8Bytes} from '../core/bytes';
import {AtelierSettings,DEFAULT_SETTINGS} from '../settings/schema';
import type {Translator} from '../i18n';

// 模态:F14 另存为、F22 三方合并、F23 草稿管理、F07 失效链接重选

export class SaveAsModal extends Modal {
 constructor(private t:Translator,private file:TFile,private draftSource:string,
  private settings:()=>AtelierSettings,private service:SaveAsService,
  private onSaved:(file:TFile)=>void,app:App){super(app);}

 onOpen(){
  const {contentEl}=this;
  contentEl.empty();
  contentEl.createEl('h3',{text:this.t('saveAsTitle')});
  contentEl.createDiv({cls:'html-atelier-hint',text:this.t('saveAsIsDraft')});
  const nameRow=contentEl.createDiv({cls:'html-atelier-form'});
  nameRow.createEl('label',{text:this.t('saveAsName')});
  const nameInput=nameRow.createEl('input',{cls:'html-atelier-input',attr:{type:'text',spellcheck:'false'}});
  nameInput.value=`${this.file.basename}-副本`;
  const folderRow=contentEl.createDiv({cls:'html-atelier-form'});
  folderRow.createEl('label',{text:this.t('saveAsFolder')});
  const folderInput=folderRow.createEl('input',{cls:'html-atelier-input',attr:{type:'text',spellcheck:'false'}});
  folderInput.value=this.service.defaultDir(this.file);
  const rebaseRow=contentEl.createDiv({cls:'html-atelier-form'});
  const rebaseCheck=rebaseRow.createEl('input',{attr:{type:'checkbox'}});
  rebaseCheck.checked=this.settings().saveAs.rebaseRelativeUrls;
  rebaseRow.createEl('label',{text:this.t('saveAsRebase')});
  const openRow=contentEl.createDiv({cls:'html-atelier-form'});
  const openCheck=openRow.createEl('input',{attr:{type:'checkbox'}});
  openCheck.checked=this.settings().saveAs.openCopy;
  openRow.createEl('label',{text:this.t('saveAsOpen')});
  const summary=contentEl.createDiv({cls:'html-atelier-hint'});
  void summary;
  const buttons=contentEl.createDiv({cls:'html-atelier-btnrow'});
  const cancel=buttons.createEl('button',{attr:{'type':'button'},text:this.t('actionCancel')});
  cancel.addEventListener('click',()=>this.close());
  const save=buttons.createEl('button',{cls:'html-atelier-savebtn',attr:{'type':'button'},text:this.t('saveAsSave')});
  save.addEventListener('click',()=>{void (async()=>{
   const name=nameInput.value.trim().replace(/\.html?$/i,'');
   if(!name){new Notice(this.t('saveAsName'));return;}
   let dir=folderInput.value.trim().replace(/^\/+|\/+$/g,'');
   // planSaveAs 会因补丁校验失败抛错;异常若不在这里接住,会变成未处理的 Promise
   // 拒绝——弹窗不关也不报错,用户看到的是"点了没反应"(审计复检 §3.9/§3.15)。
   let plan:{content:string; rewritten:{from:string;to:string}[]; unresolved:string[]};
   try{
    plan=(await import('../services/saveService')).planSaveAs(this.draftSource,this.file.path,dir,rebaseCheck.checked);
   }catch(e){
    console.error(e);
    new Notice(this.t('noticeSaveAsFailed'),8000);
    return;
   }
   const target=this.service.uniquePath(dir,name);
   if(plan.unresolved.length)new Notice(this.t('saveAsUnresolved',{n:String(plan.unresolved.length)}),6000);
   const created=await this.service.save(plan.content,this.file.path,target);
   if(created){
    new Notice(`${this.t('noticeDraftExported',{path:created.path})}`);
    if(openCheck.checked)this.onSaved(created);
    this.close();
   }
  })();});
 }
}

export class ConflictModal extends Modal {
 private chunks:MergeChunk[]|null=null;
 private choices=new Map<number,string>(); // index → 'local'|'remote'|custom text
 private state:MergeSessionState|null=null;

 // commit:把合并结果真正落盘(调用方负责先备份草稿并写 vault),返回写盘结果;
 // adopt:采用磁盘版本(调用方负责清掉被放弃的草稿)。两者都由宿主提供,避免弹窗
 // 自己"宣布已保存"而磁盘没变(审计 round4 BUG 4)。
 constructor(private t:Translator,private file:TFile,private session:DocumentSession,
  private merge:MergeService,private onApplied:()=>void,
  private commit:()=>Promise<'written'|'conflict'|'missing'|'io-error'>,
  private adopt:()=>Promise<boolean>,app:App){super(app);}

 async onOpen(){
  const {contentEl}=this;
  contentEl.empty();
  contentEl.createEl('h3',{text:this.t('conflictTitle')});
  const remote=await this.merge.readDisk(this.file);
  if(remote===null){contentEl.setText(this.t('linkTargetMissing'));return;}
  this.state=this.merge.openState(this.session,remote);
  this.render(remote);
 }

 private render(remote:string){
  const {contentEl}=this;
  contentEl.empty();
  contentEl.createEl('h3',{text:this.t('conflictTitle')});
  const result=this.merge.merge(this.session.baseSource,this.session.workingSource,remote);
  this.chunks=result.chunks;
  const summary=contentEl.createDiv({cls:'html-atelier-hint'});
  summary.setText(`${this.t('conflictCount',{n:String(result.conflictCount)})} · ${this.t('conflictSummary',{n:String(result.chunks.length-result.conflictCount)})}`);
  if(this.merge.isExpired(this.session,this.state!)){
   const warn=contentEl.createDiv({cls:'html-atelier-warn',text:this.t('conflictExpired')});
   void warn;
   const re=contentEl.createEl('button',{attr:{type:'button'},text:this.t('conflictRecompare')});
   re.addEventListener('click',()=>void this.onOpen());
  }
  const list=contentEl.createDiv({cls:'html-atelier-mergechunks'});
  this.chunks.forEach((chunk,i)=>{
   if(chunk.type==='same')return;
   const box=list.createDiv({cls:`html-atelier-mergechunk html-atelier-merge-${chunk.type}`});
   if(chunk.type==='conflict'){
    const head=box.createDiv({cls:'html-atelier-btnrow'});
    const mine=head.createEl('button',{attr:{type:'button'},text:this.t('conflictKeepMine')});
    const disk=head.createEl('button',{attr:{type:'button'},text:this.t('conflictUseDisk')});
    const edit=head.createEl('button',{attr:{type:'button'},text:this.t('conflictEdit')});
    const ta=box.createEl('textarea',{cls:'html-atelier-textarea',attr:{rows:'3'}});
    // 默认必须是我的版本:此前未选过时三元落到 chunk.text,而 diff3 里 conflict 的
    // chunk.text 是**基准**原文,于是"点开就直接应用"会把两侧内容一起丢掉(审计 round4 BUG 7)
    let choice=this.choices.get(i);
    if(choice===undefined){choice='local';this.choices.set(i,choice);}
    ta.value=choice==='local'?chunk.localText??'':choice==='remote'?chunk.remoteText??'':choice;
    mine.addEventListener('click',()=>{this.choices.set(i,'local');ta.value=chunk.localText??'';});
    disk.addEventListener('click',()=>{this.choices.set(i,'remote');ta.value=chunk.remoteText??'';});
    edit.addEventListener('click',()=>{this.choices.set(i,ta.value);});
    ta.addEventListener('input',()=>this.choices.set(i,ta.value));
   }else{
    box.createDiv({cls:'html-atelier-diffline',text:chunk.text});
   }
  });
  const buttons=contentEl.createDiv({cls:'html-atelier-btnrow'});
  const apply=buttons.createEl('button',{cls:'html-atelier-savebtn',attr:{type:'button'},text:this.t('conflictApply')});
  apply.disabled=this.merge.isExpired(this.session,this.state!);
  apply.addEventListener('click',()=>{void (async()=>{
   const merged=this.chunks!.map((c,i)=>{
    if(c.type!=='conflict')return c.text;
    const choice=this.choices.get(i)??'local';
    return choice==='local'?c.localText??c.text:choice==='remote'?c.remoteText??c.text:choice;
   }).join('');
   const outcome=await this.merge.apply(this.file,this.session,this.state!,merged);
   if(outcome==='applied'){
    // 应用成功只是"进了会话内存"。必须真的写盘,并且如实报告结果;写盘前宿主会先落一份
    // 草稿,所以即使写盘失败/冲突,已解决的合并也不会丢(审计 round4 BUG 4 + BUG 5)。
    const written=await this.commit();
    this.onApplied();
    if(written==='written'){new Notice(this.t('noticeSaved'));this.close();}
    else if(written==='conflict')new Notice(this.t('noticeExternalConflict'),8000);
    else if(written==='missing')new Notice(this.t('noticeFileMissing'),8000);
    else new Notice(this.t('noticeMergeNotSaved'),8000);
   }
   else if(outcome==='busy')new Notice(this.t('noticeMergeBusy'),6000);
   else if(outcome==='expired')new Notice(this.t('conflictExpired'));
   else new Notice(this.t('linkTargetMissing'));
  })();});
  const adopt=buttons.createEl('button',{attr:{'type':'button'},text:this.t('conflictUseDiskVersion')});
  adopt.addEventListener('click',()=>{void (async()=>{
   // 宿主侧负责 try/catch 与清草稿;这里只据结果决定是否关闭,避免未捕获异常把弹窗卡住
   if(await this.adopt())this.close();
  })();});
  const cancel=buttons.createEl('button',{attr:{type:'button'},text:this.t('conflictCancel')});
  cancel.addEventListener('click',()=>this.close());
 }

 onClose(){this.contentEl.empty();}
}

export class DraftManagerModal extends Modal {
 private filter='';
 // settings 用于 drafts.storageWarningMiB:草稿总量超过阈值时在管理器顶部提示
 // (此前该设置无读取方 —— 审计 round4 缺陷 38)
 constructor(private t:Translator,private drafts:DraftsService,
  private onOpenFile:(path:string)=>void,app:App,
  private settings:()=>AtelierSettings=()=>DEFAULT_SETTINGS){super(app);}

 async onOpen(){
  const {contentEl}=this;
  contentEl.empty();
  contentEl.createEl('h3',{text:this.t('draftManagerTitle')});
  const search=contentEl.createEl('input',{cls:'html-atelier-input',attr:{type:'search',placeholder:''}});
  search.placeholder=this.t('draftManagerSearch');
  search.addEventListener('input',()=>{this.filter=search.value.toLowerCase();void this.render();});
  this.listEl=contentEl.createDiv({cls:'html-atelier-list'});
  const buttons=contentEl.createDiv({cls:'html-atelier-btnrow'});
  const discard=buttons.createEl('button',{attr:{type:'button'},text:this.t('draftManagerDiscard')});
  discard.addEventListener('click',()=>{void (async()=>{
   const selected=[...contentEl.querySelectorAll('.html-atelier-row input[type=checkbox]:checked')]
    .map(el=>(el.closest('.html-atelier-row') as HTMLElement).dataset.path!)
    .filter(Boolean);
   if(!selected.length)return;
   if(!window.confirm(this.t('draftManagerConfirmDiscard',{n:String(selected.length)})))return;
   const {ok}=await this.drafts.discardMany(selected);
   new Notice(`${ok.length}`);
   void this.render();
  })();});
  await this.render();
 }

 private listEl!:HTMLElement;

 private async render(){
  const {records}=await this.drafts.list();
  this.listEl.empty();
  const t=this.t;
  this.renderStorageWarning(records);
  const shown=records.filter(r=>r.filePath.toLowerCase().includes(this.filter));
  if(!shown.length){this.listEl.createDiv({cls:'html-atelier-panelnote',text:t('draftManagerEmpty')});return;}
  for(const {filePath,record} of shown){
   const exists=!!this.app.vault.getAbstractFileByPath(filePath);
   const diskSame=exists?await this.app.vault.cachedRead(this.app.vault.getAbstractFileByPath(filePath) as TFile).catch(()=>null):null;
   const conflict=diskSame!==null&&diskSame!==record.baseSource;
   const missing=!exists;
   const row=this.listEl.createDiv({cls:'html-atelier-row html-atelier-draftrow'});
   row.dataset.path=filePath;
   const check=row.createEl('input',{attr:{type:'checkbox','aria-label':filePath}});
   void check;
   row.createSpan({text:`${filePath} · ${record.workingSource.length}B`});
   row.createSpan({cls:'html-atelier-badge',
    text:missing?t('draftManagerStatusMissing'):conflict?t('draftManagerStatusConflict'):t('draftManagerStatusNormal')});
   const open=row.createEl('button',{attr:{type:'button'},text:t('draftManagerOpen')});
   open.disabled=missing;
   open.addEventListener('click',()=>{this.onOpenFile(filePath);this.close();});
  }
 }

 // 草稿总量提醒:只提示、不自动删(报告 §8.1)。按 UTF-8 字节统计,
 // 与草稿文件的实际占用一致(中文字符不是 1 字节)。
 private renderStorageWarning(records:{filePath:string;record:{baseSource:string;workingSource:string}}[]){
  const limit=this.settings().drafts.storageWarningMiB;
  if(!(limit>0))return;
  const bytes=records.reduce((n,r)=>n+utf8Bytes(r.record.baseSource)+utf8Bytes(r.record.workingSource),0);
  const total=bytes/1048576;
  if(total<=limit)return;
  this.listEl.createDiv({cls:'html-atelier-panelnote html-atelier-storagewarning',
   text:this.t('draftManagerStorageWarning',{total:total.toFixed(1),limit:String(limit)})});
 }

 onClose(){this.contentEl.empty();}
}

export class RelinkModal extends FuzzySuggestModal<TFile> {
 constructor(app:App,private onPick:(file:TFile)=>void){super(app);}
 // app 由基类持有
 getItems():TFile[]{
  return this.app.vault.getMarkdownFiles()
   .concat(this.app.vault.getFiles().filter(f=>['html','htm','md','pdf'].includes(f.extension.toLowerCase())))
   .filter((f,i,arr)=>arr.indexOf(f)===i);
 }
 getItemText(f:TFile){return f.path;}
 onChooseItem(f:TFile){this.onPick(f);}
}

export function filePickerModal(app:App,filter:(f:TFile)=>boolean,onPick:(path:string)=>void){
 const files=app.vault.getFiles().filter(filter);
 class Picker extends FuzzySuggestModal<TFile>{
  getItems(){return files;}
  getItemText(f:TFile){return f.path;}
  onChooseItem(f:TFile){onPick(f.path);}
 }
 new Picker(app).open();
}

export function pickFolderModal(app:App,onPick:(path:string)=>void){
 const folders=app.vault.getAllLoadedFiles().filter((f):f is TFolder=>f instanceof TFolder);
 class Picker extends FuzzySuggestModal<TFolder>{
  getItems(){return folders;}
  getItemText(f:TFolder){return f.path;}
  onChooseItem(f:TFolder){onPick(f.path);}
 }
 new Picker(app).open();
}

void setIcon;
