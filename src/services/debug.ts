// 诊断日志。此前各处直接往 window.__atelierDebug 上无限追加:300 次编辑就是 600 条,
// 且挂在 window 上跨视图卸载/重载留存,而 src/ 内没有任何读取方(审计 round4 缺陷 32)。
// 现在统一走这里:环形封顶(保留最新 CAP 条,探针读取的是 slice(-8) 所以必须留最新的),
// 并在插件加载时清空。读取方:探针/故障排查(见 docs/开发记录-2.0-交付状态.md)。

const KEY='__atelierDebug';
const CAP=200;

type Holder={__atelierDebug?:string[]};

export function debugLog(message:string):void{
 const w=window as unknown as Holder;
 const arr=(w[KEY]=w[KEY]??[]);
 arr.push(message);
 if(arr.length>CAP)arr.splice(0,arr.length-CAP);
}

export function clearDebugLog():void{
 (window as unknown as Holder)[KEY]=[];
}

export function debugTail(n=8):string[]{
 return ((window as unknown as Holder)[KEY]??[]).slice(-n);
}
