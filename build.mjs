import {build} from 'esbuild';
await build({entryPoints:['src/main.ts'],outfile:'main.js',bundle:true,external:['obsidian'],format:'cjs',platform:'browser',target:'es2020',logLevel:'info'});
