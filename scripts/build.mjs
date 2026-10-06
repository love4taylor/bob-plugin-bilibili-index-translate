import { build } from 'esbuild-wasm';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
await rm(`${root}dist`, { recursive: true, force: true });
await mkdir(`${root}dist`, { recursive: true });
await build({ entryPoints: [`${root}src/main.ts`], outfile: `${root}dist/main.js`,
  bundle: true, platform: 'neutral', format: 'cjs', target: 'es2020', minify: true });
await cp(`${root}public`, `${root}dist`, { recursive: true });
await cp(`${root}LICENSE`, `${root}dist/LICENSE`);
console.log('插件构建完成：dist/main.js');
