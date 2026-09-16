// 设置 schema（报告 §8.1）：默认值、取值边界与校验全部集中在此。
// 校验失败回退默认值并记录警告，未知字段隔离保留（不导致加载失败）。
export interface SidebarSettings {
 autoShowHtml:boolean;
 closeOnLeave:boolean;
 markdownTarget:'outline'|'previous'|'none';
 otherTarget:'previous'|'none';
 respectManualCollapse:boolean;
 defaultTab:'edit'|'outline'|'changes'|'resources';
}
export interface LinksSettings {
 externalTarget:'browser'|'web-viewer';
 internalTarget:'current'|'new-tab';
 respectBlankTarget:boolean;
 browserGesture:'Mod'|'Alt'|'Mod+Shift'|'off';
 showHoverTarget:boolean;
 browserApplication:'auto'|(string&{});
 unsavedBrowserAction:'ask'|'saved';
}
export interface EditorSettings {
 defaultMode:'preview'|'edit'|'source'|'split';
 defaultTextMode:'segment'|'paragraph';
 historyLimit:number;
 mergeDelayMs:number;
 showChangeHighlights:boolean;
 restoreFocusAfterSave:boolean;
 // 工具栏(后退/前进/模式/刷新/宽度/缩放/更多)承载在哪:'sidebar' 放在 HTML
 // 侧栏面板顶部,主视图只剩页面内容;'view' 沿用文件视图顶部那条。
 toolbarPlacement:'sidebar'|'view';
}
export interface SearchSettings {includeHidden:boolean}
export interface PreviewSettings {
 defaultWidth:number|'auto';
 defaultZoom:number;
 rememberViewport:boolean;
 rememberPosition:boolean;
 positionLimit:number;
 autoRefreshAssets:boolean;
 allowNetworkAssets:boolean;
}
export interface DraftsSettings {
 enabled:boolean;
 debounceMs:number;
 maxWaitMs:number;
 storageWarningMiB:number;
 closeBehavior:'keep'|'ask';
}
export interface SaveAsSettings {rebaseRelativeUrls:boolean; openCopy:boolean}
export interface EmbedsSettings {
 enabled:boolean;
 defaultHeight:number;
 autoHeightMax:number;
 showToolbar:boolean;
 showDrafts:boolean;
}
export interface SourceSettings {lineNumbers:boolean; lineWrapping:boolean; previewDelayMs:number}
export interface UiSettings {language:'auto'|'zh-CN'|'en'}

export interface AtelierSettings {
 sidebar:SidebarSettings;
 links:LinksSettings;
 editor:EditorSettings;
 search:SearchSettings;
 preview:PreviewSettings;
 drafts:DraftsSettings;
 saveAs:SaveAsSettings;
 embeds:EmbedsSettings;
 source:SourceSettings;
 ui:UiSettings;
}

export const DEFAULT_SETTINGS:AtelierSettings={
 sidebar:{autoShowHtml:true,closeOnLeave:true,markdownTarget:'outline',otherTarget:'previous',respectManualCollapse:true,defaultTab:'edit'},
 links:{externalTarget:'browser',internalTarget:'current',respectBlankTarget:true,browserGesture:'Mod',showHoverTarget:true,browserApplication:'auto',unsavedBrowserAction:'ask'},
 editor:{defaultMode:'preview',defaultTextMode:'segment',historyLimit:200,mergeDelayMs:800,showChangeHighlights:true,restoreFocusAfterSave:true,toolbarPlacement:'sidebar'},
 search:{includeHidden:false},
 preview:{defaultWidth:'auto',defaultZoom:100,rememberViewport:true,rememberPosition:true,positionLimit:200,autoRefreshAssets:true,allowNetworkAssets:true},
 drafts:{enabled:true,debounceMs:750,maxWaitMs:3000,storageWarningMiB:50,closeBehavior:'keep'},
 saveAs:{rebaseRelativeUrls:true,openCopy:true},
 embeds:{enabled:true,defaultHeight:480,autoHeightMax:1200,showToolbar:true,showDrafts:false},
 source:{lineNumbers:true,lineWrapping:true,previewDelayMs:400},
 ui:{language:'auto'},
};

// 枚举设置的**允许值**集中在这里:normalize 校验与设置页下拉都读它,
// 避免"schema 收的值"和"界面给的值"两套清单各自漂移。
// as const 保留字面量类型,enumer 的 T 才能推成联合类型而不是 string。
export const ENUM_VALUES={
 'sidebar.markdownTarget':['outline','previous','none'],
 'sidebar.otherTarget':['previous','none'],
 'sidebar.defaultTab':['edit','outline','changes','resources'],
 'links.externalTarget':['browser','web-viewer'],
 'links.internalTarget':['current','new-tab'],
 'links.browserGesture':['Mod','Alt','Mod+Shift','off'],
 'links.unsavedBrowserAction':['ask','saved'],
 'editor.defaultMode':['preview','edit','source','split'],
 'editor.defaultTextMode':['segment','paragraph'],
 'editor.toolbarPlacement':['sidebar','view'],
 'drafts.closeBehavior':['keep','ask'],
 'ui.language':['auto','zh-CN','en'],
} as const;

export const HISTORY_LIMITS_BOUNDS={historyLimit:[50,1000] as const,mergeDelayMs:[300,2000] as const};
const DRAFTS_BOUNDS={debounceMs:[250,5000] as const,maxWaitMs:[250,10000] as const,storageWarningMiB:[10,500] as const};
const PREVIEW_BOUNDS={positionLimit:[20,2000] as const};
const EMBEDS_BOUNDS={defaultHeight:[160,1600] as const,autoHeightMax:[100,10000] as const};
const SOURCE_BOUNDS={previewDelayMs:[150,2000] as const};

export interface ParsedSettings {settings:AtelierSettings; warnings:string[]; retainedUnknown:Record<string,unknown>}

type Unknown=Record<string,unknown>;
const isObj=(v:unknown):v is Unknown=>typeof v==='object'&&v!==null&&!Array.isArray(v);

function bool(input:Unknown,key:string,fallback:boolean,warnings:string[]):boolean {
 const v=input[key];
 if(typeof v==='boolean')return v;
 if(v!==undefined)warnings.push(`${key}: 非布尔值，已回退默认 ${fallback}`);
 return fallback;
}
function num(input:Unknown,key:string,fallback:number,min:number,max:number,warnings:string[],int=true):number {
 const v=input[key];
 if(typeof v==='number'&&Number.isFinite(v)){
  let out=v;
  if(int)out=Math.round(out);
  if(out<min||out>max){out=Math.min(max,Math.max(min,out));warnings.push(`${key}: ${v} 超出 [${min},${max}]，已收敛为 ${out}`);}
  return out;
 }
 if(v!==undefined)warnings.push(`${key}: 非数字，已回退默认 ${fallback}`);
 return fallback;
}
function enumer<T extends string>(input:Unknown,key:string,allowed:readonly T[],fallback:T,warnings:string[]):T {
 const v=input[key];
 if(typeof v==='string'&&(allowed as readonly string[]).includes(v))return v as T;
 if(v!==undefined){
  const shown=typeof v==='string'||typeof v==='number'||typeof v==='boolean'?String(v):'复杂值';
  warnings.push(`${key}: "${shown}" 不在 [${allowed.join('/')}]，已回退 ${fallback}`);
 }
 return fallback;
}
function widthHeight(input:Unknown,key:string,fallback:number|'auto',min:number,max:number,warnings:string[]):number|'auto' {
 const v=input[key];
 if(v==='auto')return 'auto';
 if(typeof v==='number'&&Number.isFinite(v)){
  const out=Math.round(Math.min(max,Math.max(min,v)));
  if(out!==v)warnings.push(`${key}: ${v} 超出 [${min},${max}]，已收敛为 ${out}`);
  return out;
 }
 if(v!==undefined)warnings.push(`${key}: 非法视口值，已回退默认`);
 return fallback;
}

const UNSAFE_KEYS=new Set(['__proto__','constructor','prototype']);

export function normalizeSettings(input:unknown):ParsedSettings {
 const warnings:string[]=[];
 const retainedUnknown:Record<string,unknown>={};
 const src=isObj(input)?input:{};
 // 只保留自有字段(prototype 链上的 toString/constructor 等不算已知也不保留,audit st2 T1);
 // 不安全键(如 __proto__)跳过且告警,绝不写入返回对象。
 for(const k of Object.keys(src)){
  if(UNSAFE_KEYS.has(k)){warnings.push(`${k}: 不安全的未知字段名,已忽略`);continue;}
  if(!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS,k))retainedUnknown[k]=src[k];
 }

 const sidebar=isObj(src.sidebar)?src.sidebar:{};
 const links=isObj(src.links)?src.links:{};
 const editor=isObj(src.editor)?src.editor:{};
 const search=isObj(src.search)?src.search:{};
 const preview=isObj(src.preview)?src.preview:{};
 const draftsIn=isObj(src.drafts)?src.drafts:{};
 const saveAs=isObj(src.saveAs)?src.saveAs:{};
 const embeds=isObj(src.embeds)?src.embeds:{};
 const source=isObj(src.source)?src.source:{};
 const ui=isObj(src.ui)?src.ui:{};
 for(const [g,obj] of Object.entries({sidebar,links,editor,search,preview,drafts:draftsIn,saveAs,embeds,source,ui}))
  for(const k of Object.keys(obj)){
   const key=`${g}.${k}`;
   // 组内未知键只认自有属性(prototype 链不算,audit st2 T1);不安全键拒绝;
   // 与顶层点键冲突时保留首个值并告警,不静默覆盖(audit st1 S6)
   if(UNSAFE_KEYS.has(k)){warnings.push(`${key}: 不安全的未知字段名,已忽略`);continue;}
   if(Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS[g as keyof AtelierSettings],k))continue;
   if(key in retainedUnknown){warnings.push(`${key}: 未知字段键冲突,保留首个值`);continue;}
   retainedUnknown[key]=(obj)[k];
  }

 let debounceMs=num(draftsIn,'debounceMs',DEFAULT_SETTINGS.drafts.debounceMs,DRAFTS_BOUNDS.debounceMs[0],DRAFTS_BOUNDS.debounceMs[1],warnings);
 let maxWaitMs=num(draftsIn,'maxWaitMs',DEFAULT_SETTINGS.drafts.maxWaitMs,DRAFTS_BOUNDS.maxWaitMs[0],DRAFTS_BOUNDS.maxWaitMs[1],warnings);
 // maxWait 不小于 debounce（报告 §8.1）
 if(maxWaitMs<debounceMs){maxWaitMs=debounceMs;warnings.push(`drafts.maxWaitMs: 不小于 debounceMs，已调整为 ${maxWaitMs}`);}
 // drafts.enabled=false 时强制 ask（报告 §8.1）
 const draftsEnabled=bool(draftsIn,'enabled',true,warnings);
 let closeBehavior=enumer(draftsIn,'closeBehavior',ENUM_VALUES['drafts.closeBehavior'],DEFAULT_SETTINGS.drafts.closeBehavior,warnings);
 if(!draftsEnabled&&closeBehavior==='keep'){closeBehavior='ask';warnings.push('drafts.closeBehavior: 备份关闭时强制为 ask');}

 return {
  warnings,
  retainedUnknown,
  settings:{
   sidebar:{
    autoShowHtml:bool(sidebar,'autoShowHtml',true,warnings),
    closeOnLeave:bool(sidebar,'closeOnLeave',true,warnings),
    markdownTarget:enumer(sidebar,'markdownTarget',ENUM_VALUES['sidebar.markdownTarget'],'outline',warnings),
    otherTarget:enumer(sidebar,'otherTarget',ENUM_VALUES['sidebar.otherTarget'],'previous',warnings),
    respectManualCollapse:bool(sidebar,'respectManualCollapse',true,warnings),
    defaultTab:enumer(sidebar,'defaultTab',ENUM_VALUES['sidebar.defaultTab'],'edit',warnings),
   },
   links:{
    externalTarget:enumer(links,'externalTarget',ENUM_VALUES['links.externalTarget'],'browser',warnings),
    internalTarget:enumer(links,'internalTarget',ENUM_VALUES['links.internalTarget'],'current',warnings),
    respectBlankTarget:bool(links,'respectBlankTarget',true,warnings),
    browserGesture:enumer(links,'browserGesture',ENUM_VALUES['links.browserGesture'],'Mod',warnings),
    showHoverTarget:bool(links,'showHoverTarget',true,warnings),
    browserApplication:(()=>{const v=links.browserApplication;
     if(typeof v==='string'&&v)return v;
     if(v!==undefined)warnings.push('links.browserApplication: 非法值,已回退 auto');
     return 'auto';})(),
    unsavedBrowserAction:enumer(links,'unsavedBrowserAction',ENUM_VALUES['links.unsavedBrowserAction'],'ask',warnings),
   },
   editor:{
    defaultMode:enumer(editor,'defaultMode',ENUM_VALUES['editor.defaultMode'],'preview',warnings),
    defaultTextMode:enumer(editor,'defaultTextMode',ENUM_VALUES['editor.defaultTextMode'],'segment',warnings),
    historyLimit:num(editor,'historyLimit',200,HISTORY_LIMITS_BOUNDS.historyLimit[0],HISTORY_LIMITS_BOUNDS.historyLimit[1],warnings),
    mergeDelayMs:num(editor,'mergeDelayMs',800,HISTORY_LIMITS_BOUNDS.mergeDelayMs[0],HISTORY_LIMITS_BOUNDS.mergeDelayMs[1],warnings),
    showChangeHighlights:bool(editor,'showChangeHighlights',true,warnings),
    restoreFocusAfterSave:bool(editor,'restoreFocusAfterSave',true,warnings),
    toolbarPlacement:enumer(editor,'toolbarPlacement',ENUM_VALUES['editor.toolbarPlacement'],'sidebar',warnings),
   },
   search:{includeHidden:bool(search,'includeHidden',false,warnings)},
   preview:{
    defaultWidth:widthHeight(preview,'defaultWidth','auto',240,3840,warnings),
    defaultZoom:num(preview,'defaultZoom',100,25,200,warnings),
    rememberViewport:bool(preview,'rememberViewport',true,warnings),
    rememberPosition:bool(preview,'rememberPosition',true,warnings),
    positionLimit:num(preview,'positionLimit',200,PREVIEW_BOUNDS.positionLimit[0],PREVIEW_BOUNDS.positionLimit[1],warnings),
    autoRefreshAssets:bool(preview,'autoRefreshAssets',true,warnings),
    allowNetworkAssets:bool(preview,'allowNetworkAssets',true,warnings),
   },
   drafts:{
    enabled:draftsEnabled,
    debounceMs,
    maxWaitMs,
    storageWarningMiB:num(draftsIn,'storageWarningMiB',50,DRAFTS_BOUNDS.storageWarningMiB[0],DRAFTS_BOUNDS.storageWarningMiB[1],warnings),
    closeBehavior,
   },
   saveAs:{
    rebaseRelativeUrls:bool(saveAs,'rebaseRelativeUrls',true,warnings),
    openCopy:bool(saveAs,'openCopy',true,warnings),
   },
   embeds:{
    enabled:bool(embeds,'enabled',true,warnings),
    defaultHeight:num(embeds,'defaultHeight',480,EMBEDS_BOUNDS.defaultHeight[0],EMBEDS_BOUNDS.defaultHeight[1],warnings),
    autoHeightMax:num(embeds,'autoHeightMax',1200,EMBEDS_BOUNDS.autoHeightMax[0],EMBEDS_BOUNDS.autoHeightMax[1],warnings),
    showToolbar:bool(embeds,'showToolbar',true,warnings),
    showDrafts:bool(embeds,'showDrafts',false,warnings),
   },
   source:{
    lineNumbers:bool(source,'lineNumbers',true,warnings),
    lineWrapping:bool(source,'lineWrapping',true,warnings),
    previewDelayMs:num(source,'previewDelayMs',400,SOURCE_BOUNDS.previewDelayMs[0],SOURCE_BOUNDS.previewDelayMs[1],warnings),
   },
   ui:{language:enumer(ui,'language',ENUM_VALUES['ui.language'],'auto',warnings)},
  },
 };
}

// 将 normalizeSettings 返回的 retainedUnknown(顶层键或 `组.键` 点键)合并回持久化对象,
// 供宿主保存 data.json 时使用(audit st2 T2)。点键重建为嵌套对象;不安全键拒绝。
export function applyRetainedUnknown(target:Record<string,unknown>,retained:Record<string,unknown>):void {
 for(const [key,value] of Object.entries(retained)){
  if(UNSAFE_KEYS.has(key)||key.split('.').some(part=>UNSAFE_KEYS.has(part)))continue;
  const dot=key.indexOf('.');
  if(dot<0){target[key]=value;continue;}
  const group=key.slice(0,dot);
  const rest=key.slice(dot+1);
  if(!isObj(target[group]))target[group]={};
  applyRetainedUnknown(target[group] as Record<string,unknown>,{[rest]:value});
 }
}
