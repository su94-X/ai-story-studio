import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { StoryStore } from '../mcp/store.mjs';

export async function fixture(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'story-studio-test-'));
  const projectRoot = path.join(workspace, 'project'); await fs.mkdir(projectRoot);
  t.after(async () => {
    const relative = path.relative(os.tmpdir(), workspace);
    assert.ok(!path.isAbsolute(relative) && !relative.startsWith('..') && path.basename(workspace).startsWith('story-studio-test-'));
    await fs.rm(workspace, { recursive: true, force: true });
  });
  const store = new StoryStore({ workspace });
  await store.open({ project_root: projectRoot, project_id: 'demo', title: '红线钥匙' });
  return { workspace, projectRoot, store, arg: { project_root: projectRoot } };
}
export async function draft(f, content = '01 内景 门厅—夜\n钥匙红线的结向左。\n02 内景 门厅—夜\n她发现钥匙红线的结向右，主动换回原钥匙。\n') {
  await fs.writeFile(path.join(f.projectRoot, '剧本.md'), content, 'utf8');
  return f.store.register({ ...f.arg, document_id: 'DRAFT', path: '剧本.md', expected_revision: (await f.store.state(f.arg)).revision });
}
export async function thread(f, paid = false) {
  const plant = await f.store.anchor({ ...f.arg, document_id: 'DRAFT', quote: '钥匙红线的结向左。', scene_id: 'SC01' });
  const payoff = await f.store.anchor({ ...f.arg, document_id: 'DRAFT', quote: '她发现钥匙红线的结向右，主动换回原钥匙。', scene_id: 'SC02' });
  return { id: 'F001', type: 'thread', data: { required: true, promise: '绳结方向揭示调包并引出行动', status: paid ? 'paid_off' : 'planted', plant_refs: [plant], payoff_refs: paid ? [payoff] : [] } };
}
export const code = expected => error => error.code === expected;
