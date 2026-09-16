import {App, Notice, TFile, TFolder} from 'obsidian';
import type {Translator} from '../i18n';

// 另存为(F14):默认“原名-副本.html”、原目录;跨目录时按设置重写可解析的本地相对
// src/href/poster/srcset 与内联 CSS url(使用分词器定位,不做全局字符串替换);
// 重写清单在保存前可检查;外链与页内锚点不变;资源二进制不复制。

export {planSaveAs} from './saveAsPlan';
export type {SaveAsPlan} from './saveAsPlan';

export class SaveAsService {
 constructor(private app:App,private t:Translator){}

 uniquePath(dir:string,base:string):string{
  let stem=dir?`${dir}/${base}`:base;
  let path=`${stem}.html`;let n=1;
  while(this.app.vault.getAbstractFileByPath(path))path=`${stem}-${n++}.html`;
  return path;
 }

 async save(source:string,sourcePath:string,targetPath:string):Promise<TFile|null>{
  try{
   const dir=targetPath.includes('/')?targetPath.slice(0,targetPath.lastIndexOf('/')):'';
   if(dir&&!this.app.vault.getAbstractFileByPath(dir)){
    await this.app.vault.createFolder(dir).catch(async()=>{await this.app.vault.adapter.mkdir(dir);});
   }
   const existing=this.app.vault.getAbstractFileByPath(targetPath);
   if(existing instanceof TFile)await this.app.vault.modify(existing,source);
   else await this.app.vault.create(targetPath,source);
   const f=this.app.vault.getAbstractFileByPath(targetPath);
   return f instanceof TFile?f:null;
  }catch(e){
   console.error(e);new Notice(this.t('noticeSaveFailed'));
   return null;
  }
 }

 defaultDir(file:TFile):string{return file.parent?.path&&file.parent instanceof TFolder&&file.parent.path!=='/'?file.parent.path:'';}
}
