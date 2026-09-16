import {fingerprint} from '../core/fingerprint';

// 草稿 v2 记录（报告 §12.5）：按文件隔离存放在插件管理的 drafts 子目录。
// 文件名用设备命名空间与路径哈希生成，记录内保留完整库内路径用于校验（哈希碰撞防御）。
export interface DraftRecordV2 {
 schemaVersion:2;
 deviceId:string;
 filePath:string;
 baseSource:string;
 baseHash:string;
 workingSource:string;
 revision:number;
 updatedAt:number;
 checksum:string;
}

export function computeChecksum(record:Omit<DraftRecordV2,'checksum'>):string {
 const canonical=JSON.stringify([record.schemaVersion,record.deviceId,record.filePath,
  record.baseSource,record.baseHash,record.workingSource,record.revision,record.updatedAt]);
 return fingerprint(canonical);
}

export function sealDraftRecord(record:Omit<DraftRecordV2,'checksum'>):DraftRecordV2 {
 return {...record,checksum:computeChecksum(record)};
}

export function verifyDraftRecord(parsed:unknown):DraftRecordV2|null {
 if(typeof parsed!=='object'||parsed===null)return null;
 const r=parsed as Record<string,unknown>;
 if(r.schemaVersion!==2)return null;
 const asStr=(v:unknown):string=>typeof v==='string'?v:'';
 const typed={
  schemaVersion:2 as const,
  deviceId:asStr(r.deviceId),
  filePath:asStr(r.filePath),
  baseSource:asStr(r.baseSource),
  baseHash:asStr(r.baseHash),
  workingSource:asStr(r.workingSource),
  revision:typeof r.revision==='number'?r.revision:0,
  updatedAt:typeof r.updatedAt==='number'?r.updatedAt:0,
  checksum:asStr(r.checksum),
 };
 if(!typed.filePath||!typed.deviceId)return null;
 if(computeChecksum(typed)!==typed.checksum)return null;
 if(typed.baseHash!==fingerprint(typed.baseSource))return null;
 return typed;
}
