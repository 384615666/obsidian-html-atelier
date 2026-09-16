import {sealDraftRecord,DraftRecordV2} from './record';
import {fingerprint} from '../core/fingerprint';
import {parseDocument,applyText} from '../model';

// v1 → v2 草稿迁移（报告 §12.5/A33）：
// 1.0.1 的草稿记录是 {source, changes:[文字ID,新文字]}，文字 ID 是按旧 parseDocument
// 顺序生成的 t0..tN。迁移用旧模型对 draft.source 重新解析并应用 changes 得到 workingSource；
// 与当前磁盘的比较发生在会话恢复时，不在迁移内进行。
// 迁移是纯函数：幂等、可重试；无法解释的旧草稿保留原始数据为“需手动恢复”。
export interface LegacyDraft {source:string; changes:[string,string][]}
export interface ManualRecovery {filePath:string; raw:unknown; reason:string}

export interface MigrationInputData {drafts:Record<string,LegacyDraft>}

export interface MigrationResult {records:DraftRecordV2[]; manual:ManualRecovery[]}

export function isLegacyDraftShape(v:unknown):v is LegacyDraft {
 if(typeof v!=='object'||v===null)return false;
 const d=v as Record<string,unknown>;
 return typeof d.source==='string'&&Array.isArray(d.changes)
  &&d.changes.every(c=>Array.isArray(c)&&c.length===2&&typeof c[0]==='string'&&typeof c[1]==='string');
}

export function migrateLegacyDrafts(data:unknown,deviceId:string,now:number):MigrationResult {
 const records:DraftRecordV2[]=[];const manual:ManualRecovery[]=[];
 if(typeof data!=='object'||data===null)return {records,manual};
 const drafts=(data as Record<string,unknown>).drafts;
 if(typeof drafts!=='object'||drafts===null)return {records,manual};
 for(const [filePath,entry] of Object.entries(drafts as Record<string,unknown>)){
  if(!isLegacyDraftShape(entry)){
   manual.push({filePath,raw:entry,reason:'草稿结构无法识别'});
   continue;
  }
  try{
   // 用 1.0.1 的文字模型重建 workingSource（模型语义冻结在 src/model.ts）
   const model=parseDocument(entry.source);
   const changes=new Map(entry.changes);
   const workingSource=applyText(model,changes);
   const record=sealDraftRecord({
    schemaVersion:2,deviceId,filePath,
    baseSource:entry.source,baseHash:fingerprint(entry.source),
    workingSource,revision:1,updatedAt:now,
   });
   records.push(record);
  }catch(e){
   manual.push({filePath,raw:entry,reason:e instanceof Error?e.message:String(e)});
  }
 }
 return {records,manual};
}
