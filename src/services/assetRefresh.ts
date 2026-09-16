import {debounce} from 'obsidian';

// 依赖变化 → 防抖刷新(300ms,同批次只刷一次)。
// 单独成文件:assets.ts 的解析/依赖判定是纯逻辑(可被 node 测试直接引用),
// 唯一需要宿主 API 的防抖封装留在这里。
export function createAssetRefresher(onRefresh:()=>void){
 return debounce(()=>{onRefresh();},300,true);
}
