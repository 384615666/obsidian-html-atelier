import {App, Notice, TFile} from 'obsidian';
import {TextPatch} from '../core/patch';
import type {Translator} from '../i18n';

// 笔记引用(F24,D0-01 实测:wiki 与 md 路径链接渲染后都完整保留片段;
// openLinkText 会剥片段路由,滚动定位由本插件视图承担)。
// 默认格式:md 路径链接(空格转 %20)+片段;提供 wiki 备选。

export type RefFormat='md'|'wiki';

export function pageReference(filePath:string,format:RefFormat):string {
 if(format==='wiki')return `[[${filePath}]]`;
 return `[${fileTitle(filePath)}](${linkTarget(filePath)})`;
}

export function sectionReference(filePath:string,anchorId:string,format:RefFormat):string {
 if(format==='wiki')return `[[${filePath}#${anchorId}]]`;
 return `[${fileTitle(filePath)}#${anchorId}](${linkTarget(filePath)}#${anchorId})`;
}

function fileTitle(path:string){const base=path.split('/').pop()??path;return base.replace(/\.(html?|htm)$/i,'');}

// Markdown 链接目标:空格必须编码,`#` 与 `?` 也必须编码——否则它们会被当作片段/查询
// 分隔符,`a#b.md` 这类文件名会生成两个 `#`、链接直接失效(审计复检 §3.23 M3)。
function linkTarget(filePath:string):string {
 return filePath.split('/').map(p=>p.replace(/ /g,'%20').replace(/[#?]/g,c=>c==='#'?'%23':'%3F')).join('/');
}

// “添加锚点并复制”:为目标元素写入唯一 id 属性补丁(一个撤销事务),复制提示锚点尚未保存。
// 返回 patch=null 表示元素本来就有 id —— 此时直接复用,不能再插一个 id 属性
// (双 id 标签格式非法,且浏览器只认第一个,审计复检 §3.23 M2)。
export function makeAddAnchorPatch(index:{source:string; elements(tag:string):{id:number; start:number; startTagStart:number; startTagEnd:number; attrs:{name:string;value?:string}[]}[]},
 tagName:string,nodeId:number,suggestId:string):{patch:TextPatch|null; anchor:string}|null {
 const el=index.elements(tagName).find(e=>e.id===nodeId);
 if(!el)return null;
 const source=index.source;
 const ownId=el.attrs.find(a=>a.name==='id')?.value;
 if(ownId)return {patch:null,anchor:ownId};
 const anchorBase=suggestId.replace(/[^\w\u4e00-\u9fa5-]/g,'-').replace(/^-+|-+$/g,'')||'section';
 // 唯一性:扫描源码中已有的 id 值
 const idValues=new Set<string>();
 for(const m of source.matchAll(/\bid\s*=\s*["']?([^"'\s>]+)/g))idValues.add(m[1]);
 let anchor=anchorBase;let n=2;
 while(idValues.has(anchor))anchor=`${anchorBase}-${n++}`;
 // 插入点直接用 SourceIndex 记录的 startTagStart,不再按源码字符串查找标签名
 // —— 后者大小写敏感,`<H1>` 会定位失败(审计复检 §3.23 M4)
 let insert=el.startTagStart+1+tagName.length;
 while(insert<el.startTagEnd&&/\s/.test(source[insert]))insert++;
 const patch:TextPatch={start:insert,end:insert,expected:'',replacement:` id=${escapeAttrWrap(anchor)}`};
 return {patch,anchor};
}

function escapeAttrWrap(v:string){return `"${v.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"`;}

export function embedCode(filePath:string,height:number|'auto',width:number|'auto',anchor:string|null,toolbar:boolean):string {
 const lines:string[]=['```html-atelier',`path: "${filePath}"`];
 if(height!=='auto')lines.push(`height: ${height}`);
 if(width!=='auto')lines.push(`width: ${width}`);
 if(anchor)lines.push(`anchor: "${anchor}"`);
 lines.push(`toolbar: ${toolbar}`);
 lines.push('```');
 return lines.join('\n');
}

export class NoteReferenceService {
 constructor(private app:App,private t:Translator){}

 async copy(text:string){
  await navigator.clipboard.writeText(text);
  new Notice(this.t('noticeCopied'));
 }

 // 目标 Markdown 笔记上下文:若当前活动文件是 md,相对其目录生成路径;否则库根相对
 relativeTo(targetPath:string):string{
  const active=this.app.workspace.getActiveFile();
  if(active&&active.extension==='md'){
   const dir=active.path.includes('/')?active.path.slice(0,active.path.lastIndexOf('/')+1):'';
   if(targetPath.startsWith(dir))return targetPath.slice(dir.length);
  }
  return targetPath;
 }

 async copyPage(file:TFile,format:RefFormat){
  const path=this.relativeTo(file.path);
  await this.copy(pageReference(path,format));
 }

 async copySection(file:TFile,anchorId:string,format:RefFormat){
  const path=this.relativeTo(file.path);
  await this.copy(sectionReference(path,anchorId,format));
 }
}
