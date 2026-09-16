import {zhCNAll,TranslationKey} from './zh-CN';
import {en} from './en';

export type Locale='zh-CN'|'en';
export type {TranslationKey};

// 语言解析（报告 §8.1）：auto 跟随宿主语言；翻译缺失回退英文；auto 无法识别时也回退英文。
export function resolveLocale(pref:'auto'|Locale,hostLanguage:string|null):Locale {
 if(pref!=='auto')return pref;
 const lang=(hostLanguage??'').toLowerCase();
 if(lang.startsWith('zh'))return 'zh-CN';
 return 'en';
}

export type Translator=(key:TranslationKey,params?:Record<string,string|number>)=>string;

export function createTranslator(locale:Locale):Translator {
 const dict=locale==='zh-CN'?zhCNAll:en;
 return (key,params)=>{
  let text=dict[key]??zhCNAll[key]??String(key);
  if(params)for(const [k,v] of Object.entries(params))text=text.split(`{${k}}`).join(String(v));
  return text;
 };
}
