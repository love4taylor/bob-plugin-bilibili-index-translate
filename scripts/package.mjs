import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const info = JSON.parse(await readFile(`${root}dist/info.json`, 'utf8'));
const pkg = JSON.parse(await readFile(`${root}package.json`, 'utf8'));
if (info.version !== pkg.version) throw new Error('插件版本与 package.json 不一致');
const name = `bilibili-index-translate-${info.version}.bobplugin`;
execFileSync('zip', ['-j', '-X', '-FS', name, 'main.js', 'info.json', 'icon.png', 'LICENSE',
  'THIRD-PARTY-NOTICES.txt', 'INDEX-TRANSLATE-LICENSE.txt'], { cwd: `${root}dist`, stdio: 'inherit' });
console.log(`安装包：${root}dist/${name}`);
