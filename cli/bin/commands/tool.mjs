/**
 * `fk-skills tool` — local UI checker with SSE streaming
 *
 * Usage:
 *   npx fk-skills tool              Start at http://localhost:4444
 *   npx fk-skills tool --setup      Re-run setup wizard
 *   npx fk-skills tool --port 3333  Custom port
 */

import { createServer } from 'node:http';
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ────────────────────────────────────────────────────────────────

function globalConfigPath() { return join(homedir(), '.config', 'fk-skills', 'tool.json'); }
function projectConfigPath() { return join(process.cwd(), '.fk-skills', 'tool.json'); }

function readConfig() {
  for (const p of [projectConfigPath(), globalConfigPath()]) {
    if (existsSync(p)) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch {} }
  }
  return null;
}

function writeConfig(config, scope = 'global') {
  const p = scope === 'project' ? projectConfigPath() : globalConfigPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(config, null, 2) + '\n');
  return p;
}

// ─── CLI detection ─────────────────────────────────────────────────────────

function detectAvailableClis() {
  return ['claude', 'codex'].filter(cli => {
    try { return spawnSync('which', [cli], { encoding: 'utf-8', timeout: 3000 }).status === 0; }
    catch { return false; }
  });
}

// ─── Setup wizard ──────────────────────────────────────────────────────────

async function setupWizard() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(r => rl.question(q, r));

  console.log('\n  fk-skills tool — setup\n');
  const clis = detectAvailableClis();

  if (!clis.length) {
    console.log('  No AI CLI detected (claude / codex).\n');
    console.log('  Install Claude Code: npm install -g @anthropic-ai/claude-code');
    console.log('  Install Codex CLI:   npm i -g @openai/codex\n');
    rl.close(); process.exit(1);
  }

  let agent = clis[0];
  if (clis.length > 1) {
    console.log(`  Detected: ${clis.join(', ')}`);
    const ans = await ask(`  Use which? [${clis[0]}] `);
    if (clis.includes(ans.trim())) agent = ans.trim();
  } else {
    console.log(`  Detected: ${agent} ✓`);
  }

  const scopeAns = await ask('  Scope — global or project? [global] ');
  const scope = scopeAns.trim() === 'project' ? 'project' : 'global';
  rl.close();

  const config = { agent, scope };
  const saved = writeConfig(config, scope);
  console.log(`\n  Saved to ${saved}`);
  return config;
}

// ─── HTML prep ─────────────────────────────────────────────────────────────

function prepareHtml(raw) {
  // Strip scripts, styles (keep class/id attributes for structure clues)
  let html = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s{3,}/g, '  ')
    .trim();

  // Extract body if present
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (body) html = body[1].trim();

  return html.slice(0, 12000);
}

// ─── Scoring prompt ────────────────────────────────────────────────────────

const SCORE_PROMPT = `You are a senior design director doing a full UI/UX critique. Analyze the HTML and return ONLY valid JSON — no markdown, no explanation, no code fences.

Required JSON schema:
{
  "register": "brand" | "product",
  "scores": {
    "technical": {
      "total": <0-20>,
      "breakdown": [
        { "id": "accessibility", "label": "Accessibility", "score": <0-4>, "keyFinding": "<specific finding>" },
        { "id": "performance",   "label": "Performance",   "score": <0-4>, "keyFinding": "<specific finding>" },
        { "id": "theming",       "label": "Theming",       "score": <0-4>, "keyFinding": "<specific finding>" },
        { "id": "responsive",    "label": "Responsive",    "score": <0-4>, "keyFinding": "<specific finding>" },
        { "id": "antiPatterns",  "label": "Anti-Patterns", "score": <0-4>, "keyFinding": "<specific finding>" }
      ]
    },
    "ux": {
      "total": <0-40>,
      "heuristics": [
        { "id": 1,  "name": "Visibility of System Status",     "score": <0-4>, "keyIssue": "<finding or solid>" },
        { "id": 2,  "name": "Match System and Real World",     "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 3,  "name": "User Control and Freedom",       "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 4,  "name": "Consistency and Standards",      "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 5,  "name": "Error Prevention",               "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 6,  "name": "Recognition Rather Than Recall", "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 7,  "name": "Flexibility and Efficiency",     "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 8,  "name": "Aesthetic and Minimalist Design","score": <0-4>, "keyIssue": "<finding>" },
        { "id": 9,  "name": "Error Recovery",                 "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 10, "name": "Help and Documentation",         "score": <0-4>, "keyIssue": "<finding>" }
      ]
    },
    "slopTest": {
      "passed": true | false,
      "tells": [],
      "verdict": "<1-2 sentence honest verdict>"
    }
  },
  "issues": [
    {
      "id": "kebab-id",
      "priority": "P0"|"P1"|"P2"|"P3",
      "title": "<short name>",
      "location": "<selector or area>",
      "category": "Accessibility"|"Performance"|"Theming"|"Responsive"|"Anti-Pattern"|"UX",
      "impact": "<user impact, 1 sentence>",
      "recommendation": "<actionable fix, 1-2 sentences>"
    }
  ],
  "positiveFindings": ["<strength 1>", "<strength 2>"],
  "systemicIssues": ["<recurring pattern>"],
  "summary": "<2-3 sentence executive summary>"
}

Rules:
- register: brand=marketing/landing, product=app/dashboard/tool
- technical scores 0-4: 4=excellent, 3=good, 2=partial, 1=poor, 0=failing
- slopTest tells: gradient-text, everything-in-cards, glassmorphism-overuse, sparkle-icons, bento-grid, excessive-border-radius, emoji-overuse, oversized-h1, hero-eyebrow-label, hero-metrics-row
- issues: P0=blocking, P1=major, P2=minor, P3=polish. Include 6-10 issues.
- positiveFindings: 2-4 genuine strengths
- systemicIssues: recurring patterns (omit array if none)`;

// ─── detectHtml via temp file ──────────────────────────────────────────────

async function runDetectHtml(html, url) {
  const { detectHtml } = await import('../../engine/detect-antipatterns.mjs');
  const tmp = join(tmpdir(), `fk-tool-${Date.now()}.html`);
  try {
    writeFileSync(tmp, html, 'utf-8');
    return await detectHtml(tmp, { url });
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

// ─── SSE helpers ───────────────────────────────────────────────────────────

function sseEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) return text.slice(start, end + 1);
  return text;
}

// ─── Scan handler (SSE stream) ─────────────────────────────────────────────

async function handleScan(body, config, res) {
  const { url, mode = 'score' } = body;
  if (!url) { sseEvent(res, 'error', { text: 'url is required' }); return; }

  const start = Date.now();

  // 1. Fetch
  sseEvent(res, 'status', { text: 'Fetching page...' });
  let html;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'fk-skills-tool/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    html = await r.text();
  } catch (err) {
    sseEvent(res, 'error', { text: `Fetch failed: ${err.message}` });
    return;
  }

  // 2. Static analysis
  sseEvent(res, 'status', { text: 'Detecting anti-patterns...' });
  let findings = [];
  try {
    findings = await runDetectHtml(html, url);
    sseEvent(res, 'findings', { findings, counts: findings.reduce((a, f) => {
      a[f.category || 'other'] = (a[f.category || 'other'] || 0) + 1;
      a.total = (a.total || 0) + 1;
      return a;
    }, {}) });
  } catch (err) {
    sseEvent(res, 'status', { text: `Static analysis warning: ${err.message}` });
  }

  if (mode === 'check') {
    sseEvent(res, 'done', { durationMs: Date.now() - start });
    return;
  }

  // 3. LLM scoring with streaming
  sseEvent(res, 'status', { text: `Scoring with ${config.agent}...` });

  const prepared = prepareHtml(html);
  const fullPrompt = `${SCORE_PROMPT}\n\n<html>\n${prepared}\n</html>`;
  const args = config.agent === 'claude' ? ['-p', fullPrompt] : ['--no-git', '--full-auto', '-q', fullPrompt];

  await new Promise((resolve) => {
    let buffer = '';
    let done = false;

    const proc = spawn(config.agent, args, { env: process.env });

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      proc.kill('SIGTERM');
      sseEvent(res, 'error', { text: `${config.agent} timed out after 3 minutes` });
      resolve();
    }, 180000);

    proc.stdout.on('data', chunk => {
      const text = chunk.toString();
      buffer += text;
      // Stream raw text so user sees it being written
      sseEvent(res, 'stream', { text });
    });

    proc.stderr.on('data', chunk => {
      // Forward non-empty stderr as status (claude sometimes prints progress here)
      const t = chunk.toString().trim();
      if (t) sseEvent(res, 'status', { text: t });
    });

    proc.on('error', err => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sseEvent(res, 'error', { text: `${config.agent} error: ${err.message}` });
      resolve();
    });

    proc.on('close', code => {
      if (done) return;
      done = true;
      clearTimeout(timer);

      if (code !== 0 && !buffer.trim()) {
        sseEvent(res, 'error', { text: `${config.agent} exited with code ${code}` });
        resolve();
        return;
      }

      try {
        const parsed = JSON.parse(extractJson(buffer));
        sseEvent(res, 'result', {
          ...parsed,
          findings,
          agent: config.agent,
          durationMs: Date.now() - start,
        });
      } catch {
        sseEvent(res, 'error', { text: 'Could not parse JSON from response — try again' });
      }
      resolve();
    });
  });

  sseEvent(res, 'done', { durationMs: Date.now() - start });
}

// ─── HTTP server ────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; });
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

async function startServer(config, port) {
  const ui = buildUI(config);

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ui);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/scan') {
      let body;
      try { body = await parseBody(req); } catch (e) { res.writeHead(400); res.end(e.message); return; }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      await handleScan(body, config, res);
      res.end();
      return;
    }

    res.writeHead(404); res.end('Not found');
  });

  await new Promise((resolve, reject) => {
    server.on('error', err => {
      if (err.code === 'EADDRINUSE') reject(new Error(`Port ${port} in use. Try --port <other>`));
      else reject(err);
    });
    server.listen(port, '127.0.0.1', resolve);
  });

  return server;
}

// ─── Inline HTML UI ────────────────────────────────────────────────────────

function buildUI(config) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fk-skills tool</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #f5f4f0;
  --surface: #ffffff;
  --surface2: #f9f8f5;
  --border: #e4e3de;
  --border2: #d4d3ce;
  --text: #1c1c1e;
  --muted: #6e6e73;
  --faint: #a1a1a6;
  --accent: oklch(62% 0.19 75);
  --accent-dim: oklch(62% 0.19 75 / 0.12);
  --p0: #d93025; --p0-bg: #fff5f5; --p0-border: #fecaca;
  --p1: #c2560c; --p1-bg: #fff8f0; --p1-border: #fed7aa;
  --p2: #856404; --p2-bg: #fefce8; --p2-border: #fef08a;
  --p3: #6e6e73; --p3-bg: #f9f8f5; --p3-border: #e4e3de;
  --good: #1a7f37;
  --good-bg: #f0fdf4;
  --shadow: 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,.06), 0 2px 4px rgba(0,0,0,.04);
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* ── Header ── */
header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 0 32px;
  height: 52px;
  display: flex;
  align-items: center;
  gap: 12px;
  position: sticky;
  top: 0;
  z-index: 100;
}
.logo { font-size: 13px; font-weight: 700; letter-spacing: -0.02em; color: var(--text); }
.logo span { color: var(--accent); }
.hbadge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--faint);
  background: var(--surface2);
  border: 1px solid var(--border);
  padding: 2px 7px;
  border-radius: 99px;
}
.agent-pill {
  margin-left: auto;
  font-size: 11px;
  color: var(--accent);
  background: var(--accent-dim);
  padding: 3px 10px;
  border-radius: 99px;
  font-weight: 600;
}

/* ── Main ── */
main { max-width: 920px; margin: 0 auto; padding: 28px 32px 80px; }

/* ── Form ── */
.form-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px;
  box-shadow: var(--shadow);
  margin-bottom: 24px;
  display: flex;
  gap: 10px;
  align-items: center;
}
.url-input {
  flex: 1;
  border: 1px solid var(--border2);
  border-radius: 9px;
  padding: 10px 14px;
  font-size: 14px;
  color: var(--text);
  background: var(--bg);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  min-width: 0;
}
.url-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-dim);
}
.url-input::placeholder { color: var(--faint); }
.mode-tabs { display: flex; gap: 3px; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 3px; }
.tab {
  padding: 5px 12px;
  border-radius: 6px;
  border: none;
  background: none;
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.12s;
  white-space: nowrap;
}
.tab.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow);
}
.scan-btn {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 9px;
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: filter 0.12s, transform 0.1s;
  white-space: nowrap;
  letter-spacing: -0.01em;
}
.scan-btn:hover { filter: brightness(1.08); }
.scan-btn:active { transform: scale(0.97); }
.scan-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; filter: none; }

/* ── Error ── */
.error {
  display: none;
  padding: 12px 16px;
  background: var(--p0-bg);
  border: 1px solid var(--p0-border);
  border-radius: 10px;
  color: var(--p0);
  font-size: 13px;
  margin-bottom: 16px;
  font-weight: 500;
}
.error.show { display: block; }

/* ── Progress panel ── */
.progress-panel {
  display: none;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--shadow);
  margin-bottom: 20px;
}
.progress-panel.show { display: block; }
.progress-header {
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
}
.spinner {
  width: 16px; height: 16px;
  border: 2px solid var(--border2);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.65s linear infinite;
  flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }
.progress-label { font-size: 13px; font-weight: 500; color: var(--text); }
.stream-area {
  padding: 14px 18px;
  max-height: 200px;
  overflow-y: auto;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--surface2);
}

/* ── Section ── */
.section { display: none; margin-bottom: 20px; }
.section.show { display: block; animation: fadeUp 0.3s ease; }
@keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--faint);
  margin-bottom: 10px;
}

/* ── Score cards ── */
.score-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.score-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
  box-shadow: var(--shadow);
}
.sc-label { font-size: 11px; color: var(--faint); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; }
.sc-value { font-size: 32px; font-weight: 800; letter-spacing: -0.04em; line-height: 1; color: var(--text); }
.sc-max { font-size: 14px; font-weight: 400; color: var(--faint); }
.sc-bar { height: 3px; background: var(--border2); border-radius: 2px; margin-top: 14px; overflow: hidden; }
.sc-fill { height: 100%; border-radius: 2px; transition: width 0.6s cubic-bezier(0.16,1,0.3,1); }
.sc-fill.good { background: var(--good); }
.sc-fill.mid  { background: var(--p2); }
.sc-fill.bad  { background: var(--p0); }
.slop-pass { color: var(--good); }
.slop-fail { color: var(--p0); }
.slop-tags { font-size: 11px; color: var(--muted); margin-top: 7px; line-height: 1.6; }
.slop-verdict { font-size: 12px; color: var(--muted); margin-top: 6px; line-height: 1.55; font-style: italic; }

/* ── Summary ── */
.summary-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
  box-shadow: var(--shadow);
}
.register-badge {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent);
  border: 1.5px solid currentColor;
  padding: 2px 9px;
  border-radius: 5px;
  margin-bottom: 10px;
}
.summary-text { font-size: 14px; color: var(--muted); line-height: 1.7; }

/* ── Table ── */
.table-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--shadow);
  overflow-x: auto;
}
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead th {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--faint);
  padding: 11px 16px 10px;
  text-align: left;
  background: var(--surface2);
  border-bottom: 1px solid var(--border);
}
thead th:last-child { text-align: right; }
tbody tr { border-bottom: 1px solid var(--border); transition: background 0.1s; }
tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: var(--surface2); }
tbody td { padding: 11px 16px; vertical-align: top; }
tbody td:last-child { text-align: right; }
.num-cell { color: var(--faint); font-size: 12px; width: 28px; }
.td-name { font-weight: 600; }
.td-finding { color: var(--muted); font-size: 12px; }
.score-pill { font-weight: 800; font-size: 13px; font-variant-numeric: tabular-nums; }
.score-pill.s4 { color: var(--good); }
.score-pill.s3 { color: oklch(52% 0.13 145); }
.score-pill.s2 { color: var(--p2); }
.score-pill.s1 { color: var(--p1); }
.score-pill.s0 { color: var(--p0); }

/* ── Issue cards ── */
.issue {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 18px;
  margin-bottom: 8px;
  box-shadow: var(--shadow);
  transition: box-shadow 0.15s;
}
.issue:hover { box-shadow: var(--shadow-md); }
.issue-top { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 10px; }
.pchip {
  font-size: 10px;
  font-weight: 800;
  padding: 3px 8px;
  border-radius: 5px;
  white-space: nowrap;
  flex-shrink: 0;
  margin-top: 1px;
  letter-spacing: 0.03em;
}
.pchip.p0 { background: var(--p0-bg); color: var(--p0); border: 1px solid var(--p0-border); }
.pchip.p1 { background: var(--p1-bg); color: var(--p1); border: 1px solid var(--p1-border); }
.pchip.p2 { background: var(--p2-bg); color: var(--p2); border: 1px solid var(--p2-border); }
.pchip.p3 { background: var(--p3-bg); color: var(--p3); border: 1px solid var(--p3-border); }
.issue-title { font-size: 14px; font-weight: 600; line-height: 1.35; }
.issue-meta { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 9px; }
.meta-item { font-size: 11px; color: var(--faint); display: flex; gap: 4px; align-items: center; }
.meta-item b { color: var(--muted); font-weight: 600; }
.issue-impact { font-size: 13px; color: var(--muted); margin-bottom: 8px; line-height: 1.6; }
.issue-fix {
  font-size: 13px;
  color: var(--text);
  background: var(--accent-dim);
  border-left: 2.5px solid var(--accent);
  padding: 9px 13px;
  border-radius: 0 8px 8px 0;
  line-height: 1.6;
}
.fix-label { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.07em; color: var(--accent); display: block; margin-bottom: 3px; }

/* ── Callout lists ── */
.callout-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }
.callout-list li {
  font-size: 13px;
  color: var(--muted);
  padding: 10px 14px 10px 38px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  line-height: 1.55;
  position: relative;
  box-shadow: var(--shadow);
}
.callout-list.positive li { border-color: #bbf7d0; background: var(--good-bg); color: #166534; }
.callout-list.positive li::before { content: '✓'; position: absolute; left: 14px; color: var(--good); font-weight: 800; }
.callout-list.systemic li::before { content: '⚠'; position: absolute; left: 14px; color: var(--p2); }
</style>
</head>
<body>
<header>
  <div class="logo">fk<span>-skills</span> tool</div>
  <div class="hbadge">local</div>
  <div class="agent-pill">${config.agent}</div>
</header>
<main>

  <div class="form-card">
    <input id="url" class="url-input" type="url" placeholder="https://your-app.com or http://localhost:3000" autocomplete="off" spellcheck="false">
    <div class="mode-tabs">
      <button class="tab active" data-mode="score">Full scan</button>
      <button class="tab" data-mode="check">Static only</button>
    </div>
    <button id="scan" class="scan-btn">Scan</button>
  </div>

  <div id="error" class="error"></div>

  <!-- Progress -->
  <div id="progress" class="progress-panel">
    <div class="progress-header">
      <div class="spinner"></div>
      <div id="progress-label" class="progress-label">Scanning...</div>
    </div>
    <div id="stream-area" class="stream-area"></div>
  </div>

  <!-- Score summary -->
  <div id="sec-scores" class="section">
    <div class="section-title">Design Health Score</div>
    <div class="score-grid">
      <div class="score-card">
        <div class="sc-label">Technical</div>
        <div class="sc-value" id="tech-val">—<span class="sc-max"> /20</span></div>
        <div class="sc-bar"><div class="sc-fill" id="tech-bar" style="width:0%"></div></div>
      </div>
      <div class="score-card">
        <div class="sc-label">UX (Nielsen)</div>
        <div class="sc-value" id="ux-val">—<span class="sc-max"> /40</span></div>
        <div class="sc-bar"><div class="sc-fill" id="ux-bar" style="width:0%"></div></div>
      </div>
      <div class="score-card">
        <div class="sc-label">Slop Test</div>
        <div id="slop-val" class="sc-value" style="font-size:24px">—</div>
        <div id="slop-tags" class="slop-tags"></div>
        <div id="slop-verdict" class="slop-verdict"></div>
      </div>
    </div>
  </div>

  <!-- Summary -->
  <div id="sec-summary" class="section">
    <div class="section-title">Executive Summary</div>
    <div class="summary-card">
      <div id="reg-badge" class="register-badge" style="display:none"></div>
      <div id="summary-text" class="summary-text"></div>
    </div>
  </div>

  <!-- Technical -->
  <div id="sec-tech" class="section">
    <div class="section-title">Technical Audit — 5 Dimensions</div>
    <div class="table-card">
      <table><thead><tr><th>#</th><th>Dimension</th><th>Key Finding</th><th>Score</th></tr></thead>
      <tbody id="tech-body"></tbody></table>
    </div>
  </div>

  <!-- UX -->
  <div id="sec-ux" class="section">
    <div class="section-title">UX — Nielsen's 10 Heuristics</div>
    <div class="table-card">
      <table><thead><tr><th>#</th><th>Heuristic</th><th>Key Issue</th><th>Score</th></tr></thead>
      <tbody id="ux-body"></tbody></table>
    </div>
  </div>

  <!-- Issues -->
  <div id="sec-issues" class="section">
    <div class="section-title" id="issues-label">Issues</div>
    <div id="issues-list"></div>
  </div>

  <!-- Positive -->
  <div id="sec-positive" class="section">
    <div class="section-title">Positive Findings</div>
    <ul id="positive-list" class="callout-list positive"></ul>
  </div>

  <!-- Systemic -->
  <div id="sec-systemic" class="section">
    <div class="section-title">Systemic Issues</div>
    <ul id="systemic-list" class="callout-list systemic"></ul>
  </div>

</main>
<script>
let mode = 'score';

document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    mode = t.dataset.mode;
  });
});

document.getElementById('url').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('scan').click();
});

document.getElementById('scan').addEventListener('click', async () => {
  const url = document.getElementById('url').value.trim();
  if (!url) return;

  reset();
  setScanning(true);

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, mode }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\\n');
      buf = lines.pop();
      let event = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) { event = line.slice(7).trim(); }
        else if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            handleEvent(event, data);
          } catch {}
        }
      }
    }
  } catch (err) {
    showError(err.message);
  } finally {
    setScanning(false);
  }
});

function handleEvent(event, data) {
  if (event === 'status') {
    document.getElementById('progress-label').textContent = data.text;
  } else if (event === 'stream') {
    const area = document.getElementById('stream-area');
    area.textContent += data.text;
    area.scrollTop = area.scrollHeight;
  } else if (event === 'findings') {
    // Static findings arrive early — hold them for merge with result
    window._staticFindings = data.findings || [];
  } else if (event === 'result') {
    document.getElementById('progress').classList.remove('show');
    renderResult(data);
  } else if (event === 'error') {
    showError(data.text);
  } else if (event === 'done') {
    // If only static (check mode), render findings now
    if (window._staticFindings?.length && !document.getElementById('sec-issues').classList.contains('show')) {
      renderIssues(window._staticFindings.map(f => ({
        id: f.antipattern || f.id,
        priority: f.severity || 'P2',
        title: f.name || f.antipattern,
        category: f.category || 'Anti-Pattern',
        location: f.selector || '',
        impact: f.description || '',
      })));
    }
  }
}

function setScanning(on) {
  document.getElementById('scan').disabled = on;
  document.getElementById('progress').classList.toggle('show', on);
}

function reset() {
  document.getElementById('error').classList.remove('show');
  document.getElementById('stream-area').textContent = '';
  document.getElementById('progress-label').textContent = 'Scanning...';
  ['sec-scores','sec-summary','sec-tech','sec-ux','sec-issues','sec-positive','sec-systemic']
    .forEach(id => document.getElementById(id).classList.remove('show'));
  ['tech-body','ux-body','issues-list','positive-list','systemic-list']
    .forEach(id => { document.getElementById(id).innerHTML = ''; });
  document.getElementById('slop-tags').textContent = '';
  document.getElementById('slop-verdict').textContent = '';
  window._staticFindings = [];
}

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.classList.add('show');
}

function show(id) { document.getElementById(id).classList.add('show'); }

function sc(s) { return ['s0','s1','s2','s3','s4'][Math.max(0,Math.min(4,Math.round(s)))]; }
function bar(pct) { return pct >= 0.7 ? 'good' : pct >= 0.45 ? 'mid' : 'bad'; }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderResult(data) {
  const { scores, issues, findings, positiveFindings, systemicIssues, summary, register } = data;

  // Score cards
  if (scores) {
    const { technical: tech, ux, slopTest: slop } = scores;
    if (tech) {
      const p = tech.total / 20;
      document.getElementById('tech-val').innerHTML = \`\${tech.total}<span class="sc-max"> /20</span>\`;
      Object.assign(document.getElementById('tech-bar'), { style: { width: (p*100)+'%' }, className: 'sc-fill '+bar(p) });
    }
    if (ux) {
      const p = ux.total / 40;
      document.getElementById('ux-val').innerHTML = \`\${ux.total}<span class="sc-max"> /40</span>\`;
      Object.assign(document.getElementById('ux-bar'), { style: { width: (p*100)+'%' }, className: 'sc-fill '+bar(p) });
    }
    if (slop) {
      const el = document.getElementById('slop-val');
      el.textContent = slop.passed ? 'Pass' : 'Fail';
      el.className = 'sc-value ' + (slop.passed ? 'slop-pass' : 'slop-fail');
      if (slop.tells?.length) document.getElementById('slop-tags').textContent = slop.tells.join(' · ');
      if (slop.verdict) document.getElementById('slop-verdict').textContent = slop.verdict;
    }
    show('sec-scores');

    // Technical table
    const techRows = Array.isArray(tech?.breakdown) ? tech.breakdown : [];
    const tb = document.getElementById('tech-body');
    techRows.forEach((d,i) => {
      tb.insertAdjacentHTML('beforeend', \`<tr>
        <td class="num-cell">\${i+1}</td>
        <td class="td-name">\${esc(d.label)}</td>
        <td class="td-finding">\${esc(d.keyFinding||'—')}</td>
        <td><span class="score-pill \${sc(d.score)}">\${d.score}<span style="color:var(--faint);font-weight:400">/4</span></span></td>
      </tr>\`);
    });
    if (techRows.length) show('sec-tech');

    // UX table
    const ub = document.getElementById('ux-body');
    (Array.isArray(ux?.heuristics) ? ux.heuristics : []).forEach(h => {
      ub.insertAdjacentHTML('beforeend', \`<tr>
        <td class="num-cell">\${h.id}</td>
        <td class="td-name">\${esc(h.name)}</td>
        <td class="td-finding">\${esc(h.keyIssue||'—')}</td>
        <td><span class="score-pill \${sc(h.score)}">\${h.score}<span style="color:var(--faint);font-weight:400">/4</span></span></td>
      </tr>\`);
    });
    if (ux?.heuristics?.length) show('sec-ux');
  }

  // Summary
  if (summary || register) {
    const b = document.getElementById('reg-badge');
    if (register) { b.textContent = register; b.style.display = 'inline-flex'; }
    document.getElementById('summary-text').textContent = summary || '';
    show('sec-summary');
  }

  // Merge LLM issues + static findings
  const allIssues = [
    ...(issues || []),
    ...(findings || []).map(f => ({
      id: f.antipattern||f.id, priority: f.severity||'P2',
      title: f.name||f.antipattern, category: f.category||'Anti-Pattern',
      location: f.selector||'', impact: f.description||'', recommendation: '',
    })),
  ];
  renderIssues(allIssues);

  // Positive
  if (positiveFindings?.length) {
    const ul = document.getElementById('positive-list');
    positiveFindings.forEach(s => { const li = document.createElement('li'); li.textContent = s; ul.appendChild(li); });
    show('sec-positive');
  }

  // Systemic
  if (systemicIssues?.length) {
    const ul = document.getElementById('systemic-list');
    systemicIssues.forEach(s => { const li = document.createElement('li'); li.textContent = s; ul.appendChild(li); });
    show('sec-systemic');
  }
}

function renderIssues(allIssues) {
  if (!allIssues.length) return;
  const order = { P0:0, P1:1, P2:2, P3:3 };
  allIssues.sort((a,b) => (order[a.priority]??4) - (order[b.priority]??4));
  const list = document.getElementById('issues-list');
  allIssues.forEach(f => {
    const p = (f.priority||'P2').toLowerCase();
    list.insertAdjacentHTML('beforeend', \`
      <div class="issue">
        <div class="issue-top">
          <span class="pchip \${p}">\${f.priority||'P2'}</span>
          <div class="issue-title">\${esc(f.title||f.id)}</div>
        </div>
        \${(f.location||f.category) ? \`<div class="issue-meta">
          \${f.location ? \`<span class="meta-item"><b>Location</b> \${esc(f.location)}</span>\` : ''}
          \${f.category ? \`<span class="meta-item"><b>Category</b> \${esc(f.category)}</span>\` : ''}
        </div>\` : ''}
        \${f.impact ? \`<div class="issue-impact">\${esc(f.impact)}</div>\` : ''}
        \${f.recommendation ? \`<div class="issue-fix"><span class="fix-label">Fix</span>\${esc(f.recommendation)}</div>\` : ''}
      </div>
    \`);
  });
  document.getElementById('issues-label').textContent = \`Issues (\${allIssues.length})\`;
  show('sec-issues');
}
</script>
</body>
</html>`;
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function run(args = []) {
  const forceSetup = args.includes('--setup');
  const portIdx = args.indexOf('--port');
  const port = portIdx !== -1 && args[portIdx + 1] ? parseInt(args[portIdx + 1], 10) : 4444;

  let config = forceSetup ? null : readConfig();

  if (!config) {
    config = await setupWizard();
  } else {
    const ok = spawnSync('which', [config.agent], { encoding: 'utf-8' }).status === 0;
    if (!ok) { console.log(`\n  "${config.agent}" not found in PATH.`); config = await setupWizard(); }
  }

  const server = await startServer(config, port);
  const url = `http://localhost:${port}`;
  console.log(`\n  fk-skills tool  →  ${url}`);
  console.log(`  Agent: ${config.agent}  |  Ctrl+C to stop\n`);

  try {
    const open = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawnSync(open, [url], { detached: true, stdio: 'ignore' });
  } catch {}

  process.on('SIGINT', () => { server.close(); process.exit(0); });
}
