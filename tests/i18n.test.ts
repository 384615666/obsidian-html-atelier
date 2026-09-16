import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zhCNAll,TranslationKey} from '../src/i18n/zh-CN';
import {en} from '../src/i18n/en';
import {createTranslator,resolveLocale} from '../src/i18n';

// 审计复检 §3.7 的结构性防回归:createTranslator 在英文缺键时回退中文词典,
// 于是"英文界面里冒出中文"不会报错、只会在用户面前露出来(panelRedo 就是这样漏的)。

test('A22 英文词典覆盖全部中文键(不再静默回退中文)',()=>{
 const missing=(Object.keys(zhCNAll) as TranslationKey[]).filter(k=>typeof en[k]!=='string'||en[k]==='');
 assert.deepEqual(missing,[],`英文缺失键: ${missing.join(', ')}`);
});

test('A22 英文文案里不出现中文字符',()=>{
 const cjk=/[\u4e00-\u9fff]/;
 const bad=(Object.entries(en) as [string,string][]).filter(([,v])=>cjk.test(v)).map(([k])=>k);
 assert.deepEqual(bad,[],`英文值含中文: ${bad.join(', ')}`);
});

test('A22 中英占位符一致',()=>{
 const holders=(s:string)=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort().join(',');
 const bad=(Object.keys(zhCNAll) as TranslationKey[])
  .filter(k=>holders(zhCNAll[k])!==holders(en[k]))
  .map(k=>`${k}: zh={${holders(zhCNAll[k])}} en={${holders(en[k])}}`);
 assert.deepEqual(bad,[],bad.join(' | '));
});

test('A22 auto 语言跟随宿主,显式选择优先',()=>{
 assert.equal(resolveLocale('auto','zh-CN'),'zh-CN');
 assert.equal(resolveLocale('auto','en-US'),'en');
 assert.equal(resolveLocale('auto','fr'),'en');
 assert.equal(resolveLocale('auto',''),'en');
 assert.equal(resolveLocale('en','zh-CN'),'en');
 assert.equal(resolveLocale('zh-CN','en-US'),'zh-CN');
});

test('A22 翻译缺失时不再有"中英混排"的可见回退',()=>{
 const t=createTranslator('en');
 // 抽样:2.0 侧栏按钮在英文界面必须是英文
 assert.equal(t('panelRedo'),'Redo');
 assert.equal(t('panelUndo'),'Undo');
 assert.ok(!/[\u4e00-\u9fff]/.test(t('formParagraph')));
});
