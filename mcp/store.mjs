import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const FORMAT_VERSION = 2;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const MAX_FILE = 5 * 1024 * 1024;
const THREAD_STATES = new Set(['planned', 'planted', 'developing', 'paid_off', 'cancelled', 'deferred']);
export const hash = text => createHash('sha256').update(text).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const inside = (root, target) => target === root || (!path.relative(root, target).startsWith('..' + path.sep) && path.relative(root, target) !== '..' && !path.isAbsolute(path.relative(root, target)));
const clone = value => structuredClone(value);

export class StudioError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}
function requireValue(condition, code, message, details) {
  if (!condition) throw new StudioError(code, message, details);
}
function validId(id) { requireValue(typeof id === 'string' && ID.test(id), 'INVALID_ID', 'ID 必须为 1—96 个英文字母、数字、点、下划线或连字符。'); }
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

export class StoryStore {
  constructor({ workspace, pluginRoot } = {}) {
    this.workspace = workspace ? path.resolve(workspace) : undefined;
    this.pluginRoot = pluginRoot ? path.resolve(pluginRoot) : undefined;
  }
  async guidance({ resource }) {
    const resources = { skill: 'SKILL.md', records: 'references/records.md', foreshadowing: 'references/foreshadowing.md', recovery: 'references/recovery.md' };
    requireValue(this.pluginRoot && Object.hasOwn(resources, resource), 'GUIDANCE_NOT_FOUND', '请选择 skill、records、foreshadowing 或 recovery。');
    const relative = 'skills/keep-story-memory/' + resources[resource];
    const file = await fs.realpath(path.join(this.pluginRoot, relative));
    requireValue(inside(this.pluginRoot, file), 'PATH_ESCAPE', '规范文件越出插件目录。');
    return { resource, path: relative, content: await fs.readFile(file, 'utf8') };
  }
  async context(projectRoot) {
    requireValue(typeof projectRoot === 'string' && path.isAbsolute(projectRoot), 'ABSOLUTE_PATH_REQUIRED', '请传入用户选定项目的绝对路径 project_root。');
    const root = await fs.realpath(projectRoot);
    const workspace = this.workspace ? await fs.realpath(this.workspace) : undefined;
    requireValue(!workspace || inside(workspace, root), 'OUTSIDE_WORKSPACE', '项目不在当前 MCP 配置的工作区内。');
    requireValue(!this.pluginRoot || !inside(this.pluginRoot, root), 'PLUGIN_IS_NOT_PROJECT', '创作档案不能写入插件源码或安装目录；请选择独立创作项目。');
    requireValue((await fs.stat(root)).isDirectory(), 'NOT_DIRECTORY', '项目路径必须为目录。');
    const data = path.join(root, '.story-studio');
    if (await exists(data)) requireValue((await fs.realpath(data)) === data, 'SYMLINK_NOT_ALLOWED', '项目档案目录不能是符号链接或目录联接。');
    const statePath = path.join(data, 'state.json');
    if (await exists(statePath)) requireValue((await fs.realpath(statePath)) === statePath, 'SYMLINK_NOT_ALLOWED', '档案文件不能是符号链接。');
    return { root, data, statePath };
  }
  async lock(context, action) {
    await fs.mkdir(context.data, { recursive: true });
    // Refuse redirected subdirectories before any write. No automatic stale-lock deletion.
    requireValue((await fs.realpath(context.data)) === context.data, 'SYMLINK_NOT_ALLOWED', '档案目录发生重定向。');
    const lockPath = path.join(context.data, 'write.lock');
    let handle;
    try { handle = await fs.open(lockPath, 'wx'); }
    catch (error) { if (error.code === 'EEXIST') throw new StudioError('PROJECT_BUSY', '另一个写入正在进行，或上次运行遗留锁。请检查 write.lock 后重试；不要覆盖档案。'); throw error; }
    try { await handle.writeFile(json({ pid: process.pid, startedAt: new Date().toISOString() })); return await action(); }
    finally { await handle.close(); await fs.rm(lockPath, { force: true }); }
  }
  async dataFile(context, relative) {
    const file = path.resolve(context.data, relative);
    requireValue(inside(context.data, file), 'PATH_ESCAPE', '档案路径越界。');
    let parent = path.dirname(file);
    while (!(await exists(parent))) parent = path.dirname(parent);
    requireValue(inside(context.data, await fs.realpath(parent)), 'SYMLINK_NOT_ALLOWED', '档案子目录发生重定向。');
    if (await exists(file)) requireValue((await fs.realpath(file)) === file, 'SYMLINK_NOT_ALLOWED', '档案文件不能发生重定向。');
    return file;
  }
  async read(context, revision) {
    const file = revision === undefined ? context.statePath : await this.dataFile(context, `versions/${revision}.json`);
    const state = JSON.parse(await fs.readFile(file, 'utf8'));
    requireValue(state.formatVersion === FORMAT_VERSION, 'UNSUPPORTED_FORMAT', '不支持此档案格式；保留原文件，先迁移。');
    return state;
  }
  async commit(context, state) {
    state.updatedAt = new Date().toISOString();
    const content = json(state);
    const versionFile = await this.dataFile(context, `versions/${state.revision}.json`);
    // A crash can leave this prepared version ahead of state.json. Recover only by explicit comparison.
    if (await exists(versionFile)) {
      requireValue((await fs.readFile(versionFile, 'utf8')) === content, 'PREPARED_VERSION_EXISTS', '发现未完成提交的版本，请比较 versions 与 state.json 后恢复。');
    } else await atomicWrite(versionFile, content);
    await atomicWrite(context.statePath, content);
    return clone(state);
  }
  async mutate(projectRoot, expectedRevision, action) {
    requireValue(Number.isInteger(expectedRevision) && expectedRevision >= 0, 'REVISION_REQUIRED', '更新必须提供读取到的 expected_revision。');
    const context = await this.context(projectRoot);
    return this.lock(context, async () => {
      const state = await this.read(context);
      requireValue(state.revision === expectedRevision, 'REVISION_CONFLICT', '档案已被其他任务更新；先读取最新版本，再合并更新。', { expected: expectedRevision, actual: state.revision });
      requireValue(state.status !== 'finalized', 'PROJECT_FINALIZED', '项目已定稿。先明确开启新的修订，再继续修改。');
      const result = await action(state, context);
      state.revision++;
      state.review = null;
      await this.commit(context, state);
      return { revision: state.revision, ...result };
    });
  }
  async open({ project_root, project_id, title }) {
    validId(project_id);
    const context = await this.context(project_root);
    return this.lock(context, async () => {
      if (await exists(context.statePath)) {
        const state = await this.read(context);
        requireValue(state.projectId === project_id, 'PROJECT_ID_MISMATCH', '目录已有另一个项目；请读取原项目或换目录。');
        return { projectRoot: context.root, projectId: state.projectId, revision: state.revision, created: false };
      }
      const state = { formatVersion: FORMAT_VERSION, projectId: project_id, title: title || project_id, revision: 0, status: 'draft', createdAt: new Date().toISOString(), documents: {}, records: {}, review: null };
      await this.commit(context, state);
      return { projectRoot: context.root, projectId: project_id, revision: 0, created: true };
    });
  }
  async state({ project_root, revision, types, ids, offset = 0, limit = 100 }) {
    requireValue(revision === undefined || Number.isInteger(revision) && revision >= 0, 'INVALID_REVISION', '版本必须为非负整数。');
    requireValue(Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 1000, 'INVALID_PAGE', 'offset 须为非负整数，limit 须为 1—1000。');
    const state = await this.read(await this.context(project_root), revision);
    const selected = Object.entries(state.records).filter(([id, record]) => (!types || types.includes(record.type)) && (!ids || ids.includes(id)));
    state.records = Object.fromEntries(selected.slice(offset, offset + limit));
    state.recordPage = { total: selected.length, offset, limit, nextOffset: offset + limit < selected.length ? offset + limit : null };
    return state;
  }
  async source(context, relative) {
    requireValue(typeof relative === 'string' && relative.length > 0 && !path.isAbsolute(relative), 'RELATIVE_PATH_REQUIRED', '正文路径须相对项目目录。');
    const file = path.resolve(context.root, relative);
    requireValue(inside(context.root, file) && !inside(context.data, file), 'PATH_ESCAPE', '正文路径越界或指向档案自身。');
    requireValue(['.md', '.txt', '.json'].includes(path.extname(file).toLowerCase()), 'UNSUPPORTED_DOCUMENT', '支持 UTF-8 的 .md、.txt 和 .json 原稿。');
    const real = await fs.realpath(file);
    requireValue(inside(context.root, real) && !inside(context.data, real), 'PATH_ESCAPE', '正文链接指向项目以外。');
    const stat = await fs.stat(real);
    requireValue(stat.isFile() && stat.size <= MAX_FILE, 'DOCUMENT_TOO_LARGE', '单个原稿限 5 MiB；长稿按集或场次组织。');
    const bytes = await fs.readFile(real);
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replaceAll('\r\n', '\n'); }
    catch { throw new StudioError('UTF8_REQUIRED', '原稿须使用 UTF-8 编码。'); }
    return { content, hash: hash(bytes), path: path.relative(context.root, file).split(path.sep).join('/') };
  }
  async register({ project_root, document_id, path: relative, kind = 'screenplay', expected_revision }) {
    validId(document_id);
    return this.mutate(project_root, expected_revision, async (state, context) => {
      const source = await this.source(context, relative);
      const snapshot = await this.dataFile(context, `documents/${document_id}/${source.hash}.txt`);
      if (!(await exists(snapshot))) await atomicWrite(snapshot, source.content);
      state.documents[document_id] = { id: document_id, path: source.path, hash: source.hash, kind, registeredAt: new Date().toISOString() };
      return { document: clone(state.documents[document_id]) };
    });
  }
  async document({ project_root, document_id, document_hash, start_line = 1, max_lines = 200 }) {
    validId(document_id);
    requireValue(Number.isInteger(start_line) && start_line >= 1 && Number.isInteger(max_lines) && max_lines >= 1 && max_lines <= 1000, 'INVALID_RANGE', '行范围须为正整数，每次最多 1000 行。');
    const context = await this.context(project_root);
    const state = await this.read(context);
    const document = state.documents[document_id];
    requireValue(document, 'DOCUMENT_NOT_FOUND', '请先登记原稿。');
    let source, sourceKind = 'working-copy';
    if (document_hash !== undefined) {
      requireValue(/^[a-f0-9]{64}$/.test(document_hash), 'INVALID_HASH', '原稿 hash 格式错误。');
      const snapshot = await this.dataFile(context, `documents/${document_id}/${document_hash}.txt`);
      source = { content: await fs.readFile(snapshot, 'utf8'), hash: document_hash, path: path.relative(context.root, snapshot).split(path.sep).join('/') };
      sourceKind = 'snapshot';
    } else source = await this.source(context, document.path);
    const lines = source.content.split(/\r?\n/);
    return { id: document_id, path: source.path, sourceKind, registeredPath: document.path, hash: source.hash, registeredHash: document.hash, registeredCurrent: source.hash === document.hash, totalLines: lines.length, startLine: start_line, content: lines.slice(start_line - 1, start_line - 1 + max_lines).join('\n') };
  }
  async anchor({ project_root, document_id, quote, scene_id = '', start_line }) {
    validId(document_id);
    requireValue(typeof quote === 'string' && quote.length > 0 && quote.length <= 10000, 'QUOTE_REQUIRED', '请提供非空原文短引，最多 10000 字符。');
    const context = await this.context(project_root);
    const state = await this.read(context);
    const document = state.documents[document_id];
    requireValue(document, 'DOCUMENT_NOT_FOUND', '请先登记原稿。');
    const source = await this.source(context, document.path);
    requireValue(source.hash === document.hash, 'DOCUMENT_CHANGED', '原稿已变化；先重新登记版本，再建立证据定位。');
    let offset = 0;
    if (start_line !== undefined) {
      requireValue(Number.isInteger(start_line) && start_line >= 1, 'INVALID_RANGE', 'start_line 须为正整数。');
      const lines = source.content.split('\n');
      requireValue(start_line <= lines.length, 'INVALID_RANGE', 'start_line 超出原稿。');
      offset = lines.slice(0, start_line - 1).reduce((sum, line) => sum + line.length + 1, 0);
    }
    const index = source.content.indexOf(quote, offset);
    requireValue(index >= 0, 'QUOTE_NOT_FOUND', '短引未出现在登记的原稿中，不能作为埋设或回收证据。');
    requireValue(start_line !== undefined || source.content.indexOf(quote, index + 1) < 0, 'AMBIGUOUS_QUOTE', '短引多次出现；补充 start_line 或使用更具体的原文。');
    const first = source.content.slice(0, index).split('\n').length;
    requireValue(start_line === undefined || first === start_line, 'QUOTE_LINE_MISMATCH', '短引不在指定起始行，请核对正文定位。');
    return { document_id, document_hash: source.hash, scene_id, start_line: first, end_line: first + quote.split('\n').length - 1, quote };
  }
  async verifyRef(state, context, ref) {
    if (!ref || !state.documents[ref.document_id]) return '未登记的原稿';
    const doc = state.documents[ref.document_id];
    if (ref.document_hash !== doc.hash) return '证据引用的是旧版原稿';
    try {
      const source = await this.source(context, doc.path);
      if (source.hash !== doc.hash) return '正文已变化，尚未重新登记';
      if (typeof ref.quote !== 'string' || !ref.quote || !Number.isInteger(ref.start_line) || ref.start_line < 1 || !Number.isInteger(ref.end_line) || ref.end_line < ref.start_line) return '证据定位字段不完整';
      const lines = source.content.split('\n');
      const excerpt = lines.slice(ref.start_line - 1, ref.end_line).join('\n');
      if (!excerpt.includes(ref.quote)) return '证据所在行与短引不符';
    } catch (error) { return `原稿不可读：${error.message}`; }
    return null;
  }
  async validateRecord(record, state, context) {
    validId(record.id);
    requireValue(typeof record.type === 'string' && record.type.length > 0 && record.type.length <= 64, 'TYPE_REQUIRED', '记录须提供 type；允许 Agent 定义新的记录类型。');
    requireValue(record.data && typeof record.data === 'object' && !Array.isArray(record.data), 'DATA_REQUIRED', '记录 data 须为对象，语义字段由 Agent 决定。');
    requireValue(JSON.stringify(record).length <= 200000, 'RECORD_TOO_LARGE', '单条记录过长，请拆成独立原稿和索引。');
    requireValue(record.data.refs === undefined || Array.isArray(record.data.refs), 'INVALID_EVIDENCE', 'data.refs 须为原稿证据定位数组。');
    for (const ref of record.data.refs || []) {
      const issue = await this.verifyRef(state, context, ref);
      requireValue(!issue, 'INVALID_EVIDENCE', issue, { recordId: record.id });
    }
    if (record.type !== 'thread') return;
    const data = record.data;
    requireValue(THREAD_STATES.has(data.status), 'INVALID_THREAD_STATUS', '伏笔状态须为 planned、planted、developing、paid_off、cancelled 或 deferred。');
    requireValue(typeof data.promise === 'string' && data.promise.trim().length > 0 && typeof data.required === 'boolean', 'THREAD_CONTRACT_REQUIRED', '伏笔须说明 promise 和是否 required。');
    if (['planted', 'developing', 'paid_off'].includes(data.status)) requireValue(Array.isArray(data.plant_refs) && data.plant_refs.length > 0, 'PLANT_EVIDENCE_REQUIRED', '计划不等于已埋设；该状态需要正文证据。');
    if (data.status === 'paid_off') requireValue(Array.isArray(data.payoff_refs) && data.payoff_refs.length > 0, 'PAYOFF_EVIDENCE_REQUIRED', '已回收状态需要正文证据。');
    for (const ref of ['cancelled', 'deferred'].includes(data.status) ? [] : [...(data.plant_refs || []), ...(data.payoff_refs || [])]) {
      const issue = await this.verifyRef(state, context, ref);
      requireValue(!issue, 'INVALID_EVIDENCE', issue, { recordId: record.id });
    }
    if (data.required && ['cancelled', 'deferred'].includes(data.status)) {
      const decision = state.records[data.decision_id];
      requireValue(decision?.type === 'decision' && decision.data.origin === 'user' && typeof decision.data.quote === 'string' && decision.data.quote.trim(), 'USER_DECISION_REQUIRED', '必回收伏笔取消或延期须关联用户决定和原话；不能自动销账。');
    }
  }
  async put({ project_root, expected_revision, records }) {
    requireValue(Array.isArray(records) && records.length > 0 && records.length <= 100, 'INVALID_RECORD_BATCH', '每批提交 1—100 条记录。');
    requireValue(new Set(records.map(record => record.id)).size === records.length, 'DUPLICATE_RECORD_ID', '同一批不能重复提交同一个 ID。');
    return this.mutate(project_root, expected_revision, async (state, context) => {
      const tentative = clone(state);
      for (const record of records) tentative.records[record.id] = clone(record);
      for (const record of records) {
        const existing = state.records[record.id];
        requireValue(!existing || existing.type === record.type, 'RECORD_TYPE_IMMUTABLE', '记录 ID 的类型不能改变；新类型使用新 ID，保留旧记录。');
        if (existing?.type === 'thread' && existing.data.required && !record.data.required) {
          const decision = tentative.records[record.data.decision_id];
          requireValue(decision?.type === 'decision' && decision.data.origin === 'user' && typeof decision.data.quote === 'string' && decision.data.quote.trim(), 'USER_DECISION_REQUIRED', '必回收项降级须关联用户决定和原话。');
        }
        await this.validateRecord(record, tentative, context);
      }
      for (const record of records) state.records[record.id] = { ...clone(record), updatedRevision: state.revision + 1 };
      return { updated: records.map(record => record.id) };
    });
  }
  async inspect(state, context) {
    const issues = [];
    for (const doc of Object.values(state.documents)) {
      try { if ((await this.source(context, doc.path)).hash !== doc.hash) issues.push({ code: 'DOCUMENT_CHANGED', documentId: doc.id }); }
      catch (error) { issues.push({ code: 'DOCUMENT_UNREADABLE', documentId: doc.id, message: error.message }); }
    }
    const pending = [];
    for (const record of Object.values(state.records)) {
      try { await this.validateRecord(record, state, context); }
      catch (error) { issues.push({ code: error.code, recordId: record.id, message: error.message }); }
      if (record.type !== 'thread') continue;
      if (record.data.required && !['paid_off', 'cancelled', 'deferred'].includes(record.data.status)) pending.push({ id: record.id, status: record.data.status, promise: record.data.promise });
    }
    return { projectId: state.projectId, revision: state.revision, issues, pendingRequiredThreads: pending, structuralPass: issues.length === 0 && pending.length === 0, semanticReviewRequired: true };
  }
  async audit({ project_root }) { const context = await this.context(project_root); return this.inspect(await this.read(context), context); }
  async review({ project_root, expected_revision, verdict, findings, summary }) {
    requireValue(['pass', 'revise'].includes(verdict) && Array.isArray(findings) && typeof summary === 'string' && summary.trim(), 'INVALID_REVIEW', 'Agent 须提交 pass/revise、findings 和说明；工具不代替语义审查。');
    const context = await this.context(project_root);
    return this.lock(context, async () => {
      const state = await this.read(context);
      requireValue(state.revision === expected_revision, 'REVISION_CONFLICT', '先读取最新版本再审查。');
      requireValue(state.status !== 'finalized', 'PROJECT_FINALIZED', '项目已定稿。');
      const report = await this.inspect(state, context);
      requireValue(verdict !== 'pass' || report.structuralPass && findings.length === 0, 'REVIEW_NOT_CLEAR', '还有证据错误、必回收伏笔或审查问题，不能提交通过。', report);
      state.review = { verdict, summary, findings, reviewedRevision: state.revision, documentHashes: Object.fromEntries(Object.entries(state.documents).map(([id, doc]) => [id, doc.hash])), at: new Date().toISOString() };
      state.revision++;
      await this.commit(context, state);
      return { revision: state.revision, review: state.review };
    });
  }
  async checkpoint({ project_root, expected_revision, summary, next_step, context: agentContext = {} }) {
    requireValue(typeof summary === 'string' && summary.trim() && typeof next_step === 'string', 'CHECKPOINT_CONTEXT_REQUIRED', '检查点须有 Agent 编写的摘要和下一步。');
    const context = await this.context(project_root);
    return this.lock(context, async () => {
      const state = await this.read(context);
      requireValue(state.revision === expected_revision, 'REVISION_CONFLICT', '检查点版本过期，先读取最新档案。');
      const checkpoint = { formatVersion: 1, projectId: state.projectId, revision: state.revision, stateHash: hash(json(state)), summary, nextStep: next_step, context: agentContext, createdAt: new Date().toISOString() };
      requireValue(JSON.stringify(checkpoint).length <= 64000, 'CHECKPOINT_TOO_LARGE', '检查点过长；保留关键状态与原稿定位，按需读取详细记录。');
      await atomicWrite(await this.dataFile(context, 'checkpoint.json'), json(checkpoint));
      return checkpoint;
    });
  }
  async recover({ project_root, index_offset = 0, index_limit = 100 }) {
    requireValue(Number.isInteger(index_offset) && index_offset >= 0 && Number.isInteger(index_limit) && index_limit >= 1 && index_limit <= 1000, 'INVALID_PAGE', '索引分页范围无效。');
    const context = await this.context(project_root);
    const state = await this.read(context);
    let checkpoint = null;
    const checkpointPath = await this.dataFile(context, 'checkpoint.json');
    if (await exists(checkpointPath)) checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
    const audit = await this.inspect(state, context);
    const records = Object.values(state.records);
    return { projectRoot: context.root, projectId: state.projectId, title: state.title, revision: state.revision, status: state.status, checkpoint, checkpointCurrent: checkpoint?.revision === state.revision && checkpoint?.stateHash === hash(json(state)), constraints: records.filter(r => r.type === 'constraint'), index: records.slice(index_offset, index_offset + index_limit).map(r => ({ id: r.id, type: r.type, summary: r.data.summary || r.data.promise || r.data.name || '' })), indexPage: { total: records.length, offset: index_offset, limit: index_limit, nextOffset: index_offset + index_limit < records.length ? index_offset + index_limit : null }, documents: state.documents, audit, nextAction: '先核对最新原稿与全部硬约束，按任务分页读取索引和记录；旧检查点仅作为线索，不覆盖最新档案。' };
  }
  async versions({ project_root, limit = 20 }) {
    requireValue(Number.isInteger(limit) && limit > 0 && limit <= 100, 'INVALID_LIMIT', 'limit 须为 1—100。');
    const context = await this.context(project_root);
    const state = await this.read(context);
    // Use revision numbers in the directory; prepared commits are explicitly marked.
    const versionsPath = path.dirname(await this.dataFile(context, 'versions/_placeholder'));
    const names = await fs.readdir(versionsPath);
    return { currentRevision: state.revision, versions: names.filter(n => /^\d+\.json$/.test(n)).map(n => Number(n.slice(0, -5))).sort((a, b) => b - a).slice(0, limit).map(revision => ({ revision, prepared: revision > state.revision })) };
  }
  async compare({ project_root, from_revision, to_revision }) {
    requireValue(Number.isInteger(from_revision) && from_revision >= 0 && Number.isInteger(to_revision) && to_revision >= 0, 'INVALID_REVISION', '比较版本须为非负整数。');
    const context = await this.context(project_root);
    const before = await this.read(context, from_revision), after = await this.read(context, to_revision);
    const changes = {};
    for (const section of ['documents', 'records']) {
      changes[section] = [...new Set([...Object.keys(before[section]), ...Object.keys(after[section])])].filter(id => JSON.stringify(before[section][id]) !== JSON.stringify(after[section][id])).map(id => ({ id, before: before[section][id] || null, after: after[section][id] || null }));
    }
    return { projectId: before.projectId, fromRevision: from_revision, toRevision: to_revision, changes };
  }
  async finalize({ project_root, expected_revision }) {
    const context = await this.context(project_root);
    return this.lock(context, async () => {
      const state = await this.read(context);
      requireValue(state.revision === expected_revision, 'REVISION_CONFLICT', '定稿前先读取最新版本。');
      requireValue(state.status !== 'finalized', 'PROJECT_FINALIZED', '项目已定稿。');
      requireValue(Object.values(state.documents).some(doc => doc.kind === 'screenplay'), 'SCREENPLAY_REQUIRED', '需要登记完整剧本正文，不能用大纲或元数据代替终稿。');
      const report = await this.inspect(state, context);
      requireValue(report.structuralPass, 'FINALIZATION_BLOCKED', '必回收伏笔或证据检查尚未完成。', report);
      requireValue(state.review?.verdict === 'pass' && state.review.reviewedRevision === state.revision - 1, 'FRESH_REVIEW_REQUIRED', '终稿需要伏笔与记忆 Agent 对当前版本提交通过的语义审查。');
      state.status = 'finalized'; state.revision++; state.finalizedAt = new Date().toISOString();
      await this.commit(context, state);
      return { projectId: state.projectId, revision: state.revision, status: state.status, reviewedRevision: state.review.reviewedRevision, documentHashes: state.review.documentHashes };
    });
  }
  async reopen({ project_root, expected_revision, reason }) {
    requireValue(typeof reason === 'string' && reason.trim(), 'REASON_REQUIRED', '开启修订须说明用户请求或修改依据。');
    const context = await this.context(project_root);
    return this.lock(context, async () => {
      const state = await this.read(context);
      requireValue(state.revision === expected_revision, 'REVISION_CONFLICT', '先读取最新版本。');
      requireValue(state.status === 'finalized', 'NOT_FINALIZED', '当前项目已处于创作状态。');
      state.status = 'draft'; state.revision++; state.review = null;
      state.reopened = { reason, at: new Date().toISOString() };
      await this.commit(context, state);
      return { revision: state.revision, status: state.status };
    });
  }
  async capture({ project_root, reason = 'precompact' }) {
    const context = await this.context(project_root);
    return this.lock(context, async () => {
      const state = await this.read(context);
      const receipt = { projectId: state.projectId, revision: state.revision, reason, capturedAt: new Date().toISOString(), state };
      const name = `${Date.now()}-${randomUUID()}.json`;
      await atomicWrite(await this.dataFile(context, `snapshots/${name}`), json(receipt));
      await atomicWrite(await this.dataFile(context, 'last-event.json'), json({ ...receipt, state: undefined, snapshot: `snapshots/${name}` }));
      return { projectId: state.projectId, revision: state.revision, snapshot: `.story-studio/snapshots/${name}` };
    });
  }
}
