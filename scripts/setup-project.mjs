#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StoryStore } from '../mcp/store.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START = '# >>> AI Story Studio managed';
const END = '# <<< AI Story Studio managed';
const portable = value => value.split(path.sep).join('/');
const toml = value => JSON.stringify(portable(value));
const shell = value => '"' + portable(value).replaceAll('"', '\\"') + '"';
async function readOrEmpty(file) { try { return await fs.readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; } }
async function refuseRedirect(target) {
  try { if (await fs.realpath(target) !== target) throw new Error('配置或项目路径存在重定向，停止以免修改其他目录：' + target); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function setupProject({ workspace, projectRoot, projectId, title }) {
  if (!path.isAbsolute(workspace) || !path.isAbsolute(projectRoot)) throw new Error('workspace 和 project-root 须为绝对路径。');
  const workspaceRoot = await fs.realpath(workspace);
  const relative = path.relative(workspaceRoot, path.resolve(projectRoot));
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('project-root 必须位于 workspace 内。');
  if (path.resolve(projectRoot) === pluginRoot || path.resolve(projectRoot).startsWith(pluginRoot + path.sep)) throw new Error('请选择插件源码之外的独立创作目录。');
  let ancestor = path.resolve(projectRoot);
  while (true) {
    try { await fs.access(ancestor); break; } catch (error) { if (error.code !== 'ENOENT') throw error; ancestor = path.dirname(ancestor); }
  }
  await refuseRedirect(ancestor);
  await fs.mkdir(projectRoot, { recursive: true });
  const actualProject = await fs.realpath(projectRoot);
  const configDir = path.join(workspaceRoot, '.codex');
  const agentsDir = path.join(configDir, 'agents');
  const configPath = path.join(configDir, 'config.toml');
  const rolePath = path.join(agentsDir, 'story-keeper.toml');
  for (const target of [configDir, agentsDir, configPath, rolePath, path.join(workspaceRoot, '.story-studio-workspace.json')]) await refuseRedirect(target);
  const role = (await fs.readFile(path.join(pluginRoot, 'assets/codex/story-keeper.toml'), 'utf8')).replaceAll('{{KEEPER_SKILL_PATH}}', portable(path.join(pluginRoot, 'skills/keep-story-memory/SKILL.md')));
  const existingRole = await readOrEmpty(rolePath);
  if (existingRole && existingRole !== role) throw new Error('已有 story-keeper 角色配置不同；保留现有文件，先比较后再更新。');
  const existingConfig = await readOrEmpty(configPath);
  const start = existingConfig.indexOf(START), end = existingConfig.indexOf(END);
  if ((start >= 0) !== (end >= 0) || start >= 0 && end < start) throw new Error('已有托管配置标记不完整，停止以免覆盖。');
  const outside = start >= 0 ? existingConfig.slice(0, start) + existingConfig.slice(end + END.length) : existingConfig;
  if (/^\s*\[mcp_servers\.ai_story_studio\]\s*$/m.test(outside)) throw new Error('已有 ai_story_studio MCP 配置；先比较再更新。');
  const hookCommand = `${shell(process.execPath)} ${shell(path.join(pluginRoot, 'hooks/recover.mjs'))} --workspace ${shell(workspaceRoot)}`;
  const block = [START, '[mcp_servers.ai_story_studio]', `command = ${toml(process.execPath)}`, `args = [${toml(path.join(pluginRoot, 'mcp/server.mjs'))}, "--workspace", ${toml(workspaceRoot)}]`, `cwd = ${toml(workspaceRoot)}`, 'startup_timeout_sec = 20', '', '[[hooks.SessionStart]]', 'matcher = "startup|resume|compact|fork"', '[[hooks.SessionStart.hooks]]', 'type = "command"', `command = ${JSON.stringify(hookCommand)}`, 'timeout = 20', '', '[[hooks.PreCompact]]', 'matcher = "manual|auto"', '[[hooks.PreCompact.hooks]]', 'type = "command"', `command = ${JSON.stringify(hookCommand)}`, 'timeout = 20', END, ''].join('\n');
  const config = start >= 0 ? existingConfig.slice(0, start) + block + existingConfig.slice(end + END.length).replace(/^\r?\n/, '') : existingConfig.trimEnd() + (existingConfig.trim() ? '\n\n' : '') + block;
  const store = new StoryStore({ workspace: workspaceRoot, pluginRoot });
  const opened = await store.open({ project_root: actualProject, project_id: projectId, title });
  await fs.mkdir(agentsDir, { recursive: true });
  // Back up only when changing an existing project config. Never edit user-level config.
  if (existingConfig && existingConfig !== config) await fs.writeFile(configPath + `.bak-${Date.now()}`, existingConfig, { flag: 'wx' });
  await fs.writeFile(rolePath, role, 'utf8');
  await fs.writeFile(configPath, config, 'utf8');
  await fs.writeFile(path.join(workspaceRoot, '.story-studio-workspace.json'), JSON.stringify({ formatVersion: 1, projectRoot: actualProject, projectId }, null, 2) + '\n', 'utf8');
  return { ...opened, workspace: workspaceRoot, role: rolePath, config: configPath, workspaceTrustRequired: true, hookTrustRequired: true, next: '在该工作区开启新的 Codex 会话；确认工作区已受信任，再按宿主提示审阅并信任 Hooks，然后调用 $story-studio。' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  const allowed = new Set(['workspace', 'project-root', 'project-id', 'title']);
  try {
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i].replace(/^--/, '');
      if (!args[i].startsWith('--') || !allowed.has(key) || !args[i + 1]) throw new Error('参数无效。');
      options[key] = args[i + 1];
    }
    if (!options.workspace || !options['project-root'] || !options['project-id']) throw new Error('Usage: node scripts/setup-project.mjs --workspace ABS --project-root ABS --project-id ID [--title TITLE]');
    console.log(JSON.stringify(await setupProject({ workspace: options.workspace, projectRoot: options['project-root'], projectId: options['project-id'], title: options.title })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
