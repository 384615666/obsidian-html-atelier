// 后台任务宿主（报告 §12.7）：隔离任务通道，消息携带 requestId；
// 超时通过终止 Worker 实现（setTimeout 无法中止执行中的 RegExp）；
// 已取消/过期任务的结果在结构校验后因查不到 pending 表而直接丢弃——旧结果不落地。
export interface WorkerTransport {
 post(msg:unknown):void;
 terminate():void;
 onMessage(cb:(msg:unknown)=>void):void;
}
export type TransportFactory=()=>WorkerTransport;

export class TaskTimeoutError extends Error {
 constructor(message:string){super(message);this.name='TaskTimeoutError';}
}
export class WorkerTaskError extends Error {
 constructor(message:string){super(message);this.name='WorkerTaskError';}
}

export interface TaskHostOptions {timeoutMs:number}

interface PendingEntry {resolve:(v:unknown)=>void; reject:(e:Error)=>void; timer:ReturnType<typeof setTimeout>}

// 定时器封装：Obsidian 宿主内走 window 前缀（弹出窗口兼容，见 obsidianmd/prefer-window-timers）。
// else 分支仅在 Node 测试环境执行（宿主渲染进程恒有 window），故裸 setTimeout 保留为已说明警告。
type TimerHandle=ReturnType<typeof setTimeout>;
function schedule(cb:()=>void,ms:number):TimerHandle{
 if(typeof window!=='undefined')return window.setTimeout(cb,ms) as unknown as TimerHandle;
 return setTimeout(cb,ms);
}
function clearTimer(t:TimerHandle){
 if(typeof window!=='undefined')window.clearTimeout(t as unknown as Parameters<typeof window.clearTimeout>[0]);
 else clearTimeout(t);
}

export class TaskHost {
 private worker:WorkerTransport|null=null;
 private pending=new Map<number,PendingEntry>();
 private nextId=1;
 private disposed=false;

 constructor(private factory:TransportFactory,private options:TaskHostOptions={timeoutMs:1000}){}

 get activeTaskCount(){return this.pending.size;}

 private ensureWorker():WorkerTransport {
  if(!this.worker){
   this.worker=this.factory();
   this.worker.onMessage(msg=>this.handleMessage(msg));
  }
  return this.worker;
 }

 private killWorker(){
  if(this.worker){
   try{this.worker.terminate();}catch{/* 忽略终止错误 */}
   this.worker=null;
  }
 }

 run<T>(payload:Record<string,unknown>,timeoutMs?:number):Promise<T> {
  if(this.disposed)return Promise.reject(new Error('TaskHost 已释放'));
  const requestId=this.nextId++;
  return new Promise<T>((resolve,reject)=>{
   const taskLabel=typeof payload.type==='string'?payload.type:'task';
   const timer=schedule(()=>{
    this.pending.delete(requestId);
    // Worker 已被终止,其余在途任务也必然收不到回复:一并显式拒绝,避免饿等到各自超时
    this.failAllPending(`任务 ${taskLabel} 超时导致 Worker 终止,其余在途任务一并中止`);
    reject(new TaskTimeoutError(`任务 ${taskLabel} 超时（${timeoutMs??this.options.timeoutMs}ms），Worker 已终止`));
   },timeoutMs??this.options.timeoutMs);
   this.pending.set(requestId,{resolve:resolve as (v:unknown)=>void,reject,timer});
   try{
    this.ensureWorker().post({requestId,...payload});
   }catch(e){
    clearTimer(timer);this.pending.delete(requestId);this.killWorker();
    reject(e instanceof Error?e:new Error(String(e)));
   }
  });
 }

 // 结构校验：非对象、缺 requestId、无对应 pending（已取消/超时）一律丢弃。
 private handleMessage(msg:unknown){
  if(typeof msg!=='object'||msg===null)return;
  const m=msg as Record<string,unknown>;
  if(typeof m.requestId!=='number')return;
  const entry=this.pending.get(m.requestId);
  if(!entry)return;
  clearTimer(entry.timer);
  this.pending.delete(m.requestId);
  if(m.ok===true)entry.resolve(m.result);
  else entry.reject(new WorkerTaskError(typeof m.error==='string'?m.error:'worker 任务失败'));
 }

 // 取消全部未完成任务（切换/关闭视图时调用）：被取消的任务可能是灾难性回溯,
 // 无法从外部中断,必须终止 Worker 本身,否则它会继续占用通道饿死后续任务
 // （audit/services rx2 #10）。延迟到达的旧结果因查不到 pending 而丢弃。
 cancelAll(reason='任务已取消'){
  for(const [,entry] of this.pending){clearTimer(entry.timer);entry.reject(new Error(reason));}
  this.pending.clear();
  this.killWorker();
 }

 private failAllPending(reason:string){
  for(const [,entry] of this.pending){clearTimer(entry.timer);entry.reject(new TaskTimeoutError(reason));}
  this.pending.clear();
  this.killWorker();
 }

 dispose(){
  this.disposed=true;
  for(const [,entry] of this.pending){clearTimer(entry.timer);entry.reject(new Error('TaskHost 已释放'));}
  this.pending.clear();
  this.killWorker();
 }
}
