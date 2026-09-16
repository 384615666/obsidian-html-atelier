import {TFile} from 'obsidian';

// 导航栈(F06):每个主工作叶子独立,最多 100 项;记录文件、锚点、滚动、宽度、缩放。
// 正常导航压栈;返回/前进的程序恢复不压栈;返回后访问新目标截断前进历史。

export interface NavEntry {
 path:string;
 anchor:string;
 scrollRatio:number;      // 滚动比例(0..1),元素定位信息由视图另存
 zoom:number;
 width:number|'auto';
}

export class NavigationService {
 private stacks=new WeakMap<object,{entries:NavEntry[]; index:number}>();
 private owners:object[]=[]; // 仅用于 rename 时遍历各叶片的栈(WeakMap 不可枚举)
 private positions=new Map<string,NavEntry>(); // 文件级最近位置(会话内)

 stackFor(owner:object):{entries:NavEntry[]; index:number} {
  let st=this.stacks.get(owner);
  if(!st){st={entries:[],index:-1};this.stacks.set(owner,st);this.owners.push(owner);}
  return st;
 }

 // 更新栈顶同路径条目的位置(滚动比例等)。用户在页面上滚动时调用,
 // 而不是在新页面加载的那一刻抓取——后者永远拿到 0(审计 round4 BUG 34:
// 每个栈条目的 scrollRatio 都是 0,Back/Forward 因此从不恢复阅读位置)。
 updateTop(owner:object,entry:NavEntry){
  const st=this.stackFor(owner);
  const top=st.entries[st.index];
  if(!top||top.path!==entry.path)return;
  st.entries[st.index]=entry;
  this.recordPosition(entry);
 }

 // 记录访问:删除后重设,让 Map 的迭代顺序始终是"最近访问在后"(LRU 接触)。
 recordPosition(entry:NavEntry){this.positions.delete(entry.path);this.positions.set(entry.path,entry);}

 lastPosition(path:string):NavEntry|undefined{return this.positions.get(path);}

 // 前往新目标:截断前进分支,压栈;同一文件的连续状态(模式/视口变化)更新栈顶而非新增
 push(owner:object,entry:NavEntry){
  const st=this.stackFor(owner);
  st.entries=st.entries.slice(0,st.index+1);
  const top=st.entries[st.entries.length-1];
  if(top&&top.path===entry.path){st.entries[st.entries.length-1]=entry;}
  else{
   st.entries.push(entry);
   if(st.entries.length>100)st.entries.shift();
  }
  st.index=st.entries.length-1;
  this.recordPosition(entry);
 }

 // 程序性导航(后退/前进)完成加载后:把索引对齐到目标路径的条目,不截断前进分支。
 // 栈里同一路径可以出现多次(A→B→A),因此必须取"离当前索引最近"的那一项:
 // findIndex 取首个匹配会让一次后退跳到最早那次访问,前进分支随即错位(AC10 实测)。
 alignToPath(owner:object,path:string){
  const st=this.stackFor(owner);
  if(st.entries[st.index]?.path===path)return; // 已经对齐,保持不变
  let best=-1,bestDistance=Infinity;
  for(let i=0;i<st.entries.length;i++){
   if(st.entries[i].path!==path)continue;
   const distance=Math.abs(i-st.index);
   if(distance<bestDistance){bestDistance=distance;best=i;}
  }
  if(best>=0)st.index=best;
 }

 canBack(owner:object){const st=this.stackFor(owner);return st.index>0;}
 canForward(owner:object){const st=this.stackFor(owner);return st.index<st.entries.length-1;}

 back(owner:object):NavEntry|null{
  const st=this.stackFor(owner);
  if(st.index<=0)return null;
  st.index--;
  return st.entries[st.index];
 }

 forward(owner:object):NavEntry|null{
  const st=this.stackFor(owner);
  if(st.index>=st.entries.length-1)return null;
  st.index++;
  return st.entries[st.index];
 }

 // F06:文件重命名迁移位置记录。
 // 必须同时迁移**每叶片的导航栈**:只改 positions 的话,back() 仍返回旧路径,视图按旧路径
 // 找不到文件、静默什么都不打开,而 index 已经减 1 —— 用户既没回到目标文件,也丢了那一步
 // (审计 round4 BUG 37:结构性缺陷,全仓库没有任何地方迁移 stacks)。
 rename(oldPath:string,newPath:string){
  const pos=this.positions.get(oldPath);
  if(pos){this.positions.delete(oldPath);this.positions.set(newPath,{...pos,path:newPath});}
  for(const owner of this.owners){
   const st=this.stacks.get(owner);
   if(!st)continue;
   for(let i=0;i<st.entries.length;i++){
    if(st.entries[i].path===oldPath)st.entries[i]={...st.entries[i],path:newPath};
   }
  }
 }

 // 文件级持久化(最近 200 个文件,存插件数据)。
 // 必须保留"最近"的 200 个:positions 的迭代顺序是插入序,取前 200 会留下最早访问的
 // 文件,而用户最近读的文件全部丢失(审计复检 §3.20)。recordPosition 做 LRU 接触,
 // 因此这里取尾部。
 toJSON(limit=200):Record<string,NavEntry>{
  const out:Record<string,NavEntry>={};
  const keys=[...this.positions.keys()];
  for(const k of keys.slice(Math.max(0,keys.length-limit))){
   const v=this.positions.get(k);
   if(v)out[k]=v;
  }
  return out;
 }

 fromJSON(data:unknown){
  if(typeof data!=='object'||data===null)return;
  for(const [k,v] of Object.entries(data as Record<string,unknown>)){
   const e=v as Partial<NavEntry>;
   if(typeof e?.path==='string'&&k===e.path)this.positions.set(k,e as NavEntry);
  }
 }

 // iframe 元素被移除后,它的 WindowProxy 仍然可以取到,但 document/documentElement 已为 null
 // (Chromium 108+ 丢弃浏览上下文)。调用方(菜单/滚动抓取/重绘)持有的是旧窗口引用,
 // 不设防就会抛 "Cannot read properties of null (reading 'scrollHeight')"。
 // 见 audit/runtime/selfcheck-newpaths.mjs 第 6 节。
 scrollRatioOf(win:Window|null|undefined):number {
  if(!win||!win.document||!win.document.documentElement)return 0;
  const max=win.document.documentElement.scrollHeight-win.innerHeight;
  return max>0?Math.min(1,Math.max(0,win.scrollY/max)):0;
 }

 restoreScroll(win:Window|null|undefined,ratio:number){
  if(!win||!win.document||!win.document.documentElement)return;
  const max=win.document.documentElement.scrollHeight-win.innerHeight;
  win.scrollTo(0,max*ratio);
 }
}

// 阅读位置持久化条目的轻量校验
export function isNavEntry(v:unknown):v is NavEntry {
 const e=v as NavEntry;
 return !!e&&typeof e.path==='string'&&typeof e.scrollRatio==='number';
}

export type NavOwner=object;
export function currentNavEntry(file:TFile|null,anchor:string,win:Window|null,zoom:number,width:number|'auto'):NavEntry|null {
 if(!file)return null;
 return {path:file.path,anchor,scrollRatio:win?Math.min(1,Math.max(0,(()=>{const max=win.document.documentElement.scrollHeight-win.innerHeight;return max>0?win.scrollY/max:0;})())):0,zoom,width};
}
