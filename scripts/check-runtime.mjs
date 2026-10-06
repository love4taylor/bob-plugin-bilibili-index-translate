import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const bundle = await readFile(new URL('../dist/main.js', import.meta.url), 'utf8');
for (const forbidden of [/\brequire\s*\(/, /\bprocess\./, /\bBuffer\b/, /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/, /\bAbortController\b/, /\bnode:/]) {
  assert(!forbidden.test(bundle), `Bob 运行时包含不支持的 API：${forbidden}`);
}
const context = vm.createContext({ module: { exports: {} } });
vm.runInContext(bundle, context);
for (const name of ['translate', 'supportLanguages', 'pluginValidate', 'pluginTimeoutInterval']) {
  assert.equal(typeof context.module.exports[name], 'function');
}
assert.equal(new Set(context.module.exports.supportLanguages()).size, context.module.exports.supportLanguages().length);
assert.equal(await readFile(new URL('../dist/info.json', import.meta.url), 'utf8'),
  await readFile(new URL('../public/info.json', import.meta.url), 'utf8'));
console.log(`Bob 运行时检查通过：${context.module.exports.supportLanguages().length - 1} 个语言代码，无 Node/浏览器 API 依赖`);
