import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StoryStore } from '../mcp/store.mjs';
import { hook } from '../hooks/recover.mjs';
import { setupProject } from '../scripts/setup-project.mjs';
import { validate, ROOT } from '../scripts/validate.mjs';
import { zip } from '../scripts/build-release.mjs';
import { invoke } from '../scripts/tool-call.mjs';
import { fixture } from './helpers.mjs';

test('setup preserves unrelated config and is idempotent', async t => {
  const f = await fixture(t), options = { workspace: f.workspace, projectRoot: f.projectRoot, projectId: 'demo' };
  await fs.mkdir(path.join(f.workspace, '.codex'));
  await fs.writeFile(path.join(f.workspace, '.codex/config.toml'), 'model_verbosity = "low"\n');
  await setupProject(options);
  const configPath = path.join(f.workspace, '.codex/config.toml'), first = await fs.readFile(configPath, 'utf8');
  const reviewerPath = path.join(f.workspace, '.codex/agents/story-reviewer.toml');
  const firstReviewer = await fs.readFile(reviewerPath, 'utf8');
  await setupProject(options);
  assert.equal(await fs.readFile(configPath, 'utf8'), first);
  assert.equal(await fs.readFile(reviewerPath, 'utf8'), firstReviewer);
  assert.ok(firstReviewer.includes(path.join(ROOT, 'skills/seedance-script-review/SKILL.md').split(path.sep).join('/')));
  assert.ok(!firstReviewer.includes('{{'));
  await fs.unlink(reviewerPath); // Upgrade an existing workspace that only has the keeper.
  await setupProject(options);
  assert.equal(await fs.readFile(reviewerPath, 'utf8'), firstReviewer);
  assert.equal(await fs.readFile(configPath, 'utf8'), first);
  assert.ok(first.startsWith('model_verbosity = "low"'));
  assert.equal((first.match(/\[mcp_servers.ai_story_studio\]/g) || []).length, 1);
  assert.ok((await fs.readFile(path.join(f.workspace, '.codex/agents/story-keeper.toml'), 'utf8')).includes('shell_tool = false'));
});
test('setup preserves a custom reviewer before changing config or keeper', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.workspace, '.codex/agents'), { recursive: true });
  const reviewer = path.join(f.workspace, '.codex/agents/story-reviewer.toml');
  const config = path.join(f.workspace, '.codex/config.toml');
  await fs.writeFile(reviewer, 'custom = true\n');
  await fs.writeFile(config, 'model_verbosity = "low"\n');
  await assert.rejects(setupProject({ workspace: f.workspace, projectRoot: f.projectRoot, projectId: 'demo' }), /已有 story-reviewer/);
  assert.equal(await fs.readFile(reviewer, 'utf8'), 'custom = true\n');
  assert.equal(await fs.readFile(config, 'utf8'), 'model_verbosity = "low"\n');
  await assert.rejects(fs.access(path.join(f.workspace, '.codex/agents/story-keeper.toml')));
});
test('setup preserves an existing custom keeper', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.workspace, '.codex/agents'), { recursive: true });
  const role = path.join(f.workspace, '.codex/agents/story-keeper.toml'); await fs.writeFile(role, 'custom = true\n');
  await assert.rejects(setupProject({ workspace: f.workspace, projectRoot: f.projectRoot, projectId: 'demo' }), /已有 story-keeper/);
  assert.equal(await fs.readFile(role, 'utf8'), 'custom = true\n');
});
test('setup refuses redirected configuration before touching external files', async t => {
  const f = await fixture(t), external = path.join(f.workspace, 'external-config');
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, 'config.toml'), 'original = true\n');
  await fs.symlink(external, path.join(f.workspace, '.codex'), 'junction');
  await assert.rejects(setupProject({ workspace: f.workspace, projectRoot: f.projectRoot, projectId: 'demo' }), /重定向/);
  assert.equal(await fs.readFile(path.join(external, 'config.toml'), 'utf8'), 'original = true\n');
});
test('three compression event cycles recover latest constraints from fresh stores', async t => {
  const f = await fixture(t); await setupProject({ workspace: f.workspace, projectRoot: f.projectRoot, projectId: 'demo' });
  for (let cycle = 1; cycle <= 3; cycle++) {
    const store = new StoryStore({ workspace: f.workspace }), current = await store.state(f.arg);
    await store.put({ ...f.arg, expected_revision: current.revision, records: [{ id: 'C1', type: 'constraint', data: { text: '主角不能杀人', cycle } }] });
    const state = await store.state(f.arg);
    await store.checkpoint({ ...f.arg, expected_revision: state.revision, summary: `完成第${cycle}集`, next_step: `第${cycle + 1}集` });
    await hook({ cwd: f.workspace, hook_event_name: 'PreCompact', trigger: 'auto' });
    const result = await hook({ cwd: f.workspace, hook_event_name: 'SessionStart', source: 'compact' });
    assert.ok(result.hookSpecificOutput.additionalContext.includes(`revision=${cycle}`));
    const recovered = await new StoryStore({ workspace: f.workspace }).recover(f.arg);
    assert.equal(recovered.constraints[0].data.text, '主角不能杀人');
    assert.equal(recovered.constraints[0].data.cycle, cycle);
    assert.equal(recovered.checkpointCurrent, true);
  }
  assert.equal((await fs.readdir(path.join(f.projectRoot, '.story-studio/snapshots'))).length, 3);
});
test('unrelated workspace receives no recovery injection', async t => {
  const f = await fixture(t);
  assert.deepEqual(await hook({ cwd: f.workspace, hook_event_name: 'SessionStart' }), { continue: true });
});
test('MCP stdio lists 15 tools and reports failed calls as tool errors', async t => {
  const f = await fixture(t);
  const listed = await invoke('--list', {}, { workspace: f.workspace });
  assert.equal(listed.tools.length, 15);
  const result = await invoke('studio_open_project', { ...f.arg, project_id: 'demo' }, { workspace: f.workspace });
  assert.equal(result.structuredContent.revision, 0);
  assert.equal(result.isError, false);
  const invalid = await invoke('studio_put_records', f.arg, { workspace: f.workspace });
  assert.equal(invalid.isError, true);
  assert.ok(invalid.content[0].text.includes('INVALID_ARGUMENTS'));
});
test('keeper guidance can be read over MCP without shell or arbitrary file access', async () => {
  const result = await invoke('studio_read_guidance', { resource: 'skill' });
  assert.equal(result.isError, false);
  assert.ok(result.structuredContent.content.includes('不修改剧本正文'));
  const denied = await invoke('studio_read_guidance', { resource: '../../.env' });
  assert.equal(denied.isError, true);
});
test('all portable and compatibility resources validate', async () => {
  const result = await validate(ROOT);
  assert.equal(result.skills.length, 6);
  assert.equal(result.runtimeDependencies, 0);
});
test('ZIP entries use UTF-8 and deterministic compressed headers', () => {
  const entries = [{ name: 'ai-story-studio/中文.txt', content: Buffer.from('可恢复的原稿', 'utf8') }];
  const archive = zip(entries);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.readUInt16LE(6), 0x800);
  assert.deepEqual(archive, zip(entries));
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
});
