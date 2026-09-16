import {TFile} from 'obsidian';
import {SourceIndex,SourceNode} from '../parsing/sourceIndex';
import {ResourceInfo,collectResourcesWithBase} from '../services/assets';

// panel.ts 的支撑工具与类型

export {planSrcsetRemoval} from '../parsing/patchPlan';

export type SelectionInfoShape=unknown;

export interface SelectionInfo2 {kind:string; segmentId?:string; nodeId?:number}

export function normJoinDir(dir:string,rel:string):string{
 const parts=dir&&dir!=='/'?dir.replace(/\/$/,'').split('/'):[];
 for(const part of rel.split('/')){
  if(part==='.'||part==='')continue;
  if(part==='..'){parts.pop();continue;}
  parts.push(part);
 }
 return parts.join('/');
}

export function collectResourcesIndexed(index:SourceIndex,sourcePath:string,exists:(p:string)=>boolean,allowNetwork:boolean):
 (ResourceInfo&{offset:number})[]{
 const infos=collectResourcesWithBase(index,sourcePath,exists,allowNetwork);
 // 附上源码偏移:按 raw 与节点顺序对回 SourceIndex
 const out:(ResourceInfo&{offset:number})[]=[];
 const used=new Set<number>();
 for(const n of index.nodes){
  if(n.kind!=='element')continue;
  const attr=n.attrs.find(a=>a.name==='src')??n.attrs.find(a=>a.name==='href');
  if(!attr)continue;
  if(used.has(n.id))continue;
  const info=infos.find(r=>r.raw===attr.value&&!used.has(n.id));
  if(info){used.add(n.id);out.push({...info,offset:attr.start});}
 }
 return out;
}

export function isTFile(f:unknown):f is TFile{return f instanceof TFile;}
export type SN=SourceNode;

// 资源状态徽标文案(F17)。按 status 索引:此前按 local/remote 二选一,导致 blocked
// (按设置拦截的网络资源)显示成"远程",用户看不出资源为什么加载不了(round4 缺陷 36)。
export function resourceStatusText(status:string,t:(key:string)=>string):string{
 const map:Record<string,string>={
  'local-ok':t('resourcesStatusLocalOk'),
  'missing':t('resourcesStatusMissing'),
  'remote':t('resourcesStatusRemote'),
  'blocked':t('resourcesStatusBlocked'),
 };
 return map[status]??t('resourcesStatusRemote');
}
