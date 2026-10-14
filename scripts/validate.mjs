#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { derivedManifests } from './manifests.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function walk(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('发布目录不能含符号链接：' + entry.name);
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}
export async function validate(root = ROOT) {
  const errors = [];
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'plugin.json'), 'utf8'));
  if (pkg.version !== manifest.version) errors.push('package.json 与插件版本不同。');
  for (const [relative, expected] of Object.entries(await derivedManifests(root))) {
    try { if (JSON.stringify(JSON.parse(await fs.readFile(path.join(root, relative), 'utf8'))) !== JSON.stringify(expected)) errors.push('派生清单过期：' + relative); }
    catch { errors.push('派生清单缺失或无效：' + relative); }
  }
  const skills = [], files = await walk(path.join(root, 'skills'));
  let localLinks = 0;
  for (const file of files) {
    if (path.basename(file) === 'SKILL.md') {
      const text = await fs.readFile(file, 'utf8');
      const header = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const name = header?.[1].match(/^name:\s*([a-z0-9-]+)\s*$/m)?.[1];
      if (!name || !header[1].match(/^description:\s*\S/m)) errors.push('Skill frontmatter 无效：' + file);
      else skills.push(name);
      if (name && path.basename(path.dirname(file)) !== name) errors.push('Skill 目录与 name 不同：' + file);
    }
    if (!file.endsWith('.md')) continue;
    const text = await fs.readFile(file, 'utf8');
    for (const match of text.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
      const link = match[1];
      if (link.includes('://') || link.startsWith('#')) continue;
      localLinks++;
      const target = path.resolve(path.dirname(file), link.split('#')[0]);
      const relative = path.relative(root, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) errors.push('资源链接越界：' + link);
      else try { await fs.access(target); } catch { errors.push('资源链接缺失：' + file + ' -> ' + link); }
    }
  }
  if (new Set(skills).size !== skills.length) errors.push('同名 Skill 重复。');
  for (const shared of ['references/project-contract.md', 'assets/project-card.md']) {
    if ((await fs.readFile(path.join(root, 'skills/select-story', shared), 'utf8')) !== (await fs.readFile(path.join(root, 'skills/write-screenplay', shared), 'utf8'))) errors.push('共享交接资源不同步：' + shared);
  }
  const interfaceFields = manifest.extensions['com.openai'].interface;
  for (const key of ['composerIcon', 'logo']) try { await fs.access(path.join(root, interfaceFields[key])); } catch { errors.push('图标缺失：' + key); }
  const hooks = JSON.parse(await fs.readFile(path.join(root, 'hooks/hooks.json'), 'utf8'));
  if (!hooks.hooks.SessionStart || !hooks.hooks.PreCompact) errors.push('恢复 Hooks 缺失。');
  if (errors.length) throw new Error(errors.join('\n'));
  return { version: manifest.version, skills, localLinks, runtimeDependencies: 0 };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await validate())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
