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

  console.log('\n  fk-skills tool — cài đặt\n');
  const clis = detectAvailableClis();

  if (!clis.length) {
    console.log('  Không tìm thấy AI CLI (claude / codex).\n');
    console.log('  Cài Claude Code: npm install -g @anthropic-ai/claude-code');
    console.log('  Cài Codex CLI:   npm i -g @openai/codex\n');
    rl.close(); process.exit(1);
  }

  let agent = clis[0];
  if (clis.length > 1) {
    console.log(`  Phát hiện: ${clis.join(', ')}`);
    const ans = await ask(`  Dùng cái nào? [${clis[0]}] `);
    if (clis.includes(ans.trim())) agent = ans.trim();
  } else {
    console.log(`  Phát hiện: ${agent} ✓`);
  }

  const scopeAns = await ask('  Phạm vi — global hay project? [global] ');
  const scope = scopeAns.trim() === 'project' ? 'project' : 'global';
  rl.close();

  const config = { agent, scope };
  const saved = writeConfig(config, scope);
  console.log(`\n  Đã lưu tại ${saved}`);
  return config;
}

// ─── HTML prep ─────────────────────────────────────────────────────────────

function isSpaShell(html) {
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const stripped = body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length < 200;
}

async function ensurePlaywrightBrowser() {
  const { execSync } = await import('node:child_process');
  execSync('npx playwright install chromium', {
    stdio: 'inherit', timeout: 180000, shell: true,
  });
}

async function renderWithBrowser(url, onStatus) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Thiếu playwright — chạy: npm install');
  }

  onStatus('Khởi động trình duyệt ảo...');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    if (err.message?.includes('Executable') || err.message?.includes('not found')) {
      onStatus('Cài Chromium lần đầu (khoảng 100MB)...');
      await ensurePlaywrightBrowser();
      browser = await chromium.launch({ headless: true });
    } else {
      throw err;
    }
  }

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(800);
    const html = await page.content();
    onStatus('Render hoàn tất.');
    return html;
  } finally {
    await browser.close();
  }
}

function prepareHtml(raw) {
  let html = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s{3,}/g, '  ')
    .trim();

  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (body) html = body[1].trim();

  return html.slice(0, 12000);
}

// ─── Scoring prompt ────────────────────────────────────────────────────────

const SCORE_PROMPT = `You are a senior design director applying fk-skills design standards. Analyze the HTML and return ONLY valid JSON — no markdown, no explanation, no code fences.

Evaluate against:
- Absolute bans: side-stripe borders, gradient text (background-clip:text), glassmorphism decoratively, hero-metric template, identical card grids, tracked eyebrow on every section, numbered section scaffolding
- Slop tells: gradient-text, glassmorphism-overuse, identical-card-grids, hero-metrics-row, eyebrow-every-section, excessive-border-radius, everything-in-cards, bento-grid, emoji-overuse, oversized-h1, side-stripe-border
- Technical: accessibility (WCAG 2.1 AA), performance, theming/color tokens, responsive design, anti-patterns
- UX: Nielsen's 10 heuristics

Required JSON schema (all issues/findings/summary MUST be in Vietnamese):
{
  "register": "brand" | "product",
  "scores": {
    "technical": {
      "total": <0-20>,
      "breakdown": [
        { "id": "accessibility", "label": "Kha nang tiep can", "score": <0-4>, "keyFinding": "<finding>" },
        { "id": "performance",   "label": "Hieu suat",         "score": <0-4>, "keyFinding": "<finding>" },
        { "id": "theming",       "label": "Mau sac & Giao dien","score": <0-4>, "keyFinding": "<finding>" },
        { "id": "responsive",    "label": "Responsive",         "score": <0-4>, "keyFinding": "<finding>" },
        { "id": "antiPatterns",  "label": "Anti-Pattern",       "score": <0-4>, "keyFinding": "<finding>" }
      ]
    },
    "ux": {
      "total": <0-40>,
      "heuristics": [
        { "id": 1,  "name": "Trang thai he thong ro rang",       "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 2,  "name": "Phu hop thuc te nguoi dung",        "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 3,  "name": "Kiem soat va tu do",                "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 4,  "name": "Nhat quan va chuan muc",            "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 5,  "name": "Ngan ngua loi",                     "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 6,  "name": "Nhan dien thay vi ghi nho",         "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 7,  "name": "Linh hoat va hieu qua",             "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 8,  "name": "Thiet ke toi gian",                 "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 9,  "name": "Xu ly loi",                         "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 10, "name": "Tai lieu va ho tro",                "score": <0-4>, "keyIssue": "<finding>" }
      ]
    },
    "slopTest": {
      "passed": true | false,
      "tells": [],
      "verdict": "<1-2 sentence honest verdict in Vietnamese>"
    }
  },
  "issues": [
    {
      "id": "kebab-id",
      "priority": "P0"|"P1"|"P2"|"P3",
      "title": "<short name in Vietnamese>",
      "location": "<selector or area>",
      "category": "Kha nang tiep can"|"Hieu suat"|"Giao dien"|"Responsive"|"Anti-Pattern"|"UX",
      "impact": "<user impact in Vietnamese, 1 sentence>",
      "recommendation": "<actionable fix in Vietnamese, 1-2 sentences>"
    }
  ],
  "positiveFindings": ["<strength in Vietnamese>"],
  "systemicIssues": ["<recurring pattern in Vietnamese>"],
  "summary": "<2-3 sentence executive summary in Vietnamese>"
}

P0=blocks completely, P1=severe, P2=minor, P3=polish. Include 6-10 issues.
register: brand=marketing/landing, product=app/dashboard/tool
technical scores 0-4: 4=excellent, 3=good, 2=fair, 1=poor, 0=critical failure`;

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

// ─── Scan handler ─────────────────────────────────────────────────────────

async function handleScan(body, config, res) {
  const { url } = body;
  if (!url) { sseEvent(res, 'error', { text: 'Vui lòng nhập URL' }); return; }

  const start = Date.now();

  sseEvent(res, 'status', { text: 'Đang tải trang...' });
  let html;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'fk-skills-tool/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    html = await r.text();

    if (isSpaShell(html)) {
      sseEvent(res, 'status', { text: 'Phát hiện SPA — đang render bằng trình duyệt ảo...' });
      html = await renderWithBrowser(url, text => sseEvent(res, 'status', { text }));
    }
  } catch (err) {
    sseEvent(res, 'error', { text: `Không thể tải trang: ${err.message}` });
    return;
  }

  sseEvent(res, 'status', { text: 'Đang phát hiện anti-pattern...' });
  let findings = [];
  try {
    findings = await runDetectHtml(html, url);
    sseEvent(res, 'findings', { findings });
  } catch (err) {
    sseEvent(res, 'status', { text: `Cảnh báo phân tích tĩnh: ${err.message}` });
  }

  sseEvent(res, 'status', { text: `Đang chấm điểm với ${config.agent}...` });

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
      sseEvent(res, 'error', { text: `${config.agent} hết thời gian chờ (3 phút)` });
      resolve();
    }, 180000);

    proc.stdout.on('data', chunk => {
      const text = chunk.toString();
      buffer += text;
      sseEvent(res, 'stream', { text });
    });

    proc.stderr.on('data', chunk => {
      const t = chunk.toString().trim();
      if (t) sseEvent(res, 'status', { text: t });
    });

    proc.on('error', err => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sseEvent(res, 'error', { text: `Lỗi ${config.agent}: ${err.message}` });
      resolve();
    });

    proc.on('close', code => {
      if (done) return;
      done = true;
      clearTimeout(timer);

      if (code !== 0 && !buffer.trim()) {
        sseEvent(res, 'error', { text: `${config.agent} thoát với mã lỗi ${code}` });
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
        sseEvent(res, 'error', { text: 'Không thể đọc kết quả — vui lòng thử lại' });
      }
      resolve();
    });
  });

  sseEvent(res, 'done', { durationMs: Date.now() - start });
}

// ─── HTTP server ───────────────────────────────────────────────────────────

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
      if (err.code === 'EADDRINUSE') reject(new Error(`Cổng ${port} đang được sử dụng. Thử --port <khác>`));
      else reject(err);
    });
    server.listen(port, '127.0.0.1', resolve);
  });

  return server;
}

// ─── Inline HTML UI ───────────────────────────────────────────────────────

function buildUI(config) {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>fk skills — Kiểm tra Giao diện</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Alumni+Sans+Pinstripe&family=Albert+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:          oklch(100% 0 0);
  --sidebar-bg:  oklch(96.5% 0 0);
  --surface2:    oklch(97.5% 0 0);
  --rule:        oklch(91% 0 0);
  --rule-faint:  oklch(95% 0 0);

  --ink:   oklch(13% 0.016 95);
  --text:  oklch(21% 0.014 95);
  --muted: oklch(42% 0.01 95);
  --faint: oklch(60% 0.008 95);

  --gold:        oklch(84% 0.19 80.46);
  --gold-pale:   oklch(93% 0.05 82);
  --gold-text:   oklch(50% 0.13 76);
  --gold-bg:     oklch(98.5% 0.016 82);
  --gold-border: oklch(88% 0.055 82);

  --patina:        oklch(70% 0.12 188);
  --patina-text:   oklch(34% 0.1 188);
  --patina-bg:     oklch(97% 0.025 188);
  --patina-border: oklch(86% 0.058 188);

  --p0-color:  oklch(45% 0.2 25);
  --p0-bg:     oklch(98% 0.014 25);
  --p0-border: oklch(87% 0.05 25);
  --p0-title:  oklch(38% 0.22 25);

  --p1-color:  oklch(46% 0.17 46);
  --p1-bg:     oklch(98.5% 0.01 58);
  --p1-title:  oklch(41% 0.18 46);

  --font-display: 'Alumni Sans Pinstripe', 'Albert Sans', Arial, sans-serif;
  --font-body:    'Albert Sans', 'Avenir Next', Helvetica, Arial, system-ui, sans-serif;
  --font-mono:    'SF Mono', 'Roboto Mono', Consolas, monospace;
}

html, body { height: 100%; overflow: hidden; }
body {
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* ── Top bar ── */
.top-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 52px;
  padding: 0 20px;
  border-bottom: 1px solid var(--rule);
  background: var(--bg);
  flex-shrink: 0;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  width: 148px;
}
.brand-mark {
  width: 18px; height: 18px;
  background: var(--ink);
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
}
.brand-mark::after {
  content: '';
  position: absolute;
  top: 0; right: 0;
  border-style: solid;
  border-width: 0 18px 18px 0;
  border-color: transparent var(--gold) transparent transparent;
}
.wordmark {
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink);
  white-space: nowrap;
}
.wordmark span { color: var(--gold-text); }

.form-row { flex: 1; display: flex; gap: 8px; min-width: 0; }
.url-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  border: 1px solid var(--rule);
  border-radius: 3px;
  padding: 0 14px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.url-input:focus {
  border-color: var(--gold);
  box-shadow: 0 0 0 2px oklch(84% 0.19 80.46 / 0.14);
}
.url-input::placeholder { color: var(--faint); }
.scan-btn {
  height: 36px;
  padding: 0 22px;
  background: var(--ink);
  color: oklch(96% 0 0);
  border: none;
  border-radius: 3px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.14s, box-shadow 0.2s;
}
.scan-btn.ready { box-shadow: 0 0 0 2px oklch(84% 0.19 80.46 / 0.3); }
.scan-btn:hover { background: oklch(22% 0.02 95); }
.scan-btn:disabled { opacity: 0.38; cursor: not-allowed; box-shadow: none; }
.agent-tag {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--gold-text);
  background: var(--gold-bg);
  border: 1px solid var(--gold-border);
  padding: 3px 8px;
  border-radius: 2px;
  text-transform: uppercase;
  flex-shrink: 0;
}

/* ── Workspace ── */
.workspace { flex: 1; display: flex; overflow: hidden; }

/* ── Sidebar ── */
.sidebar {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--rule);
  background: var(--sidebar-bg);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.sidebar-idle {
  padding: 40px 20px 20px;
  color: var(--faint);
  font-size: 12px;
  line-height: 1.7;
}

/* Score blocks */
.score-block {
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--rule);
}
.score-eyebrow {
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--faint);
  margin-bottom: 8px;
}
.score-num {
  font-family: var(--font-display);
  font-size: 2.6rem;
  line-height: 1;
  color: var(--ink);
  font-weight: 300;
}
.score-denom { font-size: 12px; color: var(--faint); margin-top: 2px; margin-bottom: 8px; }
.score-interp { font-size: 11px; font-weight: 600; margin-bottom: 8px; display: none; }
.score-interp.show { display: block; }
.si-great { color: var(--patina-text); }
.si-good  { color: var(--gold-text); }
.si-mid   { color: var(--p1-color); }
.si-bad   { color: var(--p0-color); }
.score-bar-track { height: 2px; background: var(--rule); border-radius: 1px; overflow: hidden; }
.score-bar-fill {
  height: 100%;
  width: 0%;
  border-radius: 1px;
  transition: width 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.3s;
}
.bar-great { background: var(--patina); }
.bar-good  { background: var(--gold); }
.bar-mid   { background: var(--p1-color); }
.bar-bad   { background: var(--p0-color); }
.slop-result {
  font-family: var(--font-display);
  font-size: 2rem;
  font-weight: 300;
  line-height: 1;
  margin-bottom: 4px;
}
.slop-pass { color: var(--patina-text); }
.slop-fail { color: var(--p0-color); }

/* Nav */
.sidebar-nav { padding: 8px 0 20px; }
.nav-item {
  display: flex;
  align-items: center;
  padding: 8px 20px;
  font-size: 13px;
  cursor: pointer;
  color: var(--muted);
  transition: background 0.1s, color 0.1s;
  user-select: none;
}
.nav-item:hover { background: oklch(94% 0 0); color: var(--text); }
.nav-item.active {
  background: var(--bg);
  color: var(--ink);
  font-weight: 600;
  box-shadow: inset 2px 0 0 var(--gold);
}
.nav-count {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--faint);
}
.nav-item.has-critical .nav-count { color: var(--p0-color); font-weight: 600; }

/* ── Main panel ── */
.main-panel {
  flex: 1;
  overflow-y: auto;
  background: var(--bg);
  display: flex;
  flex-direction: column;
}
.panel-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--faint);
  font-size: 13px;
  gap: 10px;
  padding: 60px 40px;
  text-align: center;
}
.empty-mark {
  width: 32px; height: 32px;
  background: var(--sidebar-bg);
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  margin-bottom: 4px;
}
.empty-mark::after {
  content: '';
  position: absolute;
  top: 0; right: 0;
  border-style: solid;
  border-width: 0 32px 32px 0;
  border-color: transparent var(--rule) transparent transparent;
}

/* Progress */
.panel-progress { padding: 32px 40px; }
.progress-label { font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 12px; }
.progress-dots::after {
  content: '';
  animation: dots 1.4s steps(4, end) infinite;
}
@keyframes dots {
  0%   { content: ''; }
  25%  { content: '.'; }
  50%  { content: '..'; }
  75%  { content: '...'; }
}
.sweep-track { height: 2px; background: var(--rule); overflow: hidden; margin-bottom: 16px; }
.sweep-fill { height: 100%; background: var(--gold); width: 0%; }
.sweep-fill.running { animation: sweep 2.8s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
@keyframes sweep {
  0%   { width: 0%; }
  45%  { width: 68%; }
  75%  { width: 84%; }
  100% { width: 84%; }
}
.stream-box {
  background: var(--surface2);
  border-radius: 2px;
  padding: 14px 16px;
  max-height: 200px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.7;
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-all;
}
.stream-box:empty { display: none; }

/* Error */
.error-bar {
  margin: 20px 40px 0;
  padding: 12px 16px;
  background: var(--p0-bg);
  border: 1px solid var(--p0-border);
  border-radius: 3px;
  color: var(--p0-color);
  font-size: 13px;
  font-weight: 500;
  display: none;
}
.error-bar.show { display: block; }

/* Panel content */
.panel-content { padding: 32px 40px 60px; display: none; }
.panel-content.show { display: block; }

/* Overview */
.overview-summary {
  max-width: 66ch;
  font-size: 14px;
  color: var(--muted);
  line-height: 1.8;
  text-wrap: pretty;
  margin-bottom: 24px;
}
.reg-badge {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--gold-text);
  border: 1px solid var(--gold-border);
  padding: 3px 8px;
  border-radius: 2px;
  margin-bottom: 14px;
}
.overview-hint { font-size: 12px; color: var(--faint); font-style: italic; margin-top: 16px; }

/* Dimension tables */
.dim-table { width: 100%; border-collapse: collapse; }
.dim-table thead th {
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.13em;
  font-weight: 500;
  text-transform: uppercase;
  color: var(--faint);
  padding: 0 0 12px;
  text-align: left;
  border-bottom: 1px solid var(--rule);
}
.dim-table thead th:last-child { text-align: right; }
.dim-table tbody tr { border-bottom: 1px solid var(--rule-faint); }
.dim-table tbody tr:last-child { border-bottom: none; }
.dim-table tbody tr:hover { background: oklch(99.5% 0 0); }
.dim-table tbody td { padding: 14px 0 13px; vertical-align: top; }
.dim-table tbody td:last-child { text-align: right; }
.col-num  { font-family: var(--font-mono); font-size: 11px; color: var(--faint); width: 28px; }
.col-name { font-weight: 600; font-size: 13px; color: var(--ink); padding-right: 20px; min-width: 130px; }
.col-find { font-size: 12.5px; color: var(--muted); line-height: 1.55; }
.schip { font-family: var(--font-mono); font-size: 13px; font-weight: 600; white-space: nowrap; }
.s4 { color: var(--patina-text); }
.s3 { color: oklch(38% 0.12 145); }
.s2 { color: var(--gold-text); }
.s1 { color: var(--p1-color); }
.s0 { color: var(--p0-color); }
.chip-max { font-weight: 400; color: var(--faint); }

/* Panel head label */
.panel-head {
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--faint);
  margin-bottom: 20px;
}

/* ── Issue rows (accordion, no cards) ── */
.issue-row {
  border-bottom: 1px solid var(--rule-faint);
  cursor: pointer;
  transition: background 0.1s;
}
.issue-row:last-child { border-bottom: none; }
.issue-row:hover { background: oklch(99% 0 0); }

/* P0/P1: row background tint only — not a card */
.issue-row.sev-p0 { background: var(--p0-bg); }
.issue-row.sev-p0:hover { background: oklch(97% 0.018 25); }
.issue-row.sev-p1 { background: var(--p1-bg); }
.issue-row.sev-p1:hover { background: oklch(97.5% 0.014 58); }

.issue-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 18px 0 16px;
}
.sev-p0 .issue-head,
.sev-p1 .issue-head { padding-left: 16px; padding-right: 16px; }

.p-chip {
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 3px 6px;
  border-radius: 2px;
  flex-shrink: 0;
  margin-top: 2px;
}
.p-chip.P0 { color: var(--p0-color); background: oklch(94% 0.04 25); border: 1.5px solid var(--p0-border); }
.p-chip.P1 { color: var(--p1-color); background: oklch(94% 0.03 50); border: 1.5px solid oklch(87% 0.045 58); }
.p-chip.P2 { color: var(--gold-text); background: var(--gold-bg); border: 1px solid var(--gold-border); }
.p-chip.P3 { color: var(--faint); background: var(--surface2); border: 1px solid var(--rule); }

.issue-title-area { flex: 1; min-width: 0; }
.issue-title { font-size: 13.5px; font-weight: 600; color: var(--ink); line-height: 1.35; margin-bottom: 4px; }
.sev-p0 .issue-title { color: var(--p0-title); }
.sev-p1 .issue-title { color: var(--p1-title); }
.issue-meta {
  font-size: 11px;
  color: var(--faint);
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.issue-meta b { color: var(--muted); font-weight: 600; margin-right: 3px; }

.issue-toggle {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--faint);
  flex-shrink: 0;
  margin-top: 2px;
  transition: transform 0.2s;
}
.issue-row.open .issue-toggle { transform: rotate(180deg); }

.issue-body { max-height: 0; overflow: hidden; transition: max-height 0.24s cubic-bezier(0.4, 0, 0.2, 1); }
.issue-row.open .issue-body { max-height: 400px; }
.issue-body-inner { padding: 0 0 20px 50px; }
.sev-p0 .issue-body-inner,
.sev-p1 .issue-body-inner { padding-left: 66px; padding-right: 16px; }
.issue-impact { font-size: 13px; color: var(--muted); line-height: 1.65; margin-bottom: 12px; }
.issue-fix {
  padding: 11px 14px;
  background: var(--gold-bg);
  border: 1px solid var(--gold-border);
  border-radius: 3px;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text);
}
.fix-label {
  display: block;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.15em;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--gold-text);
  margin-bottom: 4px;
}

/* Positive/systemic lists */
.callout-list { list-style: none; }
.callout-list li {
  font-size: 13px;
  line-height: 1.65;
  padding: 13px 0 13px 26px;
  border-bottom: 1px solid var(--rule-faint);
  position: relative;
  color: var(--muted);
}
.callout-list li:last-child { border-bottom: none; }
.callout-list.positive li { color: var(--patina-text); }
.callout-list.positive li::before { content: '✓'; position: absolute; left: 0; color: var(--patina); font-weight: 700; }
.callout-list.systemic li::before { content: '◆'; position: absolute; left: 0; color: var(--p1-color); font-size: 9px; top: 17px; }

.slop-verdict-panel {
  font-size: 13px; color: var(--muted); line-height: 1.7;
  font-style: italic; max-width: 60ch; margin-bottom: 16px; text-wrap: pretty;
}
.slop-tells { font-family: var(--font-mono); font-size: 11px; color: var(--muted); line-height: 1.8; }

/* Animations */
@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}
@keyframes interpretIn {
  from { opacity: 0; transform: translateY(3px); }
  to   { opacity: 1; transform: none; }
}
@keyframes warnPulse {
  0%, 100% { background: var(--p0-bg); }
  50%       { background: oklch(96% 0.026 25); }
}

@media (max-width: 700px) {
  .sidebar { width: 180px; }
  .panel-content { padding: 24px 20px 50px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
  .issue-body { transition: none; }
  .issue-row.open .issue-body { max-height: 400px; }
}
</style>
</head>
<body>

<div class="top-bar">
  <div class="brand">
    <div class="brand-mark"></div>
    <div class="wordmark">fk <span>skills</span></div>
  </div>
  <div class="form-row">
    <input id="url" class="url-input" type="url"
      placeholder="https://trang-web.com hoặc http://localhost:3000"
      autocomplete="off" spellcheck="false">
    <button id="scan" class="scan-btn">Quét</button>
  </div>
  <span class="agent-tag">${config.agent}</span>
</div>

<div class="workspace">
  <aside class="sidebar" id="sidebar">
    <div id="sidebar-idle" class="sidebar-idle">Nhập URL để bắt đầu kiểm tra giao diện.</div>
    <div id="sidebar-scanning" style="display:none">
      <div class="score-block" style="padding-top:28px">
        <div class="score-eyebrow">Đang quét</div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px" id="sb-status">
          Khởi động<span class="progress-dots"></span>
        </div>
      </div>
    </div>
    <div id="sidebar-results" style="display:none">
      <div id="sidebar-scores"></div>
      <nav id="sidebar-nav" class="sidebar-nav"></nav>
    </div>
  </aside>

  <main class="main-panel" id="main-panel">
    <div id="panel-idle" class="panel-empty">
      <div class="empty-mark"></div>
      Nhập URL và nhấn Quét để bắt đầu.
    </div>
    <div id="panel-scanning" style="display:none" class="panel-progress">
      <div class="sweep-track"><div class="sweep-fill" id="sweep"></div></div>
      <div class="progress-label" id="panel-status">Đang quét<span class="progress-dots"></span></div>
      <div class="stream-box" id="stream-area"></div>
    </div>
    <div id="error-bar" class="error-bar"></div>
    <div class="panel-content" id="panel-overview"></div>
    <div class="panel-content" id="panel-critical"></div>
    <div class="panel-content" id="panel-all"></div>
    <div class="panel-content" id="panel-tech"></div>
    <div class="panel-content" id="panel-ux"></div>
    <div class="panel-content" id="panel-positive"></div>
  </main>
</div>

<script>
const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function normPriority(p) {
  if (/^P[0-3]$/.test(p || '')) return p;
  if (p === 'error')   return 'P1';
  if (p === 'warning') return 'P2';
  if (p === 'info')    return 'P3';
  return 'P2';
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function interpret(score, max) {
  const p = score / max;
  if (p >= 0.85) return { text: 'Xuất sắc',       cls: 'si-great', bar: 'bar-great' };
  if (p >= 0.70) return { text: 'Khá tốt',         cls: 'si-good',  bar: 'bar-good'  };
  if (p >= 0.50) return { text: 'Cần cải thiện',   cls: 'si-mid',   bar: 'bar-mid'   };
  return             { text: 'Cần xem lại',     cls: 'si-bad',   bar: 'bar-bad'   };
}

function sc(s) {
  return ['s0','s1','s2','s3','s4'][Math.max(0, Math.min(4, Math.round(s || 0)))];
}

function countUp(el, target, dur, onDone) {
  if (rm || typeof target !== 'number') { el.textContent = target; if (onDone) onDone(); return; }
  const d = dur || 900;
  const t0 = performance.now();
  (function tick(now) {
    const progress = Math.min((now - t0) / d, 1);
    const ease = 1 - Math.pow(1 - progress, 4);
    el.textContent = Math.round(ease * target);
    if (progress < 1) requestAnimationFrame(tick);
    else { el.textContent = target; if (onDone) onDone(); }
  })(performance.now());
}

// Input events
document.getElementById('url').addEventListener('input', () => {
  const has = document.getElementById('url').value.trim().length > 7;
  document.getElementById('scan').classList.toggle('ready', has);
});
document.getElementById('url').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('scan').click();
});

document.getElementById('scan').addEventListener('click', async () => {
  const url = document.getElementById('url').value.trim();
  if (!url) return;
  resetUI();
  setScanning(true);
  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
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
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        else if (line.startsWith('data: ')) {
          try { handleEvent(event, JSON.parse(line.slice(6))); } catch {}
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
    const txt = esc(data.text) + '<span class="progress-dots"></span>';
    document.getElementById('panel-status').innerHTML = txt;
    document.getElementById('sb-status').innerHTML = txt;
  } else if (event === 'stream') {
    const area = document.getElementById('stream-area');
    area.textContent += data.text;
    area.scrollTop = area.scrollHeight;
  } else if (event === 'findings') {
    window._findings = (data.findings || []).map(f => ({
      id: f.antipattern || f.id || 'finding',
      priority: normPriority(f.severity),
      title: f.name || f.antipattern || f.id,
      location: f.selector || f.location || '',
      category: f.category === 'slop' ? 'Anti-Pattern' : (f.category || 'Anti-Pattern'),
      impact: f.description || '',
      recommendation: '',
    }));
  } else if (event === 'result') {
    setScanning(false);
    renderResults(data);
  } else if (event === 'error') {
    setScanning(false);
    showError(data.text);
  }
}

function setScanning(on) {
  document.getElementById('scan').disabled = on;
  if (!on) document.getElementById('scan').classList.remove('ready');
  document.getElementById('panel-idle').style.display = on ? 'none' : '';
  document.getElementById('panel-scanning').style.display = on ? 'block' : 'none';
  document.getElementById('sidebar-idle').style.display = on ? 'none' : '';
  document.getElementById('sidebar-scanning').style.display = on ? 'block' : 'none';
  const sweep = document.getElementById('sweep');
  if (on) { sweep.style.cssText = 'width:0%;opacity:1;transition:none;'; sweep.classList.add('running'); }
  else    { sweep.classList.remove('running'); }
}

function resetUI() {
  document.getElementById('error-bar').classList.remove('show');
  document.getElementById('stream-area').textContent = '';
  document.getElementById('sidebar-results').style.display = 'none';
  document.getElementById('panel-idle').style.display = 'none';
  ['panel-overview','panel-critical','panel-all','panel-tech','panel-ux','panel-positive'].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = ''; el.classList.remove('show');
  });
  window._findings = []; window._data = null;
}

function showError(msg) {
  const el = document.getElementById('error-bar');
  el.textContent = msg; el.classList.add('show');
  document.getElementById('panel-idle').style.display = 'flex';
  document.getElementById('sidebar-idle').style.display = 'block';
}

// ── Render results ──────────────────────────────────────────────────────────

function renderResults(data) {
  window._data = data;
  const issues = mergeIssues(data.issues || [], window._findings || []);
  window._allIssues = issues;
  const critical = issues.filter(i => i.priority === 'P0' || i.priority === 'P1');

  buildSidebarScores(data);
  buildSidebarNav(issues, critical, data);

  document.getElementById('sidebar-idle').style.display = 'none';
  document.getElementById('sidebar-scanning').style.display = 'none';
  document.getElementById('sidebar-results').style.display = 'block';

  buildPanelOverview(data, issues, critical);
  buildPanelIssues('panel-critical', critical, 'Vấn đề nghiêm trọng');
  buildPanelIssues('panel-all', issues, 'Tất cả vấn đề');
  buildPanelTech(data.scores && data.scores.technical);
  buildPanelUX(data.scores && data.scores.ux);
  buildPanelPositive(data.positiveFindings, data.systemicIssues, data.scores && data.scores.slopTest);

  activateNav(critical.length > 0 ? 'critical' : 'overview');
  document.getElementById('panel-scanning').style.display = 'none';
}

function mergeIssues(llm, statics) {
  const seen = new Set();
  const out = [];
  for (const i of llm) {
    const key = (i.title || i.id || '').toLowerCase().slice(0, 40);
    if (!seen.has(key)) { seen.add(key); out.push(i); }
  }
  for (const i of statics) {
    const key = (i.title || i.id || '').toLowerCase().slice(0, 40);
    if (!seen.has(key)) { seen.add(key); out.push(i); }
  }
  const ord = { P0: 0, P1: 1, P2: 2, P3: 3 };
  out.sort((a, b) => (ord[a.priority] || 4) - (ord[b.priority] || 4));
  return out;
}

function buildSidebarScores(data) {
  const el = document.getElementById('sidebar-scores');
  const scores = data.scores || {};
  const tech = scores.technical;
  const ux   = scores.ux;
  const slop = scores.slopTest;
  let html = '';

  if (tech) {
    html += \`<div class="score-block">
      <div class="score-eyebrow">Kỹ thuật</div>
      <div class="score-num" id="snum-tech">0</div>
      <div class="score-denom">/20</div>
      <div class="score-interp" id="sinterp-tech"></div>
      <div class="score-bar-track"><div class="score-bar-fill" id="sbar-tech"></div></div>
    </div>\`;
  }
  if (ux) {
    html += \`<div class="score-block">
      <div class="score-eyebrow">UX · Nielsen</div>
      <div class="score-num" id="snum-ux">0</div>
      <div class="score-denom">/40</div>
      <div class="score-interp" id="sinterp-ux"></div>
      <div class="score-bar-track"><div class="score-bar-fill" id="sbar-ux"></div></div>
    </div>\`;
  }
  if (slop) {
    html += \`<div class="score-block">
      <div class="score-eyebrow">Slop Test</div>
      <div class="slop-result \${slop.passed ? 'slop-pass' : 'slop-fail'}">\${slop.passed ? 'Đạt' : 'Không đạt'}</div>
    </div>\`;
  }
  el.innerHTML = html;

  if (tech) {
    const interp = interpret(tech.total, 20);
    countUp(document.getElementById('snum-tech'), tech.total, 900, () => {
      const si = document.getElementById('sinterp-tech');
      si.textContent = interp.text;
      si.className = 'score-interp show ' + interp.cls;
      if (!rm) si.style.animation = 'interpretIn 0.35s ease both';
    });
    setTimeout(() => {
      const bar = document.getElementById('sbar-tech');
      bar.style.width = (tech.total / 20 * 100) + '%';
      bar.className = 'score-bar-fill ' + interp.bar;
    }, 150);
  }
  if (ux) {
    const interp = interpret(ux.total, 40);
    countUp(document.getElementById('snum-ux'), ux.total, 960, () => {
      const si = document.getElementById('sinterp-ux');
      si.textContent = interp.text;
      si.className = 'score-interp show ' + interp.cls;
      if (!rm) si.style.animation = 'interpretIn 0.35s ease both';
    });
    setTimeout(() => {
      const bar = document.getElementById('sbar-ux');
      bar.style.width = (ux.total / 40 * 100) + '%';
      bar.className = 'score-bar-fill ' + interp.bar;
    }, 200);
  }
}

function buildSidebarNav(issues, critical, data) {
  const el = document.getElementById('sidebar-nav');
  const tech = data.scores && data.scores.technical;
  const ux   = data.scores && data.scores.ux;
  const slop = data.scores && data.scores.slopTest;
  const pos  = (data.positiveFindings && data.positiveFindings.length > 0) ||
               (data.systemicIssues && data.systemicIssues.length > 0) || slop;

  let html = '';
  if (critical.length > 0) {
    html += \`<div class="nav-item has-critical" data-view="critical">Nghiêm trọng<span class="nav-count">\${critical.length}</span></div>\`;
  }
  html += \`<div class="nav-item" data-view="overview">Tổng quan</div>\`;
  html += \`<div class="nav-item" data-view="all">Tất cả vấn đề<span class="nav-count">\${issues.length}</span></div>\`;
  if (tech) html += '<div class="nav-item" data-view="tech">Kỹ thuật</div>';
  if (ux)   html += '<div class="nav-item" data-view="ux">UX · Nielsen</div>';
  if (pos)  html += '<div class="nav-item" data-view="positive">Điểm mạnh</div>';

  el.innerHTML = html;
  el.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => activateNav(item.dataset.view));
  });
}

function activateNav(view) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  ['panel-overview','panel-critical','panel-all','panel-tech','panel-ux','panel-positive'].forEach(id => {
    document.getElementById(id).classList.remove('show');
  });
  const panel = document.getElementById('panel-' + view);
  if (panel) {
    panel.classList.add('show');
    if (!rm) {
      panel.style.animation = 'none';
      requestAnimationFrame(() => { panel.style.animation = 'fadeSlideUp 0.28s ease forwards'; });
    }
  }
}

// ── Panel builders ──────────────────────────────────────────────────────────

function buildPanelOverview(data, issues, critical) {
  const el = document.getElementById('panel-overview');
  let html = '';
  if (data.register) {
    const label = data.register === 'brand' ? 'Thương hiệu' : data.register === 'product' ? 'Sản phẩm' : data.register;
    html += \`<div class="reg-badge">\${esc(label)}</div>\`;
  }
  if (data.summary) html += \`<p class="overview-summary">\${esc(data.summary)}</p>\`;
  if (critical.length > 0) {
    html += \`<p class="overview-hint">Có \${critical.length} vấn đề nghiêm trọng — nhấn <strong>Nghiêm trọng</strong> ở thanh bên để xem.</p>\`;
  } else if (issues.length > 0) {
    html += \`<p class="overview-hint">Tìm thấy \${issues.length} vấn đề — nhấn <strong>Tất cả vấn đề</strong> để xem chi tiết.</p>\`;
  }
  el.innerHTML = html;
}

function buildPanelIssues(panelId, issues, headLabel) {
  const el = document.getElementById(panelId);
  if (!issues.length) {
    el.innerHTML = \`<div class="panel-head">\${esc(headLabel)}</div><p style="color:var(--faint);font-size:13px">Không có vấn đề nào.</p>\`;
    return;
  }
  let html = \`<div class="panel-head">\${esc(headLabel)} (\${issues.length})</div><div>\`;
  issues.forEach((f) => {
    const p = normPriority(f.priority);
    const sev = p === 'P0' ? 'sev-p0' : p === 'P1' ? 'sev-p1' : '';
    html += \`<div class="issue-row \${sev}">
      <div class="issue-head">
        <span class="p-chip \${p}">\${p}</span>
        <div class="issue-title-area">
          <div class="issue-title">\${esc(f.title || f.id)}</div>
          <div class="issue-meta">
            \${f.location ? \`<span><b>Vị trí</b>\${esc(f.location)}</span>\` : ''}
            \${f.category ? \`<span><b>Loại</b>\${esc(f.category)}</span>\` : ''}
          </div>
        </div>
        <span class="issue-toggle">▾</span>
      </div>
      <div class="issue-body">
        <div class="issue-body-inner">
          \${f.impact ? \`<div class="issue-impact">\${esc(f.impact)}</div>\` : ''}
          \${f.recommendation ? \`<div class="issue-fix"><span class="fix-label">Cách sửa</span>\${esc(f.recommendation)}</div>\` : ''}
        </div>
      </div>
    </div>\`;
  });
  html += '</div>';
  el.innerHTML = html;

  // Accordion
  el.querySelectorAll('.issue-row').forEach(row => {
    row.querySelector('.issue-head').addEventListener('click', () => {
      const wasOpen = row.classList.contains('open');
      el.querySelectorAll('.issue-row.open').forEach(r => r.classList.remove('open'));
      if (!wasOpen) row.classList.add('open');
    });
  });

  // Stagger + P0 pulse
  if (!rm) {
    el.querySelectorAll('.issue-row').forEach((row, i) => {
      const delay = i * 26;
      row.style.opacity = '0';
      row.style.transform = 'translateY(5px)';
      row.style.transition = \`opacity 0.26s \${delay}ms ease, transform 0.26s \${delay}ms ease\`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        row.style.opacity = '1';
        row.style.transform = 'none';
        if (row.classList.contains('sev-p0')) {
          setTimeout(() => { row.style.animation = 'warnPulse 1.4s ease-in-out 2'; }, delay + 350);
        }
      }));
    });
  }
}

function buildPanelTech(tech) {
  const el = document.getElementById('panel-tech');
  if (!tech || !tech.breakdown || !tech.breakdown.length) {
    el.innerHTML = '<p style="color:var(--faint);font-size:13px">Không có dữ liệu.</p>'; return;
  }
  let html = '<div class="panel-head">Đánh giá kỹ thuật</div><table class="dim-table"><thead><tr><th class="col-num">#</th><th class="col-name">Chiều</th><th class="col-find">Phát hiện chính</th><th>Điểm</th></tr></thead><tbody>';
  tech.breakdown.forEach((d, i) => {
    html += \`<tr><td class="col-num">\${i+1}</td><td class="col-name">\${esc(d.label)}</td><td class="col-find">\${esc(d.keyFinding || '—')}</td><td><span class="schip \${sc(d.score)}">\${d.score}<span class="chip-max">/4</span></span></td></tr>\`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function buildPanelUX(ux) {
  const el = document.getElementById('panel-ux');
  if (!ux || !ux.heuristics || !ux.heuristics.length) {
    el.innerHTML = '<p style="color:var(--faint);font-size:13px">Không có dữ liệu.</p>'; return;
  }
  let html = '<div class="panel-head">Nguyên tắc UX · Nielsen</div><table class="dim-table"><thead><tr><th class="col-num">#</th><th class="col-name">Nguyên tắc</th><th class="col-find">Vấn đề chính</th><th>Điểm</th></tr></thead><tbody>';
  ux.heuristics.forEach(h => {
    html += \`<tr><td class="col-num">\${h.id}</td><td class="col-name">\${esc(h.name)}</td><td class="col-find">\${esc(h.keyIssue || '—')}</td><td><span class="schip \${sc(h.score)}">\${h.score}<span class="chip-max">/4</span></span></td></tr>\`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function buildPanelPositive(positives, systemics, slop) {
  const el = document.getElementById('panel-positive');
  let html = '';
  if (positives && positives.length) {
    html += '<div class="panel-head">Điểm mạnh</div><ul class="callout-list positive">';
    positives.forEach(s => { html += \`<li>\${esc(s)}</li>\`; });
    html += '</ul>';
  }
  if (systemics && systemics.length) {
    html += '<div class="panel-head" style="margin-top:24px">Vấn đề hệ thống</div><ul class="callout-list systemic">';
    systemics.forEach(s => { html += \`<li>\${esc(s)}</li>\`; });
    html += '</ul>';
  }
  if (slop) {
    html += '<div class="panel-head" style="margin-top:24px">Slop Test</div>';
    if (slop.verdict) html += \`<p class="slop-verdict-panel">\${esc(slop.verdict)}</p>\`;
    if (slop.tells && slop.tells.length) html += \`<div class="slop-tells">\${slop.tells.join(' · ')}</div>\`;
  }
  if (!html) html = '<p style="color:var(--faint);font-size:13px">Không có dữ liệu.</p>';
  el.innerHTML = html;
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
    if (!ok) { console.log(`\n  "${config.agent}" không tìm thấy.`); config = await setupWizard(); }
  }

  const server = await startServer(config, port);
  const url = `http://localhost:${port}`;
  console.log(`\n  fk-skills tool  →  ${url}`);
  console.log(`  Agent: ${config.agent}  |  Ctrl+C để dừng\n`);

  try {
    const open = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawnSync(open, [url], { detached: true, stdio: 'ignore' });
  } catch {}

  process.on('SIGINT', () => { server.close(); process.exit(0); });
}
