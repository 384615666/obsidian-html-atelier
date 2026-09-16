import {App, Notice, TFile, WorkspaceLeaf} from 'obsidian';
import {debugLog} from '../services/debug';
import type {AtelierSettings} from '../settings/schema';
import type {Translator} from '../i18n';

// 侧栏协调(F01,行为以 D0-02/03 实测为准):
// - 打开 HTML → ensureSideLeaf 创建/复用本插件 HTML 面板叶子(reveal 尊重手动收起抑制);
// - 切到 Markdown → 关闭本插件管理的叶子,按设置选择原生大纲/旧面板/不动作;
// - 切到其他文件 → 恢复进入 HTML 前的旧叶子或保持折叠;
// - 只管理本插件拥有的叶子,不触碰大纲/反链等宿主叶子;
// - 手动收起按窗口记忆,普通自动行为不解除,显式"显示 HTML 侧栏"命令解除。

const HTML_PANEL_TYPE='html-atelier-panel';

interface WindowSuppression {collapsed:boolean}

export class SidebarCoordinator {
 private suppressByWindow=new WeakMap<Window,WindowSuppression>();
 private lastNonHtmlLeaf:{type:string; leaf:WorkspaceLeaf}|null=null;
 private oneTimeNoticeShown=false;

 constructor(private app:App,private settings:()=>AtelierSettings,private t:Translator){}

 // 多窗口细化:关键路径由调用方传入窗口;此处默认主窗口
 private win():Window{return window;}

 isSuppressed(w:Window=window):boolean {
  return this.settings().sidebar.respectManualCollapse&&this.suppressByWindow.get(w)?.collapsed===true;
 }

 // 手动收起的第二条判定路径(A02 实测):layout-change 在宿主里的触发时机不保证,
 // 且程序性 collapse() 与用户点击同样只改 rightSplit.collapsed。本插件从不变更
 // 折叠状态(自动路径只 reveal),因此"面板叶子已存在 + 右栏处于折叠"只可能是
 // 用户收起的。existedBefore 由 showPanel 在创建叶子之前捕获,避免把自己的
 // 首次创建误判成手动收起。
 isManuallyCollapsed(existedBefore:boolean,w:Window=window):boolean {
  return this.settings().sidebar.respectManualCollapse&&existedBefore&&this.rightCollapsed();
 }

 debugState():Record<string,unknown>{
  return {collapsed:this.rightCollapsed(),suppressed:this.isSuppressed(),
   suppressedDerived:this.isManuallyCollapsed(this.panelLeaves().length>0),
   suppressions:'weakmap',panelLeaves:this.panelLeaves().length};
 }

 clearSuppression(w:Window=window){this.suppressByWindow.delete(w);}

 // 宿主右侧栏折叠状态(D0-03:rightSplit 可读)
 rightCollapsed():boolean {
  const rs=(this.app.workspace as unknown as {rightSplit?:{collapsed?:boolean}}).rightSplit;
  return rs?.collapsed===true;
 }

 // 观察手动收起:在折叠事件上记录抑制(workspace layout-change 里检测折叠沿)。
 // 反方向同样要处理:用户**自己重新展开**右栏就是"我想要侧栏"的信号,手动收起记忆
 // 必须到此为止。此前抑制会跨整个窗口会话存活——用户收起过一次之后,即使自己把
 // 侧栏重新打开,回到 HTML 文件面板也永不自动出现,看起来就是功能坏了(用户实测 2026-09-14)。
 observe(){
  this.app.workspace.on('layout-change',()=>{
   const rs=(this.app.workspace as unknown as {rightSplit?:{collapsed?:boolean,onFold?:unknown}}).rightSplit;
   if(!rs)return;
   const w=this.win();
   if(rs.collapsed){
    // 记录抑制,但由本插件程序性折叠引起时不抑制——通过是否存在面板叶子区分:
    // 仅当用户折叠时面板仍存在才视为手动收起
    const hasPanel=this.app.workspace.getLeavesOfType(HTML_PANEL_TYPE).length>0;
    if(hasPanel)this.suppressByWindow.set(w,{collapsed:true});
   }else if(this.suppressByWindow.get(w)){
    // 本插件从不变更折叠状态(自动路径只 reveal),所以"展开"只能是用户动作,
    // 或我们未被抑制时的 reveal——两种情况都应当解除记忆
    this.clearSuppression(w);
   }
  });
 }

 panelLeaves():WorkspaceLeaf[]{return this.app.workspace.getLeavesOfType(HTML_PANEL_TYPE);}

 // 显示 HTML 面板。explicit=命令/用户动作(清除手动收起抑制);
 // 自动路径(autoShowHtml)不清除抑制(报告 §5.1)。
 async showPanel(refresh:(leaf:WorkspaceLeaf)=>void,explicit=false):Promise<void>{
  // 叶子创建之前先判定折叠状态,否则新建叶子后无法区分"用户收起"与"刚建好"
  const existedBefore=this.panelLeaves().length>0;
  const collapsedBefore=this.rightCollapsed();
  const explicitRequest=explicit;
  const suppressed=explicitRequest?false:(this.isSuppressed()||this.isManuallyCollapsed(existedBefore));
  if(explicitRequest)this.clearSuppression();
  const leaf=await this.ensurePanelLeaf();
  if(!leaf)return;
  refresh(leaf);
  const w=explicitRequest?null:this.win();
  if(!explicitRequest&&w&&existedBefore&&collapsedBefore)this.suppressByWindow.set(w,{collapsed:true});
  debugLog(`showPanel explicit=${explicitRequest} suppressed=${suppressed} existed=${existedBefore} collapsed=${collapsedBefore}`);
  if(suppressed)return; // 抑制中:叶子就绪但不展开(报告 §5.1)
  await this.app.workspace.revealLeaf(leaf);
 }

 // D0-02:ensureSideLeaf 创建/复用,reveal=false 不强制展开
 async ensurePanelLeaf():Promise<WorkspaceLeaf|null>{
  const ws=this.app.workspace as unknown as {
   ensureSideLeaf?:(type:string,side:'right',opts?:{reveal?:boolean;active?:boolean})=>Promise<WorkspaceLeaf>;
   getRightLeaf:(split:boolean)=>WorkspaceLeaf|null;
  };
  const existing=this.panelLeaves()[0];
  if(existing)return existing;
  if(typeof ws.ensureSideLeaf==='function'){
   try{
    return await ws.ensureSideLeaf(HTML_PANEL_TYPE,'right',{reveal:false,active:false});
   }catch{/* 落到兼容路径 */}
  }
  const right=ws.getRightLeaf(false);
  if(!right)return null;
  await right.setViewState({type:HTML_PANEL_TYPE,active:false});
  return right;
 }

 // 离开 HTML 时关闭本插件叶子并按设置恢复目标
 async closeOnLeave(activeFile:TFile|null){
  const st=this.settings().sidebar;
  if(!st.closeOnLeave)return;
  const w=this.win();
  for(const leaf of this.panelLeaves())leaf.detach();
  // 恢复目标:Markdown → 大纲;其他 → 旧面板
  const isMd=activeFile&&activeFile.extension==='md';
  const target=isMd?st.markdownTarget:st.otherTarget;
  if(target==='none')return;
  if(this.isSuppressed(w))return; // 手动收起:只准备,不展开
  if(target==='outline'){
   const outlineEnabled=(this.app as unknown as {internalPlugins?:{getPluginById:(id:string)=>{enabled?:boolean}|null}}).internalPlugins?.getPluginById('outline')?.enabled;
   if(!outlineEnabled){
    if(!this.oneTimeNoticeShown){this.oneTimeNoticeShown=true;new Notice(this.t('noticeOutlineDisabled'));}
    return;
   }
   const ws=this.app.workspace as unknown as {ensureSideLeaf?:(type:string,side:'right',opts?:{reveal?:boolean})=>Promise<WorkspaceLeaf>};
   try{
    if(typeof ws.ensureSideLeaf==='function')await ws.ensureSideLeaf('outline','right',{reveal:true});
    else{
     const leaf=this.app.workspace.getRightLeaf(false);
     if(leaf){await leaf.setViewState({type:'outline',active:false});await this.app.workspace.revealLeaf(leaf);}
    }
   }catch{/* 大纲叶子创建失败保持安静,已有一次性提示路径 */}
  }else if(target==='previous'){
   // 'previous':重新展示进入 HTML 前那个侧栏叶子。不凭空创建新叶子——只唤醒仍然
   // 存在的旧叶子,否则会产生一个用户没打开过的视图(审计复检 §3.21:此前该分支
   // 只有注释,lastNonHtmlLeaf 从未赋值,导致 previous 与 none 行为完全相同)。
   const prev=this.lastNonHtmlLeaf;
   if(!prev)return;
   const alive=this.app.workspace.getLeavesOfType(prev.type).find(l=>(l as unknown as {window?:Window}).window===w||true);
   if(!alive)return;
   try{await this.app.workspace.revealLeaf(alive);}catch{/* 叶子已不可见时保持安静 */}
  }
 }

 // 记录"进入 HTML 之前的侧栏叶子":由 main.ts 在 active-leaf-change 上喂入。
 notePreviousLeaf(leaf:WorkspaceLeaf):void {
  const type=leaf.view?.getViewType?.();
  if(!type||type===HTML_PANEL_TYPE)return;
  this.lastNonHtmlLeaf={type,leaf};
 }

 // 一键关闭全部侧栏自动行为(报告 §5.1):只改设置,不动叶子
 disableAllActions():Partial<AtelierSettings>{
  return {
   sidebar:{...this.settings().sidebar,autoShowHtml:false,closeOnLeave:false,markdownTarget:'none',otherTarget:'none'},
  };
 }
}
