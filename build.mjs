import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';

// 主入口:obsidian/electron/宿主 CM 模块一律 external(运行时由宿主提供,D0-06 实测)。
await build({
 entryPoints:['src/main.ts'],
 outfile:'main.js',
 bundle:true,
 external:['obsidian','electron',
  '@codemirror/view','@codemirror/state','@codemirror/language','@codemirror/commands',
  '@codemirror/search','@codemirror/autocomplete','@lezer/highlight','@lezer/common','@lezer/lr'],
 format:'cjs',platform:'browser',target:'es2020',logLevel:'info',
});

// 后台任务 Worker:独立打包为无宿主 import 的 IIFE,以字符串内联进 main.js,
// 运行时经 Blob URL 创建(D0-08 实测通过)。
const worker=await build({
 entryPoints:['src/services/regexp/worker.browser.ts'],
 bundle:true,format:'iife',platform:'browser',target:'es2020',write:false,logLevel:'silent',
});
const workerSrc=worker.outputFiles[0].text;
let main=await readFile('main.js','utf8');
const marker='/*__HTML_ATELIER_WORKER_BUNDLE__*/';
// 源码中的占位是带引号的字符串字面量;esbuild 输出使用双引号 — 整体替换为 JSON 字符串,
// 只替换注释内容会导致引号嵌套语法错误(实测教训:加载即静默失败)。
const doubleQuoted=`"${marker}"`;
const singleQuoted=`'${marker}'`;
if(main.includes(doubleQuoted))main=main.replace(doubleQuoted,()=>JSON.stringify(workerSrc));
else if(main.includes(singleQuoted))main=main.replace(singleQuoted,()=>JSON.stringify(workerSrc));
else throw new Error('main.js 缺少带引号的 Worker 占位字面量');
await writeFile('main.js',main);
// 产物语法自检:防止任何内联/替换问题把插件变成"加载即静默失败"
await build({stdin:{contents:main,resolveDir:'.',loader:'js'},write:false,logLevel:'silent'});
console.log(`worker 内联完成(${workerSrc.length} 字节),语法自检通过`);
