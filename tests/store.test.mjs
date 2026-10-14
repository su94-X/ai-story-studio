import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StoryStore } from '../mcp/store.mjs';
import { fixture, draft, thread, code } from './helpers.mjs';

test('project identity is stable and opening is idempotent', async t => {
  const f = await fixture(t);
  assert.equal((await f.store.open({ ...f.arg, project_id: 'demo' })).created, false);
  await assert.rejects(f.store.open({ ...f.arg, project_id: 'other' }), code('PROJECT_ID_MISMATCH'));
  assert.equal((await f.store.state(f.arg)).projectId, 'demo');
});
test('free-form knowledge and revision history survive updates', async t => {
  const f = await fixture(t);
  await f.store.put({ ...f.arg, expected_revision: 0, records: [{ id: 'K1', type: 'sound-motif', data: { summary: '雨声从焦虑变成安宁', custom: { phases: [1, 3] } } }] });
  assert.deepEqual((await f.store.state({ ...f.arg, ids: ['K1'] })).records.K1.data.custom.phases, [1, 3]);
  assert.equal((await f.store.state({ ...f.arg, revision: 0 })).records.K1, undefined);
  assert.equal((await f.store.compare({ ...f.arg, from_revision: 0, to_revision: 1 })).changes.records[0].id, 'K1');
});
test('invalid batch cannot partly commit', async t => {
  const f = await fixture(t);
  await assert.rejects(f.store.put({ ...f.arg, expected_revision: 0, records: [{ id: 'A', type: 'constraint', data: { text: '保留结局' } }, { id: 'B', type: 'thread', data: { promise: '测试', required: true, status: 'paid_off' } }] }), code('PLANT_EVIDENCE_REQUIRED'));
  assert.equal((await f.store.state(f.arg)).revision, 0);
  assert.deepEqual((await f.store.state(f.arg)).records, {});
});
test('two writers cannot overwrite one another', async t => {
  const f = await fixture(t), second = new StoryStore({ workspace: f.workspace });
  const results = await Promise.allSettled([f.store.put({ ...f.arg, expected_revision: 0, records: [{ id: 'A', type: 'decision', data: {} }] }), second.put({ ...f.arg, expected_revision: 0, records: [{ id: 'B', type: 'decision', data: {} }] })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(['PROJECT_BUSY', 'REVISION_CONFLICT'].includes(results.find(r => r.status === 'rejected').reason.code));
  assert.equal(Object.keys((await f.store.state(f.arg)).records).length, 1);
});
test('old revision cannot replace newer constraint', async t => {
  const f = await fixture(t);
  await f.store.put({ ...f.arg, expected_revision: 0, records: [{ id: 'C1', type: 'constraint', data: { text: '无死亡结局' } }] });
  await assert.rejects(f.store.put({ ...f.arg, expected_revision: 0, records: [{ id: 'C1', type: 'constraint', data: { text: '悲剧' } }] }), code('REVISION_CONFLICT'));
  assert.equal((await f.store.state(f.arg)).records.C1.data.text, '无死亡结局');
});
test('planned thread does not count as planted', async t => {
  const f = await fixture(t);
  await f.store.put({ ...f.arg, expected_revision: 0, records: [{ id: 'F1', type: 'thread', data: { promise: '钥匙', required: true, status: 'planned' } }] });
  assert.equal((await f.store.audit(f.arg)).pendingRequiredThreads.length, 1);
  await assert.rejects(f.store.put({ ...f.arg, expected_revision: 1, records: [{ id: 'F1', type: 'thread', data: { promise: '钥匙', required: true, status: 'planted' } }] }), code('PLANT_EVIDENCE_REQUIRED'));
});
test('quotes must exist at the claimed location', async t => {
  const f = await fixture(t); await draft(f);
  await assert.rejects(f.store.anchor({ ...f.arg, document_id: 'DRAFT', quote: '不存在的对白' }), code('QUOTE_NOT_FOUND'));
  await assert.rejects(f.store.anchor({ ...f.arg, document_id: 'DRAFT', quote: '钥匙红线的结向左。', start_line: 1 }), code('QUOTE_LINE_MISMATCH'));
});
test('ambiguous quotes need correct explicit line', async t => {
  const f = await fixture(t); await draft(f, '停。\n走。\n停。\n');
  await assert.rejects(f.store.anchor({ ...f.arg, document_id: 'DRAFT', quote: '停。' }), code('AMBIGUOUS_QUOTE'));
  assert.equal((await f.store.anchor({ ...f.arg, document_id: 'DRAFT', quote: '停。', start_line: 3 })).start_line, 3);
});
test('CRLF originals permit multi-line textual evidence', async t => {
  const f = await fixture(t); await draft(f, '门开了。\r\n红线向左。\r\n');
  const anchor = await f.store.anchor({ ...f.arg, document_id: 'DRAFT', quote: '门开了。\n红线向左。' });
  assert.equal(anchor.end_line, 2);
  assert.equal((await f.store.document({ ...f.arg, document_id: 'DRAFT' })).content, '门开了。\n红线向左。\n');
});
test('original changes stale old evidence but retain snapshots', async t => {
  const f = await fixture(t); await draft(f); const record = await thread(f, true);
  const oldHash = record.data.plant_refs[0].document_hash;
  await f.store.put({ ...f.arg, expected_revision: 1, records: [record] });
  await fs.appendFile(path.join(f.projectRoot, '剧本.md'), '新场次。\n');
  assert.equal((await f.store.audit(f.arg)).issues[0].code, 'DOCUMENT_CHANGED');
  await assert.rejects(f.store.anchor({ ...f.arg, document_id: 'DRAFT', quote: '钥匙红线的结向左。' }), code('DOCUMENT_CHANGED'));
  await f.store.register({ ...f.arg, document_id: 'DRAFT', path: '剧本.md', expected_revision: 2 });
  assert.equal((await f.store.audit(f.arg)).issues[0].code, 'INVALID_EVIDENCE');
  assert.ok((await f.store.document({ ...f.arg, document_id: 'DRAFT', document_hash: oldHash })).content.includes('主动换回'));
});
test('historical reads identify the snapshot instead of a newer source path', async t => {
  const f = await fixture(t); await draft(f);
  const original = await f.store.document({ ...f.arg, document_id: 'DRAFT' });
  await fs.writeFile(path.join(f.projectRoot, '剧本-v2.md'), '新版正文。\n');
  await f.store.register({ ...f.arg, document_id: 'DRAFT', path: '剧本-v2.md', expected_revision: 1 });
  const historical = await f.store.document({ ...f.arg, document_id: 'DRAFT', document_hash: original.hash });
  assert.equal(historical.sourceKind, 'snapshot');
  assert.equal(historical.path, `.story-studio/documents/DRAFT/${original.hash}.txt`);
  assert.equal(historical.registeredPath, '剧本-v2.md');
  assert.equal(historical.registeredCurrent, false);
  assert.equal(historical.content, original.content);
  const current = await f.store.document({ ...f.arg, document_id: 'DRAFT' });
  assert.equal(current.sourceKind, 'working-copy');
  assert.equal(current.path, '剧本-v2.md');
  assert.equal(current.registeredPath, current.path);
  assert.equal(current.registeredCurrent, true);
  const currentSnapshot = await f.store.document({ ...f.arg, document_id: 'DRAFT', document_hash: current.hash });
  assert.equal(currentSnapshot.sourceKind, 'snapshot');
  assert.equal(currentSnapshot.registeredCurrent, true);
  assert.equal(currentSnapshot.path, `.story-studio/documents/DRAFT/${current.hash}.txt`);
});

test('paid off requires both plant and payoff evidence', async t => {
  const f = await fixture(t); await draft(f); const record = await thread(f, true);
  const missing = structuredClone(record); missing.data.payoff_refs = [];
  await assert.rejects(f.store.put({ ...f.arg, expected_revision: 1, records: [missing] }), code('PAYOFF_EVIDENCE_REQUIRED'));
  await f.store.put({ ...f.arg, expected_revision: 1, records: [record] });
  assert.equal((await f.store.audit(f.arg)).structuralPass, true);
  assert.equal((await f.store.audit(f.arg)).semanticReviewRequired, true);
});
test('mandatory threads cannot be silently downgraded or retagged', async t => {
  const f = await fixture(t); await draft(f); const record = await thread(f);
  await f.store.put({ ...f.arg, expected_revision: 1, records: [record] }); record.data.required = false;
  await assert.rejects(f.store.put({ ...f.arg, expected_revision: 2, records: [record] }), code('USER_DECISION_REQUIRED'));
  await assert.rejects(f.store.put({ ...f.arg, expected_revision: 2, records: [{ id: 'F001', type: 'note', data: {} }] }), code('RECORD_TYPE_IMMUTABLE'));
});
test('cancellation is tied to user decision; old state remains readable', async t => {
  const f = await fixture(t); await draft(f); const record = await thread(f);
  await f.store.put({ ...f.arg, expected_revision: 1, records: [record] }); record.data.status = 'cancelled'; record.data.decision_id = 'U1';
  await assert.rejects(f.store.put({ ...f.arg, expected_revision: 2, records: [record] }), code('USER_DECISION_REQUIRED'));
  await f.store.put({ ...f.arg, expected_revision: 2, records: [{ id: 'U1', type: 'decision', data: { origin: 'user', quote: '删除钥匙调包这条支线。' } }, record] });
  assert.equal((await f.store.audit(f.arg)).structuralPass, true);
  assert.equal((await f.store.state({ ...f.arg, revision: 2 })).records.F001.data.status, 'planted');
});
test('checkpoints survive process restart but cannot override new decisions', async t => {
  const f = await fixture(t);
  await f.store.put({ ...f.arg, expected_revision: 0, records: [{ id: 'C1', type: 'constraint', data: { text: '保住钥匙' } }] });
  await f.store.checkpoint({ ...f.arg, expected_revision: 1, summary: '已确认保住钥匙', next_step: '写第二场' });
  assert.equal((await new StoryStore({ workspace: f.workspace }).recover(f.arg)).checkpointCurrent, true);
  await f.store.put({ ...f.arg, expected_revision: 1, records: [{ id: 'C1', type: 'constraint', data: { text: '保住钥匙并修复信任' } }] });
  const recovered = await new StoryStore({ workspace: f.workspace }).recover(f.arg);
  assert.equal(recovered.checkpointCurrent, false); assert.equal(recovered.constraints[0].data.text, '保住钥匙并修复信任');
  await assert.rejects(f.store.checkpoint({ ...f.arg, expected_revision: 1, summary: '旧摘要', next_step: '' }), code('REVISION_CONFLICT'));
});
test('structure alone cannot finalize; pending threads block pass', async t => {
  const f = await fixture(t); await draft(f);
  await assert.rejects(f.store.finalize({ ...f.arg, expected_revision: 1 }), code('FRESH_REVIEW_REQUIRED'));
  await f.store.put({ ...f.arg, expected_revision: 1, records: [await thread(f)] });
  await assert.rejects(f.store.review({ ...f.arg, expected_revision: 2, verdict: 'pass', findings: [], summary: '通过' }), code('REVIEW_NOT_CLEAR'));
  await assert.rejects(f.store.finalize({ ...f.arg, expected_revision: 2 }), code('FINALIZATION_BLOCKED'));
});
test('fresh review permits finalization, and reopening requires another review', async t => {
  const f = await fixture(t); await draft(f);
  await f.store.put({ ...f.arg, expected_revision: 1, records: [await thread(f, true)] });
  await f.store.review({ ...f.arg, expected_revision: 2, verdict: 'pass', findings: [], summary: '两场均已读，信息和主动选择相连。' });
  assert.equal((await f.store.finalize({ ...f.arg, expected_revision: 3 })).status, 'finalized');
  await assert.rejects(f.store.put({ ...f.arg, expected_revision: 4, records: [{ id: 'NEW', type: 'note', data: {} }] }), code('PROJECT_FINALIZED'));
  await f.store.reopen({ ...f.arg, expected_revision: 4, reason: '用户要求调整结尾' });
  await assert.rejects(f.store.finalize({ ...f.arg, expected_revision: 5 }), code('FRESH_REVIEW_REQUIRED'));
});
test('index update invalidates existing review', async t => {
  const f = await fixture(t); await draft(f);
  await f.store.review({ ...f.arg, expected_revision: 1, verdict: 'pass', findings: [], summary: '正文已审查' });
  await f.store.put({ ...f.arg, expected_revision: 2, records: [{ id: 'I1', type: 'index', data: { summary: '变化' } }] });
  await assert.rejects(f.store.finalize({ ...f.arg, expected_revision: 3 }), code('FRESH_REVIEW_REQUIRED'));
});
test('source and workspace boundaries are enforced', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.workspace, 'outside.md'), '外部原稿');
  await assert.rejects(f.store.register({ ...f.arg, document_id: 'X', path: '../outside.md', expected_revision: 0 }), code('PATH_ESCAPE'));
  await assert.rejects(f.store.open({ project_root: path.dirname(f.workspace), project_id: 'bad' }), code('OUTSIDE_WORKSPACE'));
  await assert.rejects(new StoryStore({ workspace: f.workspace, pluginRoot: f.projectRoot }).state(f.arg), code('PLUGIN_IS_NOT_PROJECT'));
});
test('redirected metadata directory is refused', async t => {
  const f = await fixture(t), fresh = path.join(f.workspace, 'linked'); await fs.mkdir(fresh);
  await fs.symlink(path.join(f.projectRoot, '.story-studio'), path.join(fresh, '.story-studio'), 'junction');
  await assert.rejects(f.store.open({ project_root: fresh, project_id: 'demo' }), code('SYMLINK_NOT_ALLOWED'));
});
test('leftover lock is visible and does not delete historical data', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.projectRoot, '.story-studio/write.lock'), '{"pid":99999999}');
  await assert.rejects(f.store.put({ ...f.arg, expected_revision: 0, records: [{ id: 'A', type: 'note', data: {} }] }), code('PROJECT_BUSY'));
  assert.equal((await f.store.state(f.arg)).revision, 0);
});
test('large indexes are paginated without dropping hard constraints', async t => {
  const f = await fixture(t);
  const records = Array.from({ length: 100 }, (_, i) => ({ id: 'K' + i, type: 'note', data: { summary: '记录' + i } }));
  await f.store.put({ ...f.arg, expected_revision: 0, records });
  await f.store.put({ ...f.arg, expected_revision: 1, records: [{ id: 'C1', type: 'constraint', data: { text: '锁定结局' } }, { id: 'K100', type: 'note', data: { summary: '末项' } }] });
  const first = await f.store.state(f.arg), second = await f.store.state({ ...f.arg, offset: first.recordPage.nextOffset });
  assert.equal(Object.keys(first.records).length, 100); assert.equal(Object.keys(second.records).length, 2);
  const capsule = await f.store.recover({ ...f.arg, index_limit: 10 });
  assert.equal(capsule.index.length, 10); assert.equal(capsule.indexPage.total, 102);
  assert.equal(capsule.constraints[0].data.text, '锁定结局');
});
test('generic index evidence is checked against actual original', async t => {
  const f = await fixture(t); await draft(f);
  const ref = await f.store.anchor({ ...f.arg, document_id: 'DRAFT', quote: '钥匙红线的结向左。' });
  ref.start_line = 4; ref.end_line = 4;
  await assert.rejects(f.store.put({ ...f.arg, expected_revision: 1, records: [{ id: 'I1', type: 'index', data: { refs: [ref] } }] }), code('INVALID_EVIDENCE'));
});
