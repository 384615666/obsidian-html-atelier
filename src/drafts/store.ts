import {DraftRecordV2,sealDraftRecord,verifyDraftRecord} from './record';
import {fingerprint} from '../core/fingerprint';

// DraftStore（报告 §12.5/D0-05）：
// - 目录后端是首选；adapter 能力（mkdir/exists/remove/list）可选，缺失时降级为直接写+读回校验；
// - 写入流程：临时文件 → 读回校验 checksum → 写正式文件；正式文件损坏(撕裂写)时
//   loadDraft 回退读取最近一份通过校验的 <final>.tmp——两份副本中取 revision 较新的有效者
//   （audit/drafts 2.1/2.2:不可让唯一好副本随正式写一起丢失）；
// - 旧 revision 拒绝写入：磁盘上已有更高 revision 时拒绝本次写入，
//   防止防抖快照与关闭时 flush 乱序落地(audit/drafts 2.6/F25)；
// - 设备命名空间：文件名含设备标识与路径哈希；记录内完整路径校验身份，检测哈希碰撞。
export interface DraftAdapter {
 exists?:(path:string)=>Promise<boolean>;
 mkdir?:(path:string)=>Promise<void>;
 read:(path:string)=>Promise<string>;
 write:(path:string,data:string)=>Promise<void>;
 remove?:(path:string)=>Promise<void>;
 list?:(path:string)=>Promise<string[]|{files:string[]; folders:string[]}>;
}

export interface DraftEntryMeta {filePath:string; record:DraftRecordV2}
export type DraftListResult={records:DraftEntryMeta[]; broken:string[]}

// 文件名只允许文件系统安全字符。fingerprint 的输出形如 "<8位hex><8位hex>:<长度>",
// 其中的 ':' 在 Windows 上是 NTFS 备用数据流分隔符:写入 success 但磁盘上只留下
// 0 字节的基名条目,于是 listDrafts 的 .json 过滤永远不命中、removeDraft 删不掉、
// 同一文件的不同 revision 还会共用同一条数据流。因此哈希段只保留十六进制字符;
// 双段固定宽度,去掉分隔符后仍可无损区分。
const encodeFileName=(filePath:string,deviceId:string):string=>{
 const hash=fingerprint(`${deviceId}\u0000${filePath}`).replace(/[^0-9a-f]/g,'');
 const safeDevice=deviceId.replace(/[^A-Za-z0-9_-]/g,'').slice(0,16)||'dev';
 return `${safeDevice}-${hash}.json`;
};

export class DraftStore {
 constructor(private adapter:DraftAdapter,private dir:string,private deviceId:string){}

 private fileName(filePath:string){return encodeFileName(filePath,this.deviceId);}
 private fullPath(fileName:string){return `${this.dir}/${fileName}`;}

 async ensureDir():Promise<void> {
  if(!this.adapter.mkdir)return;
  try{
   if(this.adapter.exists&&!await this.adapter.exists(this.dir))await this.adapter.mkdir(this.dir);
  }catch{ // 目录探测失败时仍尝试写入，由写入错误上报
  }
 }

 async saveDraft(record:Omit<DraftRecordV2,'checksum'>):Promise<void> {
  const sealed=sealDraftRecord(record);
  if(sealed.deviceId!==this.deviceId)throw new Error('草稿 deviceId 与存储命名空间不一致');
  await this.ensureDir();
  const final=this.fullPath(this.fileName(record.filePath));
  const temp=`${final}.tmp`;
  // 旧 revision 防护(audit/drafts 2.6):磁盘上已有更新 revision 时拒绝本次写入。
  // adapter 无原子 CAS,检查与写入之间存在理论窗口;调用方串行化(防抖队列)兜底。
  const existing=await this.loadDraft(record.filePath).catch(()=>null);
  if(existing&&existing.revision>sealed.revision)
   throw new Error(`草稿写入被拒绝:磁盘上已有更新 revision(${existing.revision} > ${sealed.revision})`);
  const text=JSON.stringify(sealed);
  await this.adapter.write(temp,text);
  // 写临时 → 读回校验 → 更新正式文件
  let roundTrip:DraftRecordV2|null=null;
  try{roundTrip=verifyDraftRecord(JSON.parse(await this.adapter.read(temp)));}
  catch{roundTrip=null;}
  if(!roundTrip||roundTrip.checksum!==sealed.checksum)
   throw new Error('草稿临时文件校验失败，保留上一份有效快照');
  await this.adapter.write(final,text);
  if(this.adapter.remove)await this.adapter.remove(temp).catch(()=>{});
 }

 // 同一份草稿可能同时存在正式文件与 .tmp(写正式文件失败/中断的撕裂写)。
 // 模块注释承诺"两份副本中取 revision 较新的有效者",而 loadDraft 此前只读正式文件、
 // 失败才回退,与 listDrafts 的判定**相反** —— 于是管理器展示新草稿、打开文件却还原旧内容,
 // 用户最新一段工作被静默丢弃(审计报告 5 N1)。两条路径现在共用这一个读取器。
 private async readNameBest(baseName:string,expectedFilePath?:string):Promise<DraftRecordV2|null> {
  const final=this.fullPath(baseName);
  let best:DraftRecordV2|null=null;
  for(const p of [final,`${final}.tmp`]){
   try{
    const r=verifyDraftRecord(JSON.parse(await this.adapter.read(p)));
    if(!r)continue;
    // 身份校验:记录内的完整路径必须与请求一致(检测哈希碰撞)。必须在这里过滤,
    // 否则一份"别人的"记录会在 .tmp 里遮蔽本路径的完好正式文件。
    if(expectedFilePath!==undefined&&r.filePath!==expectedFilePath)continue;
    if(!best||r.revision>best.revision)best=r;
   }catch{/* 单份缺失或损坏:另一份可用即可(audit/drafts 2.1/2.2) */}
  }
  return best;
 }

 async loadDraft(filePath:string):Promise<DraftRecordV2|null> {
  return this.readNameBest(this.fileName(filePath),filePath);
 }

 async listDrafts():Promise<DraftListResult> {
  const records:DraftEntryMeta[]=[];const broken:string[]=[];
  if(!this.adapter.list)return {records,broken};
  let names:string[]=[];
  try{
   const raw=await this.adapter.list(this.dir);
   const arr=Array.isArray(raw)?raw:(raw?.files??[]);
   // 真实 DataAdapter.list 返回完整路径;归一化为文件名(测试桩返回裸名)
   names=arr.map(p=>p.startsWith(`${this.dir}/`)?p.slice(this.dir.length+1):p);
  }catch{return {records,broken};}
  if(!names.length)return {records,broken};
  // 只有 <name>.json.tmp 的草稿此前完全不出现在清单里:撕裂写之后 loadDraft 会读它,
  // 清单却看不见、也删不掉(审计 round4 BUG 20)。按"草稿名"去重后走同一个 readNameBest,
  // 保证清单展示与恢复读取永远取同一份。
  const bases=new Set<string>();
  for(const name of names){
   if(name.endsWith('.json.tmp'))bases.add(name.slice(0,-4));
   else if(name.endsWith('.json'))bases.add(name);
  }
  for(const base of bases){
   const record=await this.readNameBest(base);
   if(record)records.push({filePath:record.filePath,record});
   else broken.push(base);
  }
  return {records,broken};
 }

 async removeDraft(filePath:string):Promise<void> {
  if(!this.adapter.remove)return;
  const final=this.fullPath(this.fileName(filePath));
  // 撕裂写留下的 <final>.tmp 也要删:loadDraft 会回退读它,只删正式文件会让
  // 已丢弃的草稿在下次打开时重新出现(A29 关闭即 flush 的语义要求彻底清除)。
  await this.adapter.remove(final).catch(()=>{});
  await this.adapter.remove(`${final}.tmp`).catch(()=>{});
 }
}
