import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,ENUM_VALUES,normalizeSettings} from '../src/settings/schema';
import {settingsOptions,settingsOptionsEn,settingsText,settingsTextEn} from '../src/settings/settingsText';
import {resolveLocale,createTranslator} from '../src/i18n';

// 设置页枚举下拉必须显示本地化文字:此前直接把标识符当标签,中文界面里是
// outline/previous/none,用户看不懂(用户反馈 2026-09-15)。这三条把"清单一致"
// 和"不留标识符"钉死,以后新增枚举值不补标签就会在这里失败。
test('A22 每个枚举设置的显示名与 schema 允许值完全一致(中/英)',()=>{
 const paths=Object.keys(ENUM_VALUES) as (keyof typeof ENUM_VALUES)[];
 assert.ok(paths.length>=12,'枚举设置数量异常: '+paths.length);
 for(const path of paths){
  const [group,key]=path.split('.');
  const allowed=[...ENUM_VALUES[path]] as string[];
  const zh=settingsOptions(group,key);
  const en=settingsOptionsEn(group,key);
  assert.ok(zh,`${path} 缺少中文显示名`);
  assert.ok(en,`${path} 缺少英文显示名`);
  assert.deepEqual(Object.keys(zh!).sort(),[...allowed].sort(),`${path} 中文显示名的键与允许值不一致`);
  assert.deepEqual(Object.keys(en!).sort(),[...allowed].sort(),`${path} 英文显示名的键与允许值不一致`);
  for(const v of allowed){
   assert.ok(zh![v]&&zh![v].trim(),`${path}.${v} 中文显示名为空`);
   assert.ok(en![v]&&en![v].trim(),`${path}.${v} 英文显示名为空`);
   // 中文界面里不该原样露出标识符(除非它本身是可读的专名:English)
   assert.notEqual(zh![v],v,`${path}.${v} 中文显示名仍是标识符`);
  }
 }
});

test('A22 枚举设置的每个允许值都能被 schema 接受,且默认值在清单内',()=>{
 for(const path of Object.keys(ENUM_VALUES) as (keyof typeof ENUM_VALUES)[]){
  const [group,key]=path.split('.');
  const allowed=[...ENUM_VALUES[path]] as string[];
  for(const v of allowed){
   const {settings,warnings}=normalizeSettings({[group]:{[key]:v}});
   assert.deepEqual(warnings,[],`${path}=${v} 被 schema 拒绝: ${warnings.join('; ')}`);
   const got=(settings as unknown as Record<string,Record<string,unknown>>)[group][key];
   assert.equal(got,v,`${path} 没能保存 ${v}`);
  }
  const def=(DEFAULT_SETTINGS as unknown as Record<string,Record<string,unknown>>)[group][key];
  assert.ok(allowed.includes(String(def)),`${path} 的默认值 ${String(def)} 不在允许清单里`);
 }
});

test('A22 设置页的分组标题与"恢复本组默认"按钮都有双语',()=>{
 for(const group of Object.keys(DEFAULT_SETTINGS)){
  const zh=settingsText(group,'');
  const en=settingsTextEn(group,'');
  assert.ok(zh?.name&&en?.name,`${group} 分组标题缺失`);
  assert.notEqual(zh!.name,group,`${group} 分组标题没有本地化(直接用了组名)`);
 }
});

test('A22 默认值与 44 项设置键完整性',()=>{
 const {settings,warnings}=normalizeSettings(undefined);
 assert.deepEqual(warnings,[]);
 assert.equal(settings.sidebar.autoShowHtml,true);
 assert.equal(settings.links.browserGesture,'Mod');
 assert.equal(settings.editor.historyLimit,200);
 assert.equal(settings.editor.toolbarPlacement,'sidebar');
 assert.equal(settings.drafts.debounceMs,750);
 assert.equal(settings.preview.defaultWidth,'auto');
 assert.equal(settings.saveAs.rebaseRelativeUrls,true);
 assert.equal(settings.embeds.enabled,true);
 assert.equal(settings.source.previewDelayMs,400);
 assert.equal(settings.ui.language,'auto');
 // 键计数：与设计报告 §8.1 表一一对应。
 // 44→43:preview.defaultHeight 与本插件预览的实际布局无关(高度由分栏布局决定),
 // 且与 embeds.defaultHeight 同名不同义,已按审计 round4 缺陷 38 移除。
 // 43→44:新增 editor.toolbarPlacement(工具栏承载在侧栏还是视图内)。
 const count=(o:unknown):number=>typeof o==='object'&&o!==null?Object.values(o as Record<string,unknown>).reduce((n,v)=>n+count(v),0):1;
 assert.equal(count(DEFAULT_SETTINGS),44);
});

test('A22 非法旧值回退默认并给出警告；数字越界收敛',()=>{
 const {settings,warnings}=normalizeSettings({
  editor:{historyLimit:5,mergeDelayMs:'x',defaultMode:'bogus'},
  preview:{defaultZoom:999,defaultWidth:100},
  drafts:{enabled:false,closeBehavior:'keep',maxWaitMs:100},
  sidebar:{markdownTarget:'wiki'},
  unknownTop:{keep:true},
  'sidebar.strayKey':1,
 });
 assert.equal(settings.editor.historyLimit,50);
 assert.equal(settings.editor.mergeDelayMs,800);
 assert.equal(settings.editor.defaultMode,'preview');
 assert.equal(settings.preview.defaultZoom,200);
 assert.equal(settings.preview.defaultWidth,240);
 // 备份关闭时 closeBehavior 强制 ask；maxWait 不小于 debounce
 assert.equal(settings.drafts.closeBehavior,'ask');
 assert.equal(settings.drafts.maxWaitMs,settings.drafts.debounceMs);
 assert.equal(settings.sidebar.markdownTarget,'outline');
 assert.ok(warnings.some(w=>w.includes('historyLimit')));
 assert.ok(warnings.some(w=>w.includes('maxWaitMs')));
 // 未知字段隔离保留，不进入强类型设置
 const {retainedUnknown}=normalizeSettings({unknownTop:{keep:true},sidebar:{stray:1}});
 assert.deepEqual(retainedUnknown,{unknownTop:{keep:true},'sidebar.stray':1});
});

test('A22 maxWaitMs 收敛到不小于 debounceMs',()=>{
 const ok=normalizeSettings({drafts:{debounceMs:5000,maxWaitMs:10000}}).settings.drafts;
 assert.equal(ok.debounceMs,5000);
 assert.equal(ok.maxWaitMs,10000);
});

test('A22 语言解析与翻译回退',()=>{
 assert.equal(resolveLocale('auto','zh-cn'),'zh-CN');
 assert.equal(resolveLocale('auto','en-US'),'en');
 assert.equal(resolveLocale('auto',''),'en');
 assert.equal(resolveLocale('en','zh-CN'),'en');
 const zh=createTranslator('zh-CN');
 const enT=createTranslator('en');
 assert.equal(zh('panelSave'),'保存');
 assert.equal(enT('panelSave'),'Save');
 assert.equal(zh('statusDirty',{n:3}),'3 处未保存'); // 2.0 文案精简
 assert.equal(zh('conflictCount',{n:2}),'冲突 2 处'); // v2 键可用
 assert.equal(zh('noticeDraftExported',{path:'a/b.html'}),'已另存草稿：a/b.html');
 // 双语键集合一致：en 缺键时回退中文基线，且编译期已保证完整
 assert.equal(createTranslator('en')('actionCancel'),'Cancel');
});
