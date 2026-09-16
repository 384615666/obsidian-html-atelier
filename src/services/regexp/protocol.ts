// 正则任务协议（报告 §12.7）：消息携带 requestId/revision，返回结果先验结构再校验修订号。
// Worker 内不访问 Vault、剪贴板或宿主 API，只处理调用方提供的数据。
export interface RegexpSearchPayload {
 type:'regexp-search';
 text:string;
 pattern:string;
 flags:string;
 maxMatches:number;
 maxIterations:number;
 revision?:number;
}
export interface RegexpMatch {start:number; end:number; text:string; groups:string[]}
export interface RegexpSearchResult {matches:RegexpMatch[]; truncated:boolean; revision?:number}
export type WorkerReply={requestId:number; ok:true; result:unknown}|{requestId:number; ok:false; error:string};
