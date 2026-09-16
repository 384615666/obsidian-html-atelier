import {App, Plugin, PluginSettingTab, Setting} from 'obsidian';
import {AtelierSettings,DEFAULT_SETTINGS} from './schema';
import {settingsText,settingsTextEn,settingsOptions,settingsOptionsEn,RESTORE_GROUP_TEXT} from './settingsText';
import {resolveLocale} from '../i18n';

// 设置页(F18,§8.1):分组渲染,全部条目带双语名称与说明、恢复本组默认。
// 设置自动保存;修改不触发 HTML 保存。

export class AtelierSettingTab extends PluginSettingTab {
 constructor(app:App,plugin:Plugin,private get:()=>AtelierSettings,private set:(s:AtelierSettings)=>void){super(app,plugin);}

 display():void{
  const {containerEl}=this;
  containerEl.empty();
  const current=structuredCloneProxy(this.get());
  // 与 i18n.resolveLocale 同一套判定。此前这里自带一份 copy,末尾多了 `&& false`,
  // 于是 auto 恒判为中文——英文宿主上的默认设置页是中文(审计复检 §3.5)。
  const hostLang=(window as {moment?:{locale:()=>string}}).moment?.locale()??'zh';
  const useEn=resolveLocale(current.ui.language,hostLang)==='en';
  const text=(g:string,k:string)=>useEn?settingsTextEn(g,k):settingsText(g,k);
  const groups:[string,string[]][]=[
   ['sidebar',['autoShowHtml','closeOnLeave','markdownTarget','otherTarget','respectManualCollapse','defaultTab']],
   ['links',['externalTarget','internalTarget','respectBlankTarget','browserGesture','showHoverTarget','browserApplication','unsavedBrowserAction']],
   ['editor',['defaultMode','defaultTextMode','toolbarPlacement','historyLimit','mergeDelayMs','showChangeHighlights','restoreFocusAfterSave']],
   ['search',['includeHidden']],
   ['preview',['defaultWidth','defaultZoom','rememberViewport','rememberPosition','positionLimit','autoRefreshAssets','allowNetworkAssets']],
   ['drafts',['enabled','debounceMs','maxWaitMs','storageWarningMiB','closeBehavior']],
   ['saveAs',['rebaseRelativeUrls','openCopy']],
   ['embeds',['enabled','defaultHeight','autoHeightMax','showToolbar','showDrafts']],
   ['source',['lineNumbers','lineWrapping','previewDelayMs']],
   ['ui',['language']],
  ];
  const save=()=>this.set(current);
  for(const [group,keys] of groups){
   // 分组标题:此前 setName("") 传的是空串,整页只剩一个孤零零的"恢复本组默认"按钮,
   // 用户不知道自己在哪一组
   const head=new Setting(containerEl).setName(text(group,'')?.name??group).setHeading();
   const restore=containerEl.createEl('button',{cls:'html-atelier-restoregroup',attr:{type:'button'},text:useEn?RESTORE_GROUP_TEXT.en:RESTORE_GROUP_TEXT.zh});
   restore.addEventListener('click',()=>{
    (current as unknown as Record<string,unknown>)[group]=structuredClone((DEFAULT_SETTINGS as unknown as Record<string,unknown>)[group]);
    save();
    this.display();
   });
   void head;
   for(const key of keys){
    const text2=text(group,key)??{name:key,desc:''};
    const path=`${group}.${key}`;
    const setting=new Setting(containerEl).setName(text2.name).setDesc(text2.desc);
    const value=()=>getByPath(current,path);
    const write=(v:unknown)=>{setByPath(current,path,v);save();};
    const def=getByPath(DEFAULT_SETTINGS,path);
    // 需要自由文本的键:浏览器程序路径,以及可写 "auto" 或像素数的宽度/高度
    const freeText=(group==='links'&&key==='browserApplication')
     ||(group==='preview'&&key==='defaultWidth');
    if(typeof def==='boolean'){
     setting.addToggle(t=>t.setValue(!!value()).onChange(v=>write(v)));
    }else if(typeof def==='number'){
     // 清空输入框时 Number('')===0 且 isFinite(0) 为真,会写进 0;空串必须忽略
     // (审计复检 §3.23 M1)。
     setting.addText(tx=>{tx.setValue(String(value())).onChange(v=>{const raw=v.trim();if(raw==='')return;const n=Number(raw);if(Number.isFinite(n))write(n);});});
    }else if(freeText){
     setting.addText(tx=>{tx.setValue(String(value())).onChange(v=>write(v));});
    }else{
     // 枚举:选项与显示名都取自 settingsText 的同一张表 —— 存的是标识符,显示的是
     // 本地化文字。此前直接把标识符当标签,中文界面里看到的是 outline/previous/none
     // (用户反馈 2026-09-15)。ui.language 也在此列(它此前被 `def==='auto'` 命中而
     // 退化成自由文本框,用户得手工输入 "zh-CN")。
     const optionLabels=(useEn?settingsOptionsEn:settingsOptions)(group,key)??{};
     const options=Object.keys(optionLabels);
     setting.addDropdown(d=>{
      for(const opt of options)d.addOption(opt,optionLabels[opt]);
      if(!options.length)d.addOption(String(def),String(def)); // 未登记标签的枚举:退化为标识符
      d.setValue(String(value())).onChange(v=>write(v));
     });
    }
   }
  }
 }
}

function structuredCloneProxy<T>(v:T):T{return JSON.parse(JSON.stringify(v)) as T;}

function getByPath(obj:unknown,path:string):unknown{
 const [g,k]=path.split('.');
 const group=(obj as Record<string,Record<string,unknown>>)[g];
 return group?.[k];
}

function setByPath(obj:unknown,path:string,value:unknown){
 const [g,k]=path.split('.');
 const group=(obj as Record<string,Record<string,unknown>>)[g];
 if(group)group[k]=value;
}
