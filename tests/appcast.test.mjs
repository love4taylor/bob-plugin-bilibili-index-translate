import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { updateAppcast } from '../scripts/appcast.mjs';

const timestamp = 1791244800000;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
async function fixture(t, version = '1.0.4') {
  const root = await mkdtemp(join(tmpdir(), 'bob-appcast-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'public')); await mkdir(join(root, 'dist'));
  const info = {
    identifier: 'test.indextranslate', version, minBobVersion: '1.8.0',
    homepage: 'https://github.com/example/plugin',
    appcast: 'https://raw.githubusercontent.com/example/plugin/main/appcast.json',
  };
  await writeFile(join(root, 'public/info.json'), json(info));
  await writeFile(join(root, 'package.json'), json({ version }));
  await writeFile(join(root, 'dist/info.json'), json(info));
  const archivePath = join(root, 'dist', `bilibili-index-translate-${version}.bobplugin`);
  execFileSync('zip', ['-j', '-X', archivePath, 'info.json'], { cwd: join(root, 'dist'), stdio: 'ignore' });
  return { root, info, archivePath };
}

test('appcast 使用最终 ZIP 的哈希、安装包版本、最低 Bob 版本及 Releases 地址', async (t) => {
  const { root, info, archivePath } = await fixture(t);
  const manifest = await updateAppcast({ root, desc: ' 可选术语表 ', now: timestamp });
  assert.deepEqual(manifest, {
    identifier: info.identifier,
    versions: [{ version: '1.0.4', desc: '可选术语表',
      sha256: createHash('sha256').update(await readFile(archivePath)).digest('hex'),
      url: 'https://github.com/example/plugin/releases/download/v1.0.4/bilibili-index-translate-1.0.4.bobplugin',
      minBobVersion: '1.8.0', timestamp }],
  });
  assert.deepEqual(await readJson(join(root, 'appcast.json')), manifest);
});

test('更新清单保留历史版本、按数值倒序排列，重复生成不重复条目且保留发布时间', async (t) => {
  const { root, info } = await fixture(t, '1.10.0');
  const history = ['1.2.0', '1.9.0'].map((version) => ({ version, desc: '历史版本', sha256: 'a'.repeat(64),
    url: `https://example.com/${version}.bobplugin`, timestamp: timestamp - 1000 }));
  await writeFile(join(root, 'appcast.json'), json({ identifier: info.identifier, versions: history }));
  await updateAppcast({ root, desc: '新版本', now: timestamp });
  const manifest = await updateAppcast({ root, desc: '新版本', now: timestamp + 1000 });
  assert.deepEqual(manifest.versions.map((entry) => entry.version), ['1.10.0', '1.9.0', '1.2.0']);
  assert.equal(manifest.versions[0].timestamp, timestamp);
  assert.deepEqual(manifest.versions.slice(1), [history[1], history[0]]);
});

test('自定义下载地址支持其他 HTTPS 托管，更新包后重新计算哈希', async (t) => {
  const { root, archivePath } = await fixture(t);
  const first = await updateAppcast({ root, desc: '草稿', now: timestamp });
  await writeFile(join(root, 'dist/extra.txt'), '新安装包内容');
  execFileSync('zip', ['-j', '-X', archivePath, 'extra.txt'], { cwd: join(root, 'dist'), stdio: 'ignore' });
  const second = await updateAppcast({ root, desc: '草稿更新', url: 'https://example.com/plugin.bobplugin', now: timestamp });
  assert.equal(second.versions[0].url, 'https://example.com/plugin.bobplugin');
  assert.notEqual(second.versions[0].sha256, first.versions[0].sha256);
  assert.equal(second.versions.length, 1);
});

test('安装包元信息、项目版本或现有清单不一致时拒绝写入', async (t) => {
  for (const kind of ['archive', 'package', 'identifier', 'downgrade', 'duplicate', 'invalid-history', 'invalid-json']) {
    const { root, info } = await fixture(t);
    const manifest = { identifier: info.identifier, versions: [] };
    if (kind === 'archive') await writeFile(join(root, 'public/info.json'), json({ ...info, minBobVersion: '2.0.0' }));
    if (kind === 'package') await writeFile(join(root, 'package.json'), json({ version: '1.0.5' }));
    if (kind === 'identifier') manifest.identifier = 'other.plugin';
    const historical = { version: '1.0.3', desc: '历史版本', sha256: 'a'.repeat(64), url: 'https://example.com/old.bobplugin' };
    if (kind === 'downgrade') manifest.versions = [{ ...historical, version: '1.0.5' }];
    if (kind === 'duplicate') manifest.versions = [historical, historical];
    if (kind === 'invalid-history') manifest.versions = [{ ...historical, sha256: 'incorrect' }];
    const before = kind === 'invalid-json' ? '{broken' : json(manifest);
    await writeFile(join(root, 'appcast.json'), before);
    await assert.rejects(updateAppcast({ root, desc: '更新', now: timestamp }), undefined, kind);
    assert.equal(await readFile(join(root, 'appcast.json'), 'utf8'), before, kind);
  }
});

test('缺少发布说明、非法时间或下载地址以及缺失安装包时不生成清单', async (t) => {
  const { root, archivePath } = await fixture(t);
  for (const args of [
    { desc: '' }, { now: 1791244800 }, { url: 'http://example.com/plugin.bobplugin' },
    { url: 'https://user:secret@example.com/plugin.bobplugin' }, { url: 'not a URL' },
  ]) {
    await assert.rejects(updateAppcast({ root, desc: '更新', now: timestamp, ...args }));
  }
  await rm(archivePath);
  await assert.rejects(updateAppcast({ root, desc: '更新', now: timestamp }), { code: 'ENOENT' });
  await assert.rejects(readFile(join(root, 'appcast.json')), { code: 'ENOENT' });
});
