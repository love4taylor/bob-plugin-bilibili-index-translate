import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

function versionParts(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`发布版本必须为 x.y.z 格式：${version}`);
  }
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error(`版本号超出安全整数范围：${version}`);
  return parts;
}

function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

function httpsUrl(value, label) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${label}必须为不含凭证的 HTTPS 地址`);
  }
  return url.href;
}

function releaseUrl(info, name) {
  const homepage = new URL(info.homepage);
  const repo = homepage.pathname.replace(/\/$/, '');
  if (homepage.origin !== 'https://github.com' || !/^\/[\w.-]+\/[\w.-]+$/.test(repo) || homepage.search || homepage.hash) {
    throw new Error('无法从 homepage 生成 GitHub Releases 地址，请使用 --url 指定安装包地址');
  }
  return `https://github.com${repo}/releases/download/v${info.version}/${name}`;
}

// Generate a local release manifest; publishing the archive and manifest is separate.
export async function updateAppcast({ root = projectRoot, desc, url, now = Date.now() } = {}) {
  if (typeof desc !== 'string' || !desc.trim()) throw new Error('请使用 --desc 提供更新说明');
  if (!Number.isSafeInteger(now) || now < 1e12) throw new Error('发布时间必须为毫秒时间戳');
  const info = await readJson(join(root, 'public/info.json'));
  const pkg = await readJson(join(root, 'package.json'));
  versionParts(info.version);
  if (info.version !== pkg.version) throw new Error('插件版本与 package.json 不一致');
  if (typeof info.identifier !== 'string' || !info.identifier.trim()) throw new Error('插件标识符无效');
  httpsUrl(info.appcast, 'appcast ');
  const name = `bilibili-index-translate-${info.version}.bobplugin`;
  const archivePath = join(root, 'dist', name);
  const archive = await readFile(archivePath);
  const packedInfo = JSON.parse(execFileSync('unzip', ['-p', archivePath, 'info.json'], { encoding: 'utf8' }));
  if (!isDeepStrictEqual(packedInfo, info)) throw new Error('安装包元信息与 public/info.json 不一致，请重新打包');

  const manifestPath = join(root, 'appcast.json');
  let manifest;
  try { manifest = await readJson(manifestPath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    manifest = { identifier: info.identifier, versions: [] };
  }
  if (manifest.identifier !== info.identifier || !Array.isArray(manifest.versions)) {
    throw new Error('已有 appcast 标识符或版本列表无效');
  }
  const seen = new Set();
  for (const version of manifest.versions) {
    versionParts(version.version);
    if (seen.has(version.version)) throw new Error(`appcast 包含重复版本：${version.version}`);
    seen.add(version.version);
    if (compareVersions(version.version, info.version) > 0) throw new Error('当前版本低于 appcast 中的版本，不能回退发布');
    if (typeof version.desc !== 'string' || !version.desc.trim() || !/^[a-fA-F0-9]{64}$/.test(version.sha256)) {
      throw new Error(`历史版本的更新说明或 SHA-256 无效：${version.version}`);
    }
    httpsUrl(version.url, '历史安装包下载地址');
  }
  const previous = manifest.versions.find((entry) => entry.version === info.version);
  const entry = {
    version: info.version,
    desc: desc.trim(),
    sha256: createHash('sha256').update(archive).digest('hex'),
    url: httpsUrl(url || releaseUrl(info, name), '安装包下载地址'),
    ...(info.minBobVersion ? { minBobVersion: info.minBobVersion } : {}),
    timestamp: Number.isSafeInteger(previous?.timestamp) && previous.timestamp >= 1e12 ? previous.timestamp : now,
  };
  manifest.versions = [entry, ...manifest.versions.filter((item) => item.version !== info.version)]
    .sort((a, b) => compareVersions(b.version, a.version));
  const temporaryPath = `${manifestPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temporaryPath, manifestPath);
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { desc: { type: 'string' }, url: { type: 'string' } } });
    const manifest = await updateAppcast(values);
    console.log(`appcast.json 已更新：${manifest.versions[0].version}，SHA-256 ${manifest.versions[0].sha256}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
