import fs from 'node:fs/promises';
import path from 'node:path';

export async function derivedManifests(root) {
  const portable = JSON.parse(await fs.readFile(path.join(root, 'plugin.json'), 'utf8'));
  const mcp = JSON.parse(await fs.readFile(path.join(root, 'mcp.json'), 'utf8'));
  const extension = portable.extensions['com.openai'];
  const compatibility = { name: portable.name, version: portable.version, description: portable.description, author: portable.author, license: portable.license, skills: './skills/', mcpServers: './.mcp.json', interface: extension.interface, hooks: extension.hooks, requires_local_executor: extension.requires_local_executor, extensions: { 'com.openai': { onboardingSkill: extension.onboardingSkill } } };
  return { '.codex-plugin/plugin.json': compatibility, '.mcp.json': { mcpServers: mcp.mcpServers } };
}
export async function writeManifests(root) {
  for (const [relative, value] of Object.entries(await derivedManifests(root))) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), JSON.stringify(value, null, 2) + '\n', 'utf8');
  }
}
