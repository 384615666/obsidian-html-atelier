import {EditorView as CMEditorView} from '@codemirror/view';

// 源码编辑器(F19):宿主 CM6 实例(external,D0-06 实测可解析);
// 行号、软换行;变更经回调进入统一事务历史。查找替换走 RegExpSearchAdapter(Worker)。
// 宿主 CM 模块无编译期类型包:require 后以最小接口描述使用。

interface CMUpdate {docChanged:boolean; state:{doc:{toString():string}}; selection?:{main:{from:number; to:number}}}
interface CMViewModule {
 EditorView:new(cfg:{state:unknown; parent:HTMLElement})=>CMEditorView;
 lineNumbers?:()=>unknown;
}
interface CMStateModule {EditorState:{create(cfg:{doc:string; extensions:unknown[]}):unknown}}

export interface SourceEditorOptions {
 parent:HTMLElement;
 lineNumbers:boolean;
 lineWrapping:boolean;
 doc:string;
 onDocChanged:(newDoc:string)=>void;
 onSelectionChanged?:((from:number,to:number)=>void)|null;
}

export class SourceEditor {
 view:CMEditorView|null=null;
 private opts:SourceEditorOptions;

 constructor(opts:SourceEditorOptions){this.opts=opts;this.mount();}

 private mount(){
  // Obsidian 渲染进程可直接 require 宿主内置的 CM 模块(报告 §12.6/D0-06 实测)
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- 宿主内置 CM 模块的运行时解析方式
  const viewMod=(require('@codemirror/view') as unknown) as CMViewModule & {EditorView:{lineWrapping?:unknown; updateListener?:{of(fn:(u:CMUpdate)=>void):unknown}}};
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- 同上
  const stateMod=(require('@codemirror/state') as unknown) as CMStateModule;
  const extensions:unknown[]=[];
  if(this.opts.lineNumbers&&viewMod.lineNumbers)extensions.push(viewMod.lineNumbers());
  if(this.opts.lineWrapping&&viewMod.EditorView.lineWrapping)extensions.push(viewMod.EditorView.lineWrapping);
  if(viewMod.EditorView.updateListener)extensions.push(viewMod.EditorView.updateListener.of((u:CMUpdate)=>{
   if(u.docChanged)this.opts.onDocChanged(u.state.doc.toString());
   else if(u.selection&&this.opts.onSelectionChanged)this.opts.onSelectionChanged(u.selection.main.from,u.selection.main.to);
  }));
  const EV=viewMod.EditorView;
  this.view=new EV({state:stateMod.EditorState.create({doc:this.opts.doc,extensions}),parent:this.opts.parent});
  // 组合输入(中文输入法)期间 CM6 的 doc 里是拼音字母。此时回写等于把拼音写进
  // 会话/草稿/预览,所以对外暴露组合状态,由调用方推迟提交(F19 的防抖回写)。
  const dom=this.view.contentDOM;
  if(dom){
   dom.addEventListener('compositionstart',()=>{this.composing=true;});
   dom.addEventListener('compositionend',()=>{this.composing=false;});
  }
 }

 private composing=false;
 // 正在输入法组合中(或编辑器自报组合中)
 isComposing():boolean{return this.composing||this.view?.composing===true;}

 setDoc(doc:string){
  if(!this.view)return;
  const cur=this.view.state.doc.toString();
  if(cur===doc)return;
  this.view.dispatch({changes:{from:0,to:cur.length,insert:doc}});
 }

 getDoc():string{return this.view?.state.doc.toString()??'';}

 revealOffset(offset:number){
  if(!this.view)return;
  const len=this.view.state.doc.length;
  const pos=Math.min(Math.max(0,offset),len);
  this.view.dispatch({selection:{anchor:pos,head:pos},scrollIntoView:true});
  this.view.focus();
 }

 getCursorOffset():number{return this.view?.state.selection.main.head??0;}

 destroy(){
  this.view?.destroy();
  this.view=null;
 }
}
