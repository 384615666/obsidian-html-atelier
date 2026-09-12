import {parse, serialize} from 'parse5';

export interface Segment {id:string; text:string; start:number; end:number; kind:string}
export interface DocumentModel {source:string; segments:Segment[]}
const excluded = new Set(['script','style','noscript','template','textarea','select','option','svg','math','title','head','iframe','object','embed','canvas']);
export function parseDocument(source:string):DocumentModel {
 const doc:any=parse(source,{sourceCodeLocationInfo:true});
 const segments:Segment[]=[];
 function visit(node:any, blocked=false, kind='文字') {
  const tag=node.tagName;
  blocked ||= excluded.has(tag)||node.attrs?.some((a:any)=>a.name==='hidden'||a.name==='contenteditable');
  if (/^h[1-6]$/.test(tag)) kind='标题'; else if(tag==='button') kind='按钮'; else if(tag==='a')kind='链接'; else if(tag==='p')kind='段落';
  if(node.nodeName==='#text'&&!blocked&&node.value.trim()&&node.sourceCodeLocation){
   const l=node.sourceCodeLocation;
   segments.push({id:'t'+segments.length,text:node.value,start:l.startOffset,end:l.endOffset,kind});
  }
  for(const child of node.childNodes||[])visit(child,blocked,kind);
 }
 visit(doc);return {source,segments};
}
export const escapeText=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function applyText(model:DocumentModel, changes:Map<string,string>):string {
 let source=model.source;
 for(const s of [...model.segments].sort((a,b)=>b.start-a.start)){
  const value=changes.get(s.id);
  if(value!==undefined&&value!==s.text)source=source.slice(0,s.start)+escapeText(value)+source.slice(s.end);
 }return source;
}
export function makePreview(model:DocumentModel, base:string):string {
 const doc:any=parse(model.source,{sourceCodeLocationInfo:true});
 const byStart=new Map(model.segments.map(s=>[s.start,s]));
 function visit(node:any){
  if(node.attrs)node.attrs=node.attrs.filter((a:any)=>!a.name.startsWith('on')&&!['contenteditable','autofocus'].includes(a.name));
  if(node.childNodes)node.childNodes=node.childNodes.filter((n:any)=>!['script','base','iframe','object','embed'].includes(n.tagName)&&!(n.tagName==='meta'&&n.attrs?.some((a:any)=>a.name==='http-equiv')));
  for(let i=0;i<(node.childNodes?.length||0);i++){
   const child=node.childNodes[i];const seg=child.nodeName==='#text'?byStart.get(child.sourceCodeLocation?.startOffset):undefined;
   if(seg){node.childNodes.splice(i,0,{nodeName:'#comment',data:'html-atelier-text:'+seg.id,parentNode:node});i++;}else visit(child);
  }
 }visit(doc);
 const safeBase=base.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
 const policy="default-src 'none'; img-src app: obsidian: data: blob: https: http:; media-src app: obsidian: data: blob: https: http:; style-src 'unsafe-inline' app: obsidian: data: https: http:; font-src app: obsidian: data: https: http:; script-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri app: obsidian:;";
 const additions=`<meta http-equiv="Content-Security-Policy" content="${policy}"><base href="${safeBase}">`;
 return serialize(doc).replace('<head>','<head>'+additions);
}

export class EditSession {
 model:DocumentModel; changes=new Map<string,string>();history:Map<string,string>[]=[];
 selected:string|null=null; mode:'preview'|'edit'='preview';conflict=false;busy=false;
 constructor(source:string){this.model=parseDocument(source);}
 get dirty(){return this.changes.size>0;}
 value(id:string){return this.changes.get(id)??this.model.segments.find(s=>s.id===id)?.text??'';}
 set(id:string,value:string){const seg=this.model.segments.find(s=>s.id===id);if(!seg||this.value(id)===value)return;this.history.push(new Map(this.changes));if(this.history.length>200)this.history.shift();if(value===seg.text)this.changes.delete(id);else this.changes.set(id,value);}
 restore(){if(this.selected){const s=this.model.segments.find(s=>s.id===this.selected);if(s)this.set(s.id,s.text);}}
 undo(){const h=this.history.pop();if(h)this.changes=h;}
 saved(source:string){this.model=parseDocument(source);this.changes.clear();this.history=[];this.selected=null;this.conflict=false;}
}
