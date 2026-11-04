import {App, Plugin, PluginSettingTab, Setting, setIcon} from 'obsidian';
import {AtelierSettings,DEFAULT_SETTINGS} from './schema';
import {settingsText,settingsTextEn,settingsOptions,settingsOptionsEn,settingsPageText,settingsUnitText,RESTORE_GROUP_TEXT} from './settingsText';
import {resolveLocale} from '../i18n';

// 设置页(F18,§8.1):分组渲染,全部条目带双语名称与说明、恢复本组默认。
// 设置自动保存;修改不触发 HTML 保存。
//
// 视觉结构(2026-11 改版):
//   .html-atelier-settings            页面根(宿主给的是 vertical-tab-content)
//   ├─ .html-atelier-settings-hero    插件名 + 版本 + 一句说明
//   └─ .html-atelier-settings-group ×N
//      ├─ .html-atelier-settings-grouphead  分组图标 + 标题 + 「恢复本组默认」
//      └─ .setting-item ×M                  原生设置行(中英文名/说明 + 控件)
// 分组标题仍是原生 Setting.setHeading()(自动化探针按 .setting-item-heading 取标题),
// 「恢复本组默认」保持在标题**外面**的同一行,不再像旧版那样单独占一行大按钮。

// 分组图标只用手边版本就有的 lucide 名(1.7 起就有),避免老宿主上出现空图标。
const GROUP_ICONS:Record<string,string>={
 sidebar:'panel-right',links:'link',editor:'pencil',search:'search',preview:'eye',
 drafts:'save',saveAs:'copy',embeds:'code',source:'file-code',ui:'languages',
};

// 数值设置的单位只影响显示,不改存储。键与下面 number 分支一一对应。
const UNIT_KEYS:Record<string,string>={
 'editor.historyLimit':'entries',
 'editor.mergeDelayMs':'ms',
 'preview.defaultZoom':'pct',
 'preview.positionLimit':'files',
 'drafts.debounceMs':'ms',
 'drafts.maxWaitMs':'ms',
 'drafts.storageWarningMiB':'mib',
 'embeds.defaultHeight':'px',
 'embeds.autoHeightMax':'px',
 'source.previewDelayMs':'ms',
};

export class AtelierSettingTab extends PluginSettingTab {
 // PluginSettingTab 的类型里没有公开 plugin 字段,但运行时一定有;页眉要用 manifest.version。
 private readonly pluginVersion?:string;
 constructor(app:App,plugin:Plugin,private get:()=>AtelierSettings,private set:(s:AtelierSettings)=>void){
  super(app,plugin);
  this.pluginVersion=(plugin as Plugin&{manifest?:{version?:string}}).manifest?.version;
 }

 display():void{
  const {containerEl}=this;
  containerEl.empty();
  containerEl.addClass('html-atelier-settings');
  // Obsidian 1.14 起设置项是整张卡片(--setting-items-* 变量存在),卡片自带 16px 内边距;
  // 旧宿主是分隔行。分组头与「恢复本组默认」的右侧留白要跟卡片内边距对齐,
  // 用宿主变量做特性探测,不依赖版本号。
  const cardLayout=!!getComputedStyle(containerEl).getPropertyValue('--setting-items-radius').trim();
  containerEl.toggleClass('html-atelier-settings--cards',cardLayout);
  const current=structuredCloneProxy(this.get());
  // 与 i18n.resolveLocale 同一套判定。此前这里自带一份 copy,末尾多了 `&& false`,
  // 于是 auto 恒判为中文——英文宿主上的默认设置页是中文(审计复检 §3.5)。
  const hostLang=(window as {moment?:{locale:()=>string}}).moment?.locale()??'zh';
  const useEn=resolveLocale(current.ui.language,hostLang)==='en';
  const text=(g:string,k:string)=>useEn?settingsTextEn(g,k):settingsText(g,k);
  const pageText=settingsPageText(useEn);
  const restoreText=useEn?RESTORE_GROUP_TEXT.en:RESTORE_GROUP_TEXT.zh;

  // 页首:插件名/版本/一句话说明。宿主设置页没有插件名标题,这里补一个轻量页眉。
  const hero=containerEl.createDiv({cls:'html-atelier-settings-hero'});
  const heroIcon=hero.createDiv({cls:'html-atelier-settings-heroicon',attr:{'aria-hidden':'true'}});
  setIcon(heroIcon,'file-code');
  const heroText=hero.createDiv({cls:'html-atelier-settings-herotext'});
  // 用 div + role=heading:设置页里手工写 <h2> 会触发 Obsidian 的
  // no-manual-html-headings 规则(分组标题必须走 Setting.setHeading())。
  const heroName=heroText.createDiv({cls:'html-atelier-settings-heroname',attr:{role:'heading','aria-level':'2'}});
  heroName.createSpan({cls:'html-atelier-settings-heroname-text',text:'HTML Atelier'});
  if(this.pluginVersion)heroName.createSpan({cls:'html-atelier-settings-version',text:this.pluginVersion});
  heroText.createDiv({cls:'html-atelier-settings-herodesc',text:pageText.tagline});

  const groups:[string,string[]][]=[
   ['sidebar',['autoShowHtml','closeOnLeave','markdownTarget','otherTarget','respectManualCollapse','defaultTab']],
   ['links',['externalTarget','internalTarget','respectBlankTarget','browserGesture','showHoverTarget','browserApplication','unsavedBrowserAction']],
   ['editor',['defaultMode','defaultTextMode','toolbarPlacement','historyLimit','mergeDelayMs','showChangeHighlights','restoreFocusAfterSave']],
   ['search',['includeHidden']],
   ['preview',['defaultWidth','defaultZoom','rememberViewport','rememberPosition','positionLimit','autoRefreshAssets','allowNetworkAssets','allowScripts']],
   ['drafts',['enabled','debounceMs','maxWaitMs','storageWarningMiB','closeBehavior']],
   ['saveAs',['rebaseRelativeUrls','openCopy']],
   ['embeds',['enabled','defaultHeight','autoHeightMax','showToolbar','showDrafts']],
   ['source',['lineNumbers','lineWrapping','previewDelayMs']],
   ['ui',['language']],
  ];
  const save=()=>this.set(current);
  for(const [group,keys] of groups){
   const section=containerEl.createDiv({cls:'html-atelier-settings-group'});
   const headRow=section.createDiv({cls:'html-atelier-settings-grouphead'});
   // 分组图标放在原生标题行**外面**,标题元素的文本保持纯分组名(探针按文本匹配)。
   const groupIcon=headRow.createSpan({cls:'html-atelier-settings-groupicon',attr:{'aria-hidden':'true'}});
   setIcon(groupIcon,GROUP_ICONS[group]??'settings-2');
   // 分组标题:此前 setName("") 传的是空串,整页只剩一个孤零零的"恢复本组默认"按钮,
   // 用户不知道自己在哪一组
   new Setting(headRow).setName(text(group,'')?.name??group).setHeading();
   const restore=headRow.createEl('button',{cls:'html-atelier-restoregroup',attr:{type:'button','aria-label':restoreText}});
   setIcon(restore,'rotate-ccw');
   restore.createSpan({cls:'html-atelier-restoregroup-label',text:restoreText});
   restore.addEventListener('click',()=>{
    (current as unknown as Record<string,unknown>)[group]=structuredClone((DEFAULT_SETTINGS as unknown as Record<string,unknown>)[group]);
    save();
    this.display();
   });
   for(const key of keys){
    const text2=text(group,key)??{name:key,desc:''};
    const path=`${group}.${key}`;
    const setting=new Setting(section).setName(text2.name).setDesc(text2.desc);
    const value=()=>getByPath(current,path);
    const write=(v:unknown)=>{setByPath(current,path,v);save();};
    const def=getByPath(DEFAULT_SETTINGS,path);
    // 需要自由文本的键:浏览器程序路径,以及可写 "auto" 或像素数的宽度/高度
    const freeText=(group==='links'&&key==='browserApplication')
     ||(group==='preview'&&key==='defaultWidth');
    if(typeof def==='boolean'){
     setting.setClass('html-atelier-setting').setClass('html-atelier-setting--toggle');
     setting.addToggle(t=>t.setValue(!!value()).onChange(v=>write(v)));
    }else if(typeof def==='number'){
     setting.setClass('html-atelier-setting').setClass('html-atelier-setting--number');
     // 清空输入框时 Number('')===0 且 isFinite(0) 为真,会写进 0;空串必须忽略
     // (审计复检 §3.23 M1)。
     setting.addText(tx=>{tx.setValue(String(value())).onChange(v=>{const raw=v.trim();if(raw==='')return;const n=Number(raw);if(Number.isFinite(n))write(n);});});
     const unit=UNIT_KEYS[path];
     if(unit)setting.controlEl.createSpan({cls:'html-atelier-setting-unit',text:settingsUnitText(unit,useEn)});
    }else if(freeText){
     setting.setClass('html-atelier-setting').setClass('html-atelier-setting--text');
     setting.addText(tx=>{tx.setValue(String(value())).onChange(v=>write(v));});
    }else{
     // 枚举:选项与显示名都取自 settingsText 的同一张表 —— 存的是标识符,显示的是
     // 本地化文字。此前直接把标识符当标签,中文界面里看到的是 outline/previous/none
     // (用户反馈 2026-09-15)。ui.language 也在此列(它此前被 `def==='auto'` 命中而
     // 退化成自由文本框,用户得手工输入 "zh-CN")。
     setting.setClass('html-atelier-setting').setClass('html-atelier-setting--select');
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
  // 主题可能改掉卡片的左右内边距(Blue Topaz 是 8px 0,原生 1.14 是 16px):
  // 用实测值让「恢复本组默认」的右边缘对齐卡片控件右边缘,而不是写死 16px。
  const cardRow=containerEl.querySelector<HTMLElement>('.setting-item:not(.setting-item-heading)');
  if(cardRow){
   const padRight=Number.parseFloat(getComputedStyle(cardRow).paddingRight);
   if(Number.isFinite(padRight))containerEl.style.setProperty('--ha-set-card-pad-right',`${padRight}px`);
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
