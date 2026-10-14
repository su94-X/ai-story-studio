#!/usr/bin/env node
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StoryStore, StudioError } from './store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = { type: 'string', description: '用户选定创作项目的绝对路径；不是插件安装目录。' };
const revision = { type: 'integer', minimum: 0, description: '先读取档案，传入当前 revision；冲突时重新读取并合并。' };
const text = { type: 'string' };
const integer = { type: 'integer' };
const tools = [];
function tool(name, method, description, properties, required, readOnly = false) {
  tools.push({ name: 'studio_' + name, method, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly || name === 'open_project', openWorldHint: false } });
}
tool('read_guidance', 'guidance', '只读获取守护 Skill 或其参考规范，使关闭 shell 的 story-keeper 仍能按需加载专业方法。不能读取任意文件。', { resource: { type: 'string', enum: ['skill', 'records', 'foreshadowing', 'recovery'] } }, ['resource'], true);
tool('open_project', 'open', '创建或打开项目档案。只创建 .story-studio 中的元数据，不写剧本正文。', { project_root: project, project_id: text, title: text }, ['project_root', 'project_id']);
tool('read_state', 'state', '按类型、ID 或版本分页读取 Agent 维护的项目状态，默认100条；使用明确定位，不做向量检索。', { project_root: project, revision, types: { type: 'array', items: text }, ids: { type: 'array', items: text }, offset: integer, limit: integer }, ['project_root'], true);
tool('register_document', 'register', '登记现有 UTF-8 原稿、记录 SHA-256 并保留版本快照。此工具不会改写原稿。', { project_root: project, document_id: text, path: text, kind: text, expected_revision: revision }, ['project_root', 'document_id', 'path', 'expected_revision']);
tool('read_document', 'document', '读取已登记原稿的指定行，或按 hash 读取历史原稿。返回正文是否与登记版本一致。', { project_root: project, document_id: text, document_hash: text, start_line: integer, max_lines: integer }, ['project_root', 'document_id'], true);
tool('make_anchor', 'anchor', '用确实存在的原文生成版本、场次、行号和短引定位。不评价伏笔的戏剧作用。', { project_root: project, document_id: text, quote: text, scene_id: text, start_line: integer }, ['project_root', 'document_id', 'quote'], true);
tool('put_records', 'put', '原子更新 Agent 提交的记录。data 可扩展；thread 类型只校验证据与生命周期，不决定剧情。', { project_root: project, expected_revision: revision, records: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', properties: { id: text, type: text, data: { type: 'object', additionalProperties: true } }, required: ['id', 'type', 'data'], additionalProperties: false } } }, ['project_root', 'expected_revision', 'records']);
tool('audit', 'audit', '检查版本、证据定位和必回收伏笔的结构完整性。structuralPass 不是语义质量通过。', { project_root: project }, ['project_root'], true);
tool('submit_review', 'review', '保存 Agent 对当前原稿的审查结论。只有无结构问题、无必回收项且 findings 为空才可提交 pass。', { project_root: project, expected_revision: revision, verdict: { type: 'string', enum: ['pass', 'revise'] }, findings: { type: 'array', items: { type: 'object', additionalProperties: true } }, summary: text }, ['project_root', 'expected_revision', 'verdict', 'findings', 'summary']);
tool('save_checkpoint', 'checkpoint', '保存 Agent 编写的恢复摘要、下一步和自由结构的任务上下文；不会覆盖正文或增加档案修订号。', { project_root: project, expected_revision: revision, summary: text, next_step: text, context: { type: 'object', additionalProperties: true } }, ['project_root', 'expected_revision', 'summary', 'next_step']);
tool('recover_project', 'recover', '恢复最新项目、全部硬约束、分页索引、原稿定位和检查点；识别过期检查点和未登记正文。', { project_root: project, index_offset: integer, index_limit: integer }, ['project_root'], true);
tool('list_versions', 'versions', '列出保存的档案版本，包括崩溃后可能遗留的 prepared 版本。', { project_root: project, limit: integer }, ['project_root'], true);
tool('compare_versions', 'compare', '返回两个版本的记录和原稿登记差异，由 Agent 判断剧情影响。', { project_root: project, from_revision: revision, to_revision: revision }, ['project_root', 'from_revision', 'to_revision'], true);
tool('finalize_project', 'finalize', '在必回收伏笔、原稿证据及当前语义审查都通过后生成定稿回执。不能用大纲代替正文。', { project_root: project, expected_revision: revision }, ['project_root', 'expected_revision']);
tool('reopen_project', 'reopen', '用户要求修改终稿时开启新的修订，保留所有历史和旧定稿回执。', { project_root: project, expected_revision: revision, reason: text }, ['project_root', 'expected_revision', 'reason']);
export const TOOL_DEFINITIONS = tools.map(({ method, ...definition }) => definition);

function validate(value, schema, at = 'arguments') {
  const correct = schema.type === 'object' ? value && typeof value === 'object' && !Array.isArray(value)
    : schema.type === 'array' ? Array.isArray(value)
      : schema.type === 'integer' ? Number.isInteger(value)
        : typeof value === schema.type;
  if (!correct) throw new StudioError('INVALID_ARGUMENTS', `${at} 应为 ${schema.type}。`);
  if (schema.enum && !schema.enum.includes(value)) throw new StudioError('INVALID_ARGUMENTS', `${at} 不在允许值中。`);
  if (schema.minimum !== undefined && value < schema.minimum) throw new StudioError('INVALID_ARGUMENTS', `${at} 低于最小值。`);
  if (schema.type === 'object') {
    for (const key of schema.required || []) if (!(key in value)) throw new StudioError('INVALID_ARGUMENTS', `缺少 ${at}.${key}。`);
    for (const [key, entry] of Object.entries(value)) {
      if (schema.properties?.[key]) validate(entry, schema.properties[key], `${at}.${key}`);
      else if (schema.additionalProperties === false) throw new StudioError('INVALID_ARGUMENTS', `未知字段 ${at}.${key}。`);
    }
  }
  if (schema.type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) throw new StudioError('INVALID_ARGUMENTS', `${at} 数量超出范围。`);
    if (schema.items) value.forEach((entry, index) => validate(entry, schema.items, `${at}[${index}]`));
  }
}
export async function callTool(store, name, args = {}) {
  const definition = tools.find(entry => entry.name === name);
  if (!definition) throw new StudioError('UNKNOWN_TOOL', '未知工具：' + name);
  validate(args, definition.inputSchema);
  return store[definition.method](args);
}
export async function runServer({ input = process.stdin, output = process.stdout, workspace } = {}) {
  const store = new StoryStore({ workspace, pluginRoot: root });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let initialized = false;
  const send = message => output.write(JSON.stringify(message) + '\n');
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request;
    try { if (Buffer.byteLength(line) > 6 * 1024 * 1024) throw new Error(); request = JSON.parse(line); }
    catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      send({ jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32600, message: 'Invalid Request' } }); continue;
    }
    if (request.id === undefined) { if (request.method === 'notifications/initialized') initialized = true; continue; }
    try {
      let result;
      if (request.method === 'initialize') {
        const supported = ['2025-03-26', '2025-06-18', '2025-11-25'];
        const offered = request.params?.protocolVersion;
        result = { protocolVersion: supported.includes(offered) ? offered : '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'ai-story-studio', version: '1.1.0' }, instructions: 'Agent 负责创作和语义记忆；工具只维护用户选定项目的档案、证据、版本与恢复入口。检索热点使用宿主实际提供的搜索工具。' };
      } else if (request.method === 'ping') result = {};
      else if (!initialized) throw Object.assign(new Error('Initialize first'), { rpcCode: -32000 });
      else if (request.method === 'tools/list') result = { tools: TOOL_DEFINITIONS };
      else if (request.method === 'tools/call') {
        try {
          const value = await callTool(store, request.params?.name, request.params?.arguments || {});
          result = { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false };
        } catch (error) {
          const value = { error: error.code || 'IO_ERROR', message: error.message, details: error.details || {} };
          result = { content: [{ type: 'text', text: JSON.stringify(value) }], isError: true };
        }
      } else throw Object.assign(new Error('Method not found'), { rpcCode: -32601 });
      send({ jsonrpc: '2.0', id: request.id, result });
    } catch (error) { send({ jsonrpc: '2.0', id: request.id, error: { code: error.rpcCode || -32603, message: error.message } }); }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--workspace' || !path.isAbsolute(args[1]))) {
    process.stderr.write('Usage: node mcp/server.mjs [--workspace ABSOLUTE_PATH]\n'); process.exitCode = 1;
  } else await runServer({ workspace: args[1] });
}
