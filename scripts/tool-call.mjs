#!/usr/bin/env node
// A CLI transport client for diagnostics and environments without a live MCP binding.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function invoke(name, args, { workspace, server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../mcp/server.mjs') } = {}) {
  const child = spawn(process.execPath, [server, ...(workspace ? ['--workspace', workspace] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let seq = 0, stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const fail = error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
  child.on('error', fail);
  child.on('exit', code => { if (pending.size) fail(new Error(`MCP exited ${code}: ${stderr}`)); });
  const reader = readline.createInterface({ input: child.stdout });
  reader.on('line', line => {
    try {
      const message = JSON.parse(line), item = pending.get(message.id);
      if (item) { clearTimeout(item.timer); pending.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); }
    } catch (error) { fail(error); }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP response timeout')); child.kill(); }, 20000);
    pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'story-studio-cli', version: '1.1.0' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return name === '--list' ? await request('tools/list', {}) : await request('tools/call', { name, arguments: args });
  } finally { child.stdin.end(); reader.close(); child.kill(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const name = process.argv[2];
    if (!name || name !== '--list' && !process.argv[3]) throw new Error('Usage: node scripts/tool-call.mjs TOOL ARGUMENTS.json | --list');
    const args = name === '--list' ? {} : JSON.parse(await fs.readFile(process.argv[3], 'utf8'));
    const result = await invoke(name, args);
    console.log(JSON.stringify(result));
    if (result.isError) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
