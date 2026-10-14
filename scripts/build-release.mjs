#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { ROOT, validate, walk } from './validate.mjs';
import { writeManifests } from './manifests.mjs';

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = buffer => { let crc = 0xffffffff; for (const value of buffer) crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
export function zip(entries) {
  const chunks = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8'), compressed = deflateRawSync(entry.content), crc = crc32(entry.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x21, 12); // Reproducible timestamp: 1980-01-01.
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(entry.content.length, 22); local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, compressed);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x800, 8); header.writeUInt16LE(8, 10); header.writeUInt16LE(0x21, 14);
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(compressed.length, 20); header.writeUInt32LE(entry.content.length, 24); header.writeUInt16LE(name.length, 28); header.writeUInt32LE(offset, 42);
    central.push(header, name); offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
export async function build(root = ROOT, output = path.join(root, 'dist')) {
  await writeManifests(root);
  const checked = await validate(root);
  // Deliberate allowlist: no project data, Git metadata, local config, credentials or QA logs.
  const names = ['plugin.json', 'mcp.json', '.mcp.json', '.codex-plugin', '.agents', '.gitignore', '.gitattributes', 'skills', 'assets', 'mcp', 'hooks', 'scripts', 'tests', 'docs', 'examples', 'README.md', 'LICENSE', 'CHANGELOG.md', 'package.json'];
  const files = [];
  for (const name of names) {
    const full = path.join(root, name), stat = await fs.lstat(full);
    if (stat.isSymbolicLink()) throw new Error('发布源不能是符号链接。');
    if (stat.isDirectory()) files.push(...await walk(full)); else files.push(full);
  }
  const entries = [];
  for (const file of files.sort()) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (/(^|\/)(\.story-studio|\.codex|\.env(?:\..*)?|node_modules|__pycache__)(\/|$)/.test(relative) || /\.(log|tmp|pyc)$/.test(relative)) continue;
    entries.push({ name: 'ai-story-studio/' + relative, content: await fs.readFile(file) });
  }
  const archive = zip(entries);
  await fs.mkdir(output, { recursive: true });
  const archiveName = `AI-Story-Studio-v${checked.version}.zip`;
  await fs.writeFile(path.join(output, archiveName), archive);
  const digest = createHash('sha256').update(archive).digest('hex');
  await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), `${digest}  ${archiveName}\n`, 'utf8');
  return { version: checked.version, files: entries.length, archive: path.join(output, archiveName), sha256: digest, bytes: archive.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await build()));
