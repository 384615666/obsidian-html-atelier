// URL 百分号解码(只解一次)。独立小模块、不引 obsidian ——
// 纯函数层(linkIndex)与 Node 单元测试都要用,不能经 links.ts 传递依赖宿主。
export function decodeOnce(s:string):string {
 try{return decodeURIComponent(s);}catch{return s;}
}
