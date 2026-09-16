import type {Translator} from '../i18n';

// 命令守卫包装(F18 §8.2)。
// 单独成模块的原因:这行逻辑原先内嵌在 main.ts 的 registerCommands 里,审计探针只能
// **复制**一份来验证,于是"守卫返回值被丢弃"这个缺陷(round4 缺陷 41:20 个命令 0 个受限)
// 无法被探针观察到。抽出来后测试与探针都直接调用同一实现。
//
// 契约:run(checking) 返回"该命令当前是否可用";checking=true 时只判定、不执行副作用。
// Obsidian 在 checkCallback 返回 true 时启用命令,所以必须把守卫的返回值原样返回。
export function guardCommand(run:(checking:boolean)=>boolean):(checking:boolean)=>boolean {
 return (checking:boolean)=>run(checking);
}
