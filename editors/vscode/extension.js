// Ferry for VS Code: a status bar item, conflict resolution with VS Code's
// diff view, undo, history, plan preview, and pause/resync/commit through
// ferry's local HTTP API. No dependencies and no build step.
const vscode = require('vscode');
const cp = require('child_process');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');

let statusItem;
let output;
let pollTimer;
let eventsReq;
let lastPairs = [];

function cfg() {
  return vscode.workspace.getConfiguration('ferry');
}

function workspaceDir() {
  const f = vscode.workspace.workspaceFolders;
  return f && f.length ? f[0].uri.fsPath : undefined;
}

// ---------- CLI ----------

function ferry(args, opts = {}) {
  return new Promise((resolve, reject) => {
    cp.execFile(cfg().get('path'), args, { cwd: workspaceDir(), timeout: 120000, maxBuffer: 32 << 20, ...opts },
      (err, stdout, stderr) => {
        if (err) {
          err.message = (stderr || stdout || err.message).trim();
          reject(err);
        } else {
          resolve(stdout);
        }
      });
  });
}

async function readStatus() {
  try {
    return JSON.parse(await ferry(['status', '--json', '--no-color'])) || [];
  } catch (e) {
    return null;
  }
}

// ---------- HTTP API ----------

function api(method, route, body) {
  return new Promise((resolve, reject) => {
    const base = new URL(cfg().get('apiUrl'));
    const url = new URL(route, base);
    const lib = url.protocol === 'https:' ? https : http;
    const headers = { 'X-Ferry': 'vscode' };
    const token = cfg().get('apiToken');
    if (token) headers.Authorization = 'Bearer ' + token;
    let data;
    if (body !== undefined) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    const req = lib.request(url, { method, headers, timeout: 10000 }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        if (res.statusCode >= 300) reject(new Error(text.trim() || res.statusMessage));
        else resolve(text);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function pairRoute(name, action) {
  return '/pairs/' + encodeURIComponent(name) + '/' + action;
}

async function apiAction(action, query = '') {
  const pair = await pickPair(true);
  if (!pair) return;
  try {
    await api('POST', pairRoute(pair.name, action) + query);
    vscode.window.setStatusBarMessage(`Ferry: ${action} sent to ${pair.name}`, 3000);
    refresh();
  } catch (e) {
    vscode.window.showErrorMessage(
      `Ferry: ${e.message}. Start ferry with --serve 127.0.0.1:7878 (or serve: in ferry.yaml) to control it from VS Code.`);
  }
}

// Live notifications from /events (server-sent events).
function subscribeEvents() {
  if (eventsReq || !cfg().get('notifications')) return;
  let url;
  try {
    url = new URL('/events', cfg().get('apiUrl'));
  } catch (e) {
    return;
  }
  const lib = url.protocol === 'https:' ? https : http;
  const headers = {};
  const token = cfg().get('apiToken');
  if (token) headers.Authorization = 'Bearer ' + token;
  eventsReq = lib.get(url, { headers }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      return;
    }
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = block.split('\n').find((l) => l.startsWith('data: '));
        if (line) onEvent(JSON.parse(line.slice(6)));
      }
    });
    res.on('end', () => (eventsReq = undefined));
  });
  eventsReq.on('error', () => (eventsReq = undefined));
}

function onEvent(ev) {
  const what = [ev.path, ev.message].filter(Boolean).join(' — ');
  if (ev.kind === 'conflict' && ev.held) {
    vscode.window.showWarningMessage(`Ferry conflict in ${ev.pair}: ${ev.path}`, 'Resolve…').then((a) => {
      if (a) showConflicts();
    });
  } else if (ev.kind === 'error') {
    vscode.window.showErrorMessage(`Ferry error in ${ev.pair}: ${what}`);
  } else if (ev.kind === 'commit') {
    vscode.window.setStatusBarMessage(`Ferry: ${ev.message}`, 5000);
  }
  if (['add', 'update', 'delete', 'rename', 'conflict', 'resolved', 'commit', 'paused', 'resumed'].includes(ev.kind)) {
    refresh();
  }
}

// ---------- status bar ----------

async function refresh() {
  const pairs = await readStatus();
  if (pairs === null) {
    statusItem.text = '$(circle-slash) Ferry';
    statusItem.tooltip = 'ferry was not found. Set ferry.path or install it from https://github.com/anupam42/Ferry';
    statusItem.show();
    return;
  }
  lastPairs = pairs;
  const running = pairs.filter((p) => p.running);
  const conflicts = running.reduce((n, p) => n + (p.conflicts || []).length, 0);
  const paused = running.filter((p) => p.paused).length;
  if (running.length === 0) {
    statusItem.text = '$(sync-ignored) Ferry: stopped';
  } else if (conflicts > 0) {
    statusItem.text = `$(warning) Ferry: ${conflicts} conflict${conflicts > 1 ? 's' : ''}`;
  } else if (paused > 0) {
    statusItem.text = `$(debug-pause) Ferry: ${paused} paused`;
  } else {
    statusItem.text = `$(sync) Ferry: ${running.length} syncing`;
  }
  statusItem.backgroundColor = conflicts > 0 ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  statusItem.tooltip = new vscode.MarkdownString(
    pairs.map((p) => `**${p.name}** — ${p.state}  \n\`${p.source}\` → \`${p.remote || p.target}\``).join('\n\n') ||
      'No pairs have run yet');
  statusItem.command = conflicts > 0 ? 'ferry.showConflicts' : 'ferry.showPairs';
  statusItem.show();
  if (running.length > 0) subscribeEvents();
}

async function pickPair(runningOnly) {
  const pairs = (await readStatus()) || lastPairs;
  const list = pairs.filter((p) => !runningOnly || p.running);
  if (list.length === 0) {
    vscode.window.showInformationMessage(runningOnly ? 'Ferry: no pair is running.' : 'Ferry: no pairs have run yet.');
    return undefined;
  }
  if (list.length === 1) return list[0];
  const pick = await vscode.window.showQuickPick(
    list.map((p) => ({ label: p.name, description: p.state, detail: `${p.source} → ${p.remote || p.target}`, pair: p })),
    { placeHolder: 'Which pair?' });
  return pick && pick.pair;
}

// ---------- commands ----------

async function showPairs() {
  const pairs = (await readStatus()) || [];
  const items = pairs.map((p) => ({
    label: `${p.running ? '$(sync)' : '$(circle-outline)'} ${p.name}`,
    description: p.state,
    detail: `${p.source} → ${p.remote || p.target}` + (p.is_git ? `  ·  ⎇ ${p.branch || '–'} · ${p.uncommitted} uncommitted` : ''),
  }));
  items.push({ label: '$(play) Start syncing in a terminal…', command: 'ferry.start' });
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Ferry pairs' });
  if (pick && pick.command) vscode.commands.executeCommand(pick.command);
}

async function showConflicts() {
  const pairs = ((await readStatus()) || []).filter((p) => (p.conflicts || []).length);
  const items = [];
  for (const p of pairs) for (const c of p.conflicts) items.push({ label: c, description: p.name, pair: p, file: c });
  if (items.length === 0) {
    vscode.window.showInformationMessage('Ferry: no conflicts.');
    return;
  }
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Conflict to resolve' });
  if (!pick) return;
  const target = path.join(pick.pair.target, pick.file);
  const source = path.join(pick.pair.source, pick.file);
  if (fs.existsSync(target) && fs.existsSync(source)) {
    await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(target), vscode.Uri.file(source),
      `${pick.file}: target ↔ source`);
  }
  const choice = await vscode.window.showQuickPick([
    { label: 'Keep source', keep: 'source' },
    { label: 'Keep target', keep: 'target' },
    { label: 'Keep newer', keep: 'newer' },
    { label: 'Keep both', description: 'source version saved as a .conflict copy', keep: 'both' },
    { label: 'Three-way merge', description: 'overlapping edits get <<<<<<< markers', keep: 'merge' },
  ], { placeHolder: `Resolve ${pick.file}` });
  if (!choice) return;
  try {
    const out = await ferry(['resolve', pick.file, '--keep', choice.keep, '--pair', pick.pair.name, '--no-color']);
    vscode.window.showInformationMessage('Ferry: ' + (out.trim().split('\n').pop() || 'resolved'));
  } catch (e) {
    vscode.window.showErrorMessage('Ferry: ' + e.message);
  }
  refresh();
}

function start() {
  const term = vscode.window.createTerminal({ name: 'ferry', cwd: workspaceDir() });
  const hasConfig = workspaceDir() && fs.existsSync(path.join(workspaceDir(), 'ferry.yaml'));
  term.sendText(`${quote(cfg().get('path'))}${hasConfig ? '' : ' init'}`);
  term.show();
  if (!hasConfig) vscode.window.showInformationMessage('Ferry: wrote ferry.yaml — edit the pairs, then run "ferry" in the terminal.');
}

function quote(s) {
  return /\s/.test(s) ? `"${s}"` : s;
}

async function commit(push) {
  const message = await vscode.window.showInputBox({ prompt: 'Commit message', value: 'sync: {summary}' });
  if (message === undefined) return;
  apiAction('commit', `?message=${encodeURIComponent(message)}${push ? '&push=1' : ''}`);
}

async function undo() {
  const pair = await pickPair(false);
  if (!pair) return;
  let hist;
  try {
    hist = JSON.parse(await ferry(['history', '--json', '--pair', pair.name, '-n', '1']));
  } catch (e) {
    vscode.window.showErrorMessage('Ferry: ' + e.message);
    return;
  }
  const b = (hist || []).find((x) => !x.undone);
  if (!b) {
    vscode.window.showInformationMessage('Ferry: nothing to undo.');
    return;
  }
  const n = b.entries.length;
  const ok = await vscode.window.showWarningMessage(
    `Undo the sync from ${new Date(b.time).toLocaleTimeString()} in ${pair.name} (${n} file${n > 1 ? 's' : ''})?`,
    { modal: true, detail: 'Current versions are backed up first.' }, 'Undo');
  if (!ok) return;
  try {
    const out = await ferry(['undo', '--pair', pair.name, '--batch', b.id, '--yes', '--no-color']);
    output.appendLine(out);
    vscode.window.showInformationMessage('Ferry: ' + (out.trim().split('\n').find((l) => l.includes('reverted')) || 'undone'));
  } catch (e) {
    vscode.window.showErrorMessage('Ferry: ' + e.message);
  }
  refresh();
}

async function runToOutput(args, title) {
  output.clear();
  output.appendLine(`$ ferry ${args.join(' ')}`);
  output.show(true);
  try {
    output.appendLine(await ferry([...args, '--no-color']));
  } catch (e) {
    output.appendLine(e.message);
    vscode.window.showErrorMessage(`Ferry ${title} failed — see the output panel.`);
  }
}

async function plan() {
  const dir = workspaceDir();
  const args = ['plan', '--format', 'markdown', '--diff'];
  if (dir && fs.existsSync(path.join(dir, 'ferry.yaml'))) {
    args.push('--config', path.join(dir, 'ferry.yaml'));
  } else {
    const pair = await pickPair(false);
    if (!pair || pair.remote) {
      if (pair) vscode.window.showInformationMessage('Ferry: run plan from the folder with ferry.yaml for remote pairs.');
      return;
    }
    args.push(pair.source, pair.target);
    if (pair.mode === 'two-way') args.push('--two-way');
  }
  try {
    const md = await ferry(args);
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: md });
    await vscode.commands.executeCommand('markdown.showPreview', doc.uri);
  } catch (e) {
    vscode.window.showErrorMessage('Ferry plan: ' + e.message);
  }
}

function activate(context) {
  output = vscode.window.createOutputChannel('Ferry');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg('ferry.showPairs', showPairs);
  reg('ferry.showConflicts', showConflicts);
  reg('ferry.start', start);
  reg('ferry.pause', () => apiAction('pause'));
  reg('ferry.resume', () => apiAction('resume'));
  reg('ferry.resync', () => apiAction('resync'));
  reg('ferry.commit', () => commit(false));
  reg('ferry.commitPush', () => commit(true));
  reg('ferry.undo', undo);
  reg('ferry.history', () => runToOutput(['history', '-n', '30'], 'history'));
  reg('ferry.plan', plan);
  reg('ferry.doctor', () => runToOutput(['doctor'], 'doctor'));
  context.subscriptions.push(statusItem, output);

  const schedule = () => {
    clearInterval(pollTimer);
    pollTimer = setInterval(refresh, Math.max(1, cfg().get('pollSeconds')) * 1000);
  };
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('ferry')) {
      if (eventsReq) eventsReq.destroy();
      eventsReq = undefined;
      schedule();
      refresh();
    }
  }));
  schedule();
  refresh();
}

function deactivate() {
  clearInterval(pollTimer);
  if (eventsReq) eventsReq.destroy();
}

module.exports = { activate, deactivate };
