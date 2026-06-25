/**
 * `fk-skills tool` — local UI checker with SSE streaming
 */

import { createServer } from 'node:http';
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function detectAvailableClis() {
  return ['claude', 'codex'].filter(cli => {
    try { return spawnSync('which', [cli], { encoding: 'utf-8', timeout: 3000 }).status === 0; }
    catch { return false; }
  });
}

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

  const scopeAns = await ask('  Phạm vi — (1) global  (2) project  [1] ');
  const s = scopeAns.trim().toLowerCase();
  const scope = (s === 'project' || s === 'p' || s === '2') ? 'project' : 'global';
  rl.close();

  const config = { agent, scope };
  const saved = writeConfig(config, scope);
  console.log(`\n  Đã lưu tại ${saved}`);
  return config;
}

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
  execSync('npx playwright install chromium', { stdio: 'inherit', timeout: 180000, shell: true });
}

async function renderWithBrowser(url, onStatus) {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { throw new Error('Thiếu playwright — chạy: npm install'); }

  onStatus('Khởi động trình duyệt ảo...');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    if (err.message?.includes('Executable') || err.message?.includes('not found')) {
      onStatus('Cài Chromium lần đầu (khoảng 100MB)...');
      await ensurePlaywrightBrowser();
      browser = await chromium.launch({ headless: true });
    } else { throw err; }
  }

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(800);
    const html = await page.content();
    onStatus('Render hoàn tất.');
    return html;
  } finally { await browser.close(); }
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

const SCORE_PROMPT = `You are a senior design director applying fk-skills design standards. Analyze the HTML and return ONLY valid JSON — no markdown, no explanation, no code fences.

Evaluate rigorously against:
1. Absolute bans (fk-skills): side-stripe borders (border-left/right >1px as colored accent on cards/alerts), gradient text (background-clip:text + linear-gradient), glassmorphism used decoratively, hero-metric template (big number + small label grid), identical card grids (same icon+heading+text repeated), tracked uppercase eyebrow above every section, numbered section markers (01/02/03) as scaffolding
2. Slop tells: gradient-text, glassmorphism-overuse, identical-card-grids, hero-metrics-row, eyebrow-every-section, excessive-border-radius, everything-in-cards, bento-grid, emoji-overuse, oversized-h1, side-stripe-border
3. Technical: WCAG 2.1 AA accessibility (color contrast ≥4.5:1, ARIA labels, keyboard navigation), performance (unoptimized images, render-blocking fonts), color system coherence, responsive design, anti-patterns
4. UX: Nielsen's 10 heuristics — evaluate each with specific evidence from the HTML

Return ONLY valid JSON. ALL text MUST be in Vietnamese with full diacritics (tiếng Việt đầy đủ dấu).

{
  "register": "brand" | "product",
  "scores": {
    "technical": {
      "total": <sum of breakdown scores 0-20>,
      "breakdown": [
        { "id": "accessibility", "label": "Khả năng tiếp cận", "score": <0-4>, "keyFinding": "<specific finding with element names and failure reason, in Vietnamese>" },
        { "id": "performance",   "label": "Hiệu suất",          "score": <0-4>, "keyFinding": "<specific finding, in Vietnamese>" },
        { "id": "theming",       "label": "Màu sắc & Giao diện", "score": <0-4>, "keyFinding": "<specific finding, in Vietnamese>" },
        { "id": "responsive",    "label": "Responsive",          "score": <0-4>, "keyFinding": "<specific finding, in Vietnamese>" },
        { "id": "antiPatterns",  "label": "Anti-Pattern",        "score": <0-4>, "keyFinding": "<specific finding, in Vietnamese>" }
      ]
    },
    "ux": {
      "total": <sum of heuristic scores 0-40>,
      "heuristics": [
        { "id": 1,  "name": "Trạng thái hệ thống rõ ràng",  "score": <0-4>, "keyIssue": "<evidence-based finding in Vietnamese>" },
        { "id": 2,  "name": "Phù hợp thực tế người dùng",   "score": <0-4>, "keyIssue": "<evidence-based finding in Vietnamese>" },
        { "id": 3,  "name": "Kiểm soát và tự do",            "score": <0-4>, "keyIssue": "<evidence-based finding in Vietnamese>" },
        { "id": 4,  "name": "Nhất quán và chuẩn mực",        "score": <0-4>, "keyIssue": "<evidence-based finding in Vietnamese>" },
        { "id": 5,  "name": "Ngăn ngừa lỗi",                 "score": <0-4>, "keyIssue": "<evidence-based finding in Vietnamese>" },
        { "id": 6,  "name": "Nhận diện thay vì ghi nhớ",     "score": <0-4>, "keyIssue": "<evidence-based finding in Vietnamese>" },
        { "id": 7,  "name": "Linh hoạt và hiệu quả",         "score": <0-4>, "keyIssue": "<evidence-based finding in Vietnamese>" },
        { "id": 8,  "name": "Thiết kế tối giản",             "score": <0-4>, "keyIssue": "<evidence-based finding in Vietnamese>" },
        { "id": 9,  "name": "Xử lý lỗi",                     "score": <0-4>, "keyIssue": "<evidence-based finding in Vietnamese>" },
        { "id": 10, "name": "Tài liệu và hỗ trợ",            "score": <0-4>, "keyIssue": "<evidence-based finding in Vietnamese>" }
      ]
    },
    "slopTest": {
      "passed": true | false,
      "tells": ["<exact ban or slop tell found, e.g. 'gradient-text on .hero h1'>"],
      "verdict": "<2-3 sentence verdict with named specific evidence, in Vietnamese>"
    }
  },
  "issues": [
    {
      "id": "kebab-id",
      "priority": "P0"|"P1"|"P2"|"P3",
      "title": "<clear short name in Vietnamese>",
      "location": "<CSS selector, component name, or page area>",
      "category": "Khả năng tiếp cận"|"Hiệu suất"|"Giao diện"|"Responsive"|"Anti-Pattern"|"UX",
      "impact": "<who is affected and exactly how — 1-2 sentences in Vietnamese>",
      "recommendation": "<what exactly to change, specific and actionable — 2-3 sentences in Vietnamese>"
    }
  ],
  "positiveFindings": ["<what works well and why — specific, not generic, in Vietnamese>"],
  "systemicIssues": ["<recurring pattern across multiple locations — name the locations, in Vietnamese>"],
  "summary": "<3-4 sentence summary — overall quality level, top strength, top gap, priority recommendation, in Vietnamese>"
}

P0=completely blocks task completion, P1=severe usability harm, P2=notable friction, P3=polish opportunity.
Minimum 8 issues. Be specific and evidence-based — "could be improved" is not a finding.
register: brand=marketing/landing/portfolio, product=app/dashboard/admin/tool
Scores: 4=no issues, 3=minor, 2=moderate needs attention, 1=significant problems, 0=critical failure.`;

async function runDetectHtml(html, url) {
  const { detectHtml } = await import('../../engine/detect-antipatterns.mjs');
  const tmp = join(tmpdir(), `fk-tool-${Date.now()}.html`);
  try {
    writeFileSync(tmp, html, 'utf-8');
    return await detectHtml(tmp, { url });
  } finally { try { unlinkSync(tmp); } catch {} }
}

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
    sseEvent(res, 'error', { text: `Không thể tải trang: ${err.message}` }); return;
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
  const args = config.agent === 'claude'
    ? ['-p', fullPrompt, '--max-turns', '1']
    : ['--no-git', '--full-auto', '-q', fullPrompt];

  await new Promise((resolve) => {
    let buffer = '', done = false;
    const proc = spawn(config.agent, args, { env: process.env });
    proc.stdin.end();
    const timer = setTimeout(() => {
      if (done) return;
      done = true; proc.kill('SIGTERM');
      const hint = buffer.trim().length > 0
        ? `\n\nOutput trước timeout:\n${buffer.trim().slice(-600)}`
        : '\n\nKhông có output — có thể Claude đang chờ xác nhận. Chạy thử: claude -p "test" trong terminal.';
      sseEvent(res, 'error', { text: `${config.agent} hết thời gian chờ (3 phút)${hint}` });
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
      if (done) return; done = true; clearTimeout(timer);
      sseEvent(res, 'error', { text: `Lỗi ${config.agent}: ${err.message}` }); resolve();
    });
    proc.on('close', code => {
      if (done) return; done = true; clearTimeout(timer);
      if (code !== 0 && !buffer.trim()) {
        sseEvent(res, 'error', { text: `${config.agent} thoát với mã lỗi ${code}` }); resolve(); return;
      }
      try {
        const parsed = JSON.parse(extractJson(buffer));
        sseEvent(res, 'result', { ...parsed, findings, agent: config.agent, durationMs: Date.now() - start });
      } catch {
        sseEvent(res, 'error', { text: 'Không thể đọc kết quả — vui lòng thử lại' });
      }
      resolve();
    });
  });
  sseEvent(res, 'done', { durationMs: Date.now() - start });
}

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
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(ui); return;
    }
    if (req.method === 'POST' && req.url === '/api/scan') {
      let body;
      try { body = await parseBody(req); } catch (e) { res.writeHead(400); res.end(e.message); return; }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
        'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*',
      });
      await handleScan(body, config, res); res.end(); return;
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

// ─── UI ────────────────────────────────────────────────────────────────────

function buildUI(config) {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>fk skills — Kiểm tra Giao diện</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Alumni+Sans+Pinstripe&family=Inter:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:         oklch(100% 0 0);
  --sidebar-bg: oklch(97% 0 0);
  --surface:    oklch(97.5% 0 0);
  --rule:       oklch(90% 0 0);
  --rule-faint: oklch(94% 0 0);

  --ink:   oklch(12% 0.012 95);
  --text:  oklch(18% 0.012 95);
  --muted: oklch(34% 0.01 95);
  --faint: oklch(52% 0.008 95);

  --gold:        oklch(84% 0.19 80.46);
  --gold-text:   oklch(46% 0.13 72);
  --gold-bg:     oklch(98.5% 0.016 82);
  --gold-border: oklch(87% 0.055 82);

  --patina:      oklch(70% 0.12 188);
  --patina-text: oklch(30% 0.1 188);
  --patina-bg:   oklch(97% 0.025 188);

  --p0-color:  oklch(40% 0.22 25);
  --p0-bg:     oklch(98.5% 0.012 25);
  --p0-border: oklch(86% 0.055 25);
  --p0-title:  oklch(34% 0.24 25);

  --p1-color:  oklch(43% 0.18 46);
  --p1-bg:     oklch(98.5% 0.01 55);
  --p1-border: oklch(87% 0.048 55);
  --p1-title:  oklch(37% 0.19 46);

  --font-display: 'Alumni Sans Pinstripe', Georgia, serif;
  --font-body:    'Inter', system-ui, -apple-system, sans-serif;
  --font-mono:    'SF Mono', 'Roboto Mono', Consolas, monospace;
}

html, body { height: 100%; overflow: hidden; }
body {
  display: flex; flex-direction: column;
  background: var(--bg); color: var(--text);
  font-family: var(--font-body); font-size: 14px; line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

/* ── Top bar ── */
.top-bar {
  display: flex; align-items: center; gap: 12px;
  height: 52px; padding: 0 20px;
  border-bottom: 1px solid var(--rule);
  background: var(--bg); flex-shrink: 0;
}
.brand { display: flex; align-items: center; gap: 8px; flex-shrink: 0; width: 148px; }
.brand-mark {
  width: 18px; height: 18px; background: var(--ink);
  position: relative; overflow: hidden; flex-shrink: 0;
}
.brand-mark::after {
  content: ''; position: absolute; top: 0; right: 0;
  border-style: solid; border-width: 0 18px 18px 0;
  border-color: transparent var(--gold) transparent transparent;
}
.wordmark {
  font-family: var(--font-body); font-weight: 700; font-size: 11px;
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink); white-space: nowrap;
}
.wordmark span { color: var(--gold-text); }

/* Scan form (visible before scan / during scan) */
.form-row { flex: 1; display: flex; gap: 8px; min-width: 0; }
.url-input {
  flex: 1; min-width: 0; height: 36px;
  border: 1px solid var(--rule); border-radius: 3px;
  padding: 0 14px; font-family: var(--font-body); font-size: 13px;
  color: var(--text); background: var(--bg); outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.url-input:focus { border-color: var(--gold); box-shadow: 0 0 0 2px oklch(84% 0.19 80.46 / 0.14); }
.url-input::placeholder { color: var(--faint); }
.scan-btn {
  height: 36px; padding: 0 22px; background: var(--ink); color: oklch(97% 0 0);
  border: none; border-radius: 3px; font-family: var(--font-body); font-size: 13px;
  font-weight: 600; cursor: pointer; flex-shrink: 0; transition: background 0.14s, box-shadow 0.2s;
}
.scan-btn.ready { box-shadow: 0 0 0 2px oklch(84% 0.19 80.46 / 0.3); }
.scan-btn:hover { background: oklch(22% 0.015 95); }
.scan-btn:disabled { opacity: 0.38; cursor: not-allowed; box-shadow: none; }

/* Result row (visible after scan) */
.result-row { flex: 1; display: none; align-items: center; gap: 12px; min-width: 0; }
.result-row.show { display: flex; }
.result-url-wrap { flex: 1; min-width: 0; overflow: hidden; display: flex; align-items: center; gap: 8px; }
.result-url-tag {
  font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--faint); flex-shrink: 0;
}
.result-url-val {
  font-size: 13px; color: var(--muted); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.rescan-btn {
  height: 30px; padding: 0 14px; background: transparent; color: var(--muted);
  border: 1px solid var(--rule); border-radius: 3px; font-family: var(--font-body);
  font-size: 12px; font-weight: 500; cursor: pointer; flex-shrink: 0;
  transition: border-color 0.15s, color 0.15s;
}
.rescan-btn:hover { border-color: var(--faint); color: var(--text); }

.agent-tag {
  font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em;
  color: var(--gold-text); background: var(--gold-bg); border: 1px solid var(--gold-border);
  padding: 3px 8px; border-radius: 2px; text-transform: uppercase; flex-shrink: 0;
}

/* ── Workspace ── */
.workspace { flex: 1; display: flex; overflow: hidden; }

/* ── Sidebar ── */
.sidebar {
  width: 220px; flex-shrink: 0; border-right: 1px solid var(--rule);
  background: var(--sidebar-bg); overflow-y: auto; display: flex; flex-direction: column;
}
.sidebar-idle { padding: 40px 20px 20px; color: var(--faint); font-size: 12px; line-height: 1.7; }

/* Score blocks */
.score-block { padding: 20px 20px 16px; border-bottom: 1px solid var(--rule); }
.score-eyebrow {
  font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--faint); margin-bottom: 8px;
}
.score-num {
  font-family: var(--font-display); font-size: 2.4rem; line-height: 1;
  color: var(--ink); font-weight: 300;
}
.score-denom { font-size: 12px; color: var(--faint); margin-top: 2px; margin-bottom: 8px; }
.score-interp { font-size: 11.5px; font-weight: 600; margin-bottom: 8px; display: none; }
.score-interp.show { display: block; }
.si-great { color: var(--patina-text); }
.si-good  { color: var(--gold-text); }
.si-mid   { color: var(--p1-color); }
.si-bad   { color: var(--p0-color); }
.score-bar-track { height: 2px; background: var(--rule); border-radius: 1px; overflow: hidden; }
.score-bar-fill { height: 100%; width: 0%; border-radius: 1px; transition: width 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.3s; }
.bar-great { background: var(--patina); }
.bar-good  { background: var(--gold); }
.bar-mid   { background: var(--p1-color); }
.bar-bad   { background: var(--p0-color); }
.slop-result { font-family: var(--font-display); font-size: 1.8rem; font-weight: 300; line-height: 1; margin-bottom: 4px; }
.slop-pass { color: var(--patina-text); }
.slop-fail { color: var(--p0-color); }

/* Sidebar nav */
.sidebar-nav { padding: 8px 0 20px; }
.nav-item {
  display: flex; align-items: center; padding: 8px 20px;
  font-size: 13px; cursor: pointer; color: var(--muted);
  transition: background 0.1s, color 0.1s; user-select: none;
}
.nav-item:hover { background: oklch(94% 0 0); color: var(--text); }
.nav-item.active {
  background: var(--bg); color: var(--ink); font-weight: 600;
  box-shadow: inset 2px 0 0 var(--gold);
}
.nav-count { margin-left: auto; font-family: var(--font-mono); font-size: 11px; color: var(--faint); }
.nav-item.has-critical .nav-count { color: var(--p0-color); font-weight: 700; }

/* ── Main panel ── */
.main-panel { flex: 1; overflow-y: auto; background: var(--bg); display: flex; flex-direction: column; }
.panel-empty {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  color: var(--faint); font-size: 13px; gap: 10px; padding: 60px 40px; text-align: center;
}
.empty-mark {
  width: 32px; height: 32px; background: var(--sidebar-bg);
  position: relative; overflow: hidden; margin-bottom: 4px;
}
.empty-mark::after {
  content: ''; position: absolute; top: 0; right: 0;
  border-style: solid; border-width: 0 32px 32px 0;
  border-color: transparent var(--rule) transparent transparent;
}

/* Progress */
.panel-progress { padding: 32px 48px; }
.progress-label { font-size: 13.5px; font-weight: 600; color: var(--ink); margin-bottom: 12px; }
.progress-dots::after { content: ''; animation: dots 1.4s steps(4, end) infinite; }
@keyframes dots { 0%{content:''} 25%{content:'.'} 50%{content:'..'} 75%{content:'...'} }
.sweep-track { height: 2px; background: var(--rule); overflow: hidden; margin-bottom: 16px; }
.sweep-fill { height: 100%; background: var(--gold); width: 0%; }
.sweep-fill.running { animation: sweep 2.8s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
@keyframes sweep { 0%{width:0%} 45%{width:68%} 75%{width:84%} 100%{width:84%} }
.stream-box {
  background: var(--surface); border-radius: 2px; padding: 14px 16px;
  max-height: 180px; overflow-y: auto; font-family: var(--font-mono); font-size: 11px;
  line-height: 1.7; color: var(--muted); white-space: pre-wrap; word-break: break-all;
}
.stream-box:empty { display: none; }

/* Error */
.error-bar {
  margin: 20px 48px 0; padding: 12px 16px; background: var(--p0-bg);
  border: 1px solid var(--p0-border); border-radius: 3px;
  color: var(--p0-color); font-size: 13.5px; font-weight: 500; display: none;
}
.error-bar.show { display: block; }

/* Panel content */
.panel-content { padding: 36px 48px 64px; display: none; }
.panel-content.show { display: block; }

/* Panel heading */
.panel-head {
  font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--faint); margin-bottom: 24px;
}
.panel-sub-head {
  font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--faint); margin: 32px 0 16px;
}

/* ── Overview ── */
.reg-badge {
  display: inline-block; font-family: var(--font-mono); font-size: 9.5px;
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--gold-text);
  border: 1px solid var(--gold-border); padding: 3px 8px; border-radius: 2px; margin-bottom: 16px;
}
.overview-summary {
  font-size: 15px; color: var(--text); line-height: 1.75;
  text-wrap: pretty; max-width: 68ch; margin-bottom: 28px; font-weight: 400;
}

/* Overview score lines */
.ov-scores { margin-bottom: 28px; display: flex; flex-direction: column; gap: 10px; max-width: 520px; }
.ov-score-row { display: flex; align-items: center; gap: 12px; }
.ov-score-label { font-size: 12.5px; font-weight: 500; color: var(--muted); width: 110px; flex-shrink: 0; }
.ov-bar-wrap { flex: 1; height: 3px; background: var(--rule); border-radius: 2px; overflow: hidden; }
.ov-bar-fill { height: 100%; border-radius: 2px; transition: width 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.4s; }
.ov-score-val { font-family: var(--font-mono); font-size: 12px; color: var(--text); font-weight: 600; width: 44px; text-align: right; flex-shrink: 0; }
.ov-score-interp { font-size: 11.5px; font-weight: 600; width: 110px; flex-shrink: 0; }

.ov-slop-row { display: flex; align-items: center; gap: 12px; }
.ov-slop-label { font-size: 12.5px; font-weight: 500; color: var(--muted); width: 110px; flex-shrink: 0; }
.ov-slop-val { font-size: 13px; font-weight: 700; }

.overview-hint {
  font-size: 13px; color: var(--muted); line-height: 1.65;
  padding: 12px 16px; background: var(--gold-bg); border: 1px solid var(--gold-border);
  border-radius: 3px; max-width: 560px; margin-bottom: 20px;
}
.ov-systemic { margin-top: 20px; }
.ov-systemic-head { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.14em; text-transform: uppercase; color: var(--faint); margin-bottom: 12px; }
.ov-systemic-item { font-size: 13px; color: var(--muted); padding: 8px 0 8px 20px; position: relative; border-bottom: 1px solid var(--rule-faint); line-height: 1.55; }
.ov-systemic-item:last-child { border-bottom: none; }
.ov-systemic-item::before { content: '◆'; position: absolute; left: 0; color: var(--p1-color); font-size: 9px; top: 12px; }

/* ── Issue blocks (P0/P1 — fully visible, no accordion) ── */
.issue-blocks { display: flex; flex-direction: column; gap: 16px; margin-bottom: 8px; }

.issue-block {
  border-radius: 4px; overflow: hidden;
  border: 1px solid var(--rule);
}
.issue-block.sev-p0 {
  background: var(--p0-bg); border-color: var(--p0-border);
  border-top: 3px solid var(--p0-color);
}
.issue-block.sev-p1 {
  background: var(--p1-bg); border-color: var(--p1-border);
  border-top: 3px solid var(--p1-color);
}
.issue-block-head {
  display: flex; align-items: flex-start; gap: 14px; padding: 18px 20px 12px;
}
.issue-block-title { font-size: 14.5px; font-weight: 700; line-height: 1.3; margin-bottom: 5px; color: var(--ink); }
.sev-p0 .issue-block-title { color: var(--p0-title); }
.sev-p1 .issue-block-title { color: var(--p1-title); }
.issue-block-body { padding: 0 20px 18px 52px; }

/* ── Compact rows (P2/P3) ── */
.issue-compacts { display: flex; flex-direction: column; }
.issue-compact {
  display: flex; align-items: flex-start; gap: 14px;
  padding: 14px 0; border-bottom: 1px solid var(--rule-faint);
}
.issue-compact:last-child { border-bottom: none; }
.issue-compact-body { flex: 1; min-width: 0; }
.issue-compact-title { font-size: 13.5px; font-weight: 600; color: var(--ink); line-height: 1.35; margin-bottom: 4px; }
.issue-compact-cat { font-size: 11px; font-family: var(--font-mono); color: var(--faint); flex-shrink: 0; margin-top: 3px; }

/* Shared issue components */
.p-chip {
  font-family: var(--font-mono); font-size: 9.5px; font-weight: 700;
  letter-spacing: 0.06em; padding: 3px 6px; border-radius: 2px; flex-shrink: 0; margin-top: 2px;
}
.p-chip.P0 { color: var(--p0-color); background: oklch(95% 0.03 25); border: 1.5px solid var(--p0-border); }
.p-chip.P1 { color: var(--p1-color); background: oklch(95% 0.025 50); border: 1.5px solid var(--p1-border); }
.p-chip.P2 { color: var(--gold-text); background: var(--gold-bg); border: 1px solid var(--gold-border); }
.p-chip.P3 { color: var(--faint); background: var(--surface); border: 1px solid var(--rule); }

.issue-meta { font-size: 11.5px; color: var(--faint); display: flex; gap: 12px; flex-wrap: wrap; margin-top: 3px; }
.issue-meta code { font-family: var(--font-mono); font-size: 10.5px; color: var(--muted); }

.issue-impact { font-size: 13.5px; color: var(--muted); line-height: 1.7; margin-bottom: 12px; }
.issue-impact strong { color: var(--text); font-weight: 600; }
.issue-compact-impact { font-size: 12.5px; color: var(--muted); line-height: 1.6; margin-bottom: 5px; }
.issue-compact-fix { font-size: 12.5px; color: var(--muted); line-height: 1.6; }
.issue-compact-fix .fix-arrow { color: var(--gold-text); font-weight: 700; }

.issue-fix {
  padding: 12px 16px; background: var(--gold-bg); border: 1px solid var(--gold-border);
  border-radius: 3px; font-size: 13.5px; line-height: 1.7; color: var(--text);
}
.fix-label {
  display: block; font-family: var(--font-mono); font-size: 9px;
  letter-spacing: 0.15em; font-weight: 700; text-transform: uppercase;
  color: var(--gold-text); margin-bottom: 5px;
}

/* ── Dimension tables ── */
.dim-table { width: 100%; border-collapse: collapse; }
.dim-table thead th {
  font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 0.13em;
  font-weight: 500; text-transform: uppercase; color: var(--faint);
  padding: 0 0 12px; text-align: left; border-bottom: 1px solid var(--rule);
}
.dim-table thead th:last-child { text-align: right; }
.dim-table tbody tr { border-bottom: 1px solid var(--rule-faint); }
.dim-table tbody tr:last-child { border-bottom: none; }
.dim-table tbody tr:hover { background: oklch(99.5% 0 0); }
.dim-table tbody td { padding: 14px 0 13px; vertical-align: top; }
.dim-table tbody td:last-child { text-align: right; white-space: nowrap; }
.col-num  { font-family: var(--font-mono); font-size: 11px; color: var(--faint); width: 28px; }
.col-name { font-weight: 600; font-size: 13.5px; color: var(--ink); padding-right: 20px; min-width: 130px; }
.col-find { font-size: 13px; color: var(--text); line-height: 1.6; }
.schip { font-family: var(--font-mono); font-size: 13px; font-weight: 700; white-space: nowrap; }
.s4 { color: var(--patina-text); } .s3 { color: oklch(33% 0.13 145); }
.s2 { color: var(--gold-text); }   .s1 { color: var(--p1-color); } .s0 { color: var(--p0-color); }
.chip-max { font-weight: 400; color: var(--faint); }

/* Positive/systemic */
.callout-list { list-style: none; }
.callout-list li {
  font-size: 13.5px; line-height: 1.7; padding: 13px 0 13px 26px;
  border-bottom: 1px solid var(--rule-faint); position: relative; color: var(--muted);
}
.callout-list li:last-child { border-bottom: none; }
.callout-list.positive li { color: var(--patina-text); }
.callout-list.positive li::before { content: '✓'; position: absolute; left: 0; color: var(--patina); font-weight: 700; }
.callout-list.systemic li::before { content: '◆'; position: absolute; left: 0; color: var(--p1-color); font-size: 9px; top: 17px; }

.slop-verdict-panel { font-size: 13.5px; color: var(--muted); line-height: 1.75; font-style: italic; max-width: 62ch; margin-bottom: 16px; text-wrap: pretty; }
.slop-tells-list { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); line-height: 1.9; }

/* Animations */
@keyframes fadeSlideUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes interpretIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@keyframes warnPulse {
  0%, 100% { background: var(--p0-bg); }
  50%       { background: oklch(96.5% 0.024 25); }
}

@media (max-width: 700px) { .sidebar { width: 180px; } .panel-content { padding: 24px 20px 50px; } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
}
</style>
</head>
<body>

<div class="top-bar">
  <div class="brand">
    <div class="brand-mark"></div>
    <div class="wordmark">fk <span>skills</span></div>
  </div>
  <div id="top-scan" class="form-row">
    <input id="url" class="url-input" type="url"
      placeholder="https://trang-web.com hoặc http://localhost:3000"
      autocomplete="off" spellcheck="false">
    <button id="scan" class="scan-btn">Quét</button>
  </div>
  <div id="top-result" class="result-row">
    <div class="result-url-wrap">
      <span class="result-url-tag">Đã quét</span>
      <span id="result-url-val" class="result-url-val"></span>
    </div>
    <button id="rescan" class="rescan-btn">Quét lại</button>
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
    <div id="error-bar" class="error-bar"></div>
    <div id="panel-idle" class="panel-empty">
      <div class="empty-mark"></div>
      Nhập URL và nhấn Quét để bắt đầu.
    </div>
    <div id="panel-scanning" style="display:none" class="panel-progress">
      <div class="sweep-track"><div class="sweep-fill" id="sweep"></div></div>
      <div class="progress-label" id="panel-status">Đang quét<span class="progress-dots"></span></div>
      <div class="stream-box" id="stream-area"></div>
    </div>
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
  if (p >= 0.85) return { text: 'Xuất sắc',     cls: 'si-great', bar: 'bar-great' };
  if (p >= 0.70) return { text: 'Khá tốt',       cls: 'si-good',  bar: 'bar-good'  };
  if (p >= 0.50) return { text: 'Cần cải thiện', cls: 'si-mid',   bar: 'bar-mid'   };
  return             { text: 'Cần xem lại',   cls: 'si-bad',   bar: 'bar-bad'   };
}

function sc(s) { return ['s0','s1','s2','s3','s4'][Math.max(0,Math.min(4,Math.round(s||0)))]; }

function countUp(el, target, dur, onDone) {
  if (rm || typeof target !== 'number') { el.textContent = target; if (onDone) onDone(); return; }
  const t0 = performance.now();
  (function tick(now) {
    const progress = Math.min((now - t0) / (dur || 900), 1);
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
document.getElementById('rescan').addEventListener('click', () => {
  document.getElementById('top-result').classList.remove('show');
  document.getElementById('top-scan').style.display = 'flex';
  resetAll();
  document.getElementById('url').focus();
});

document.getElementById('scan').addEventListener('click', async () => {
  const url = document.getElementById('url').value.trim();
  if (!url) return;
  window._scanUrl = url;
  resetUI();
  setScanning(true);
  try {
    const res = await fetch('/api/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
  } catch (err) { showError(err.message); }
  finally { setScanning(false); }
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
  if (on) document.getElementById('panel-idle').style.display = 'none';
  document.getElementById('panel-scanning').style.display = on ? 'block' : 'none';
  if (on) document.getElementById('sidebar-idle').style.display = 'none';
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
    const el = document.getElementById(id); el.innerHTML = ''; el.classList.remove('show');
  });
  window._findings = []; window._data = null;
}

function resetAll() {
  resetUI();
  document.getElementById('panel-idle').style.display = 'flex';
  document.getElementById('sidebar-idle').style.display = 'block';
  document.getElementById('sidebar-scanning').style.display = 'none';
  document.getElementById('sidebar-results').style.display = 'none';
}

function showError(msg) {
  const el = document.getElementById('error-bar');
  const hint = msg.includes('thời gian') || msg.includes('timeout')
    ? '<br><span style="font-size:12px;font-weight:400;margin-top:6px;display:block;opacity:0.8">Gợi ý: kiểm tra <code style="font-family:monospace">claude --version</code> trong terminal, hoặc chạy <code style="font-family:monospace">claude -p "test"</code> riêng để xác nhận hoạt động.</span>'
    : '';
  el.innerHTML = esc(msg) + hint;
  el.classList.add('show');
  document.getElementById('panel-idle').style.display = 'none';
  document.getElementById('sidebar-idle').style.display = 'block';
}

// ── Render results ──────────────────────────────────────────────────────────

function renderResults(data) {
  window._data = data;
  const issues = mergeIssues(data.issues || [], window._findings || []);
  window._allIssues = issues;
  const critical = issues.filter(i => i.priority === 'P0' || i.priority === 'P1');

  // Swap top bar: hide scan form, show result URL
  document.getElementById('top-scan').style.display = 'none';
  document.getElementById('top-result').classList.add('show');
  document.getElementById('result-url-val').textContent = window._scanUrl || '';

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
  const seen = new Set(), out = [];
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
  const tech = scores.technical, ux = scores.ux, slop = scores.slopTest;
  let html = '';

  if (tech) html += \`<div class="score-block">
    <div class="score-eyebrow">Kỹ thuật</div>
    <div class="score-num" id="snum-tech">0</div>
    <div class="score-denom">/20</div>
    <div class="score-interp" id="sinterp-tech"></div>
    <div class="score-bar-track"><div class="score-bar-fill" id="sbar-tech"></div></div>
  </div>\`;
  if (ux) html += \`<div class="score-block">
    <div class="score-eyebrow">UX · Nielsen</div>
    <div class="score-num" id="snum-ux">0</div>
    <div class="score-denom">/40</div>
    <div class="score-interp" id="sinterp-ux"></div>
    <div class="score-bar-track"><div class="score-bar-fill" id="sbar-ux"></div></div>
  </div>\`;
  if (slop) html += \`<div class="score-block">
    <div class="score-eyebrow">Slop Test</div>
    <div class="slop-result \${slop.passed ? 'slop-pass' : 'slop-fail'}">\${slop.passed ? 'Đạt' : 'Không đạt'}</div>
  </div>\`;

  el.innerHTML = html;

  if (tech) {
    const interp = interpret(tech.total, 20);
    countUp(document.getElementById('snum-tech'), tech.total, 900, () => {
      const si = document.getElementById('sinterp-tech');
      si.textContent = interp.text; si.className = 'score-interp show ' + interp.cls;
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
      si.textContent = interp.text; si.className = 'score-interp show ' + interp.cls;
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
  html += '<div class="nav-item" data-view="overview">Tổng quan</div>';
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
  const scores = data.scores || {};
  const tech = scores.technical, ux = scores.ux, slop = scores.slopTest;
  let html = '';

  if (data.register) {
    const label = data.register === 'brand' ? 'Thương hiệu' : data.register === 'product' ? 'Sản phẩm' : data.register;
    html += \`<div class="reg-badge">\${esc(label)}</div>\`;
  }
  if (data.summary) html += \`<p class="overview-summary">\${esc(data.summary)}</p>\`;

  // Score lines in overview
  if (tech || ux || slop) {
    html += '<div class="ov-scores">';
    if (tech) {
      const interp = interpret(tech.total, 20);
      const pct = (tech.total / 20 * 100).toFixed(1);
      html += \`<div class="ov-score-row">
        <span class="ov-score-label">Kỹ thuật</span>
        <div class="ov-bar-wrap"><div class="ov-bar-fill \${interp.bar}" id="ovbar-tech" style="width:0%"></div></div>
        <span class="ov-score-val">\${tech.total}<span style="font-weight:400;color:var(--faint)">/20</span></span>
        <span class="ov-score-interp \${interp.cls}">\${interp.text}</span>
      </div>\`;
    }
    if (ux) {
      const interp = interpret(ux.total, 40);
      html += \`<div class="ov-score-row">
        <span class="ov-score-label">UX · Nielsen</span>
        <div class="ov-bar-wrap"><div class="ov-bar-fill \${interp.bar}" id="ovbar-ux" style="width:0%"></div></div>
        <span class="ov-score-val">\${ux.total}<span style="font-weight:400;color:var(--faint)">/40</span></span>
        <span class="ov-score-interp \${interp.cls}">\${interp.text}</span>
      </div>\`;
    }
    if (slop) {
      html += \`<div class="ov-slop-row">
        <span class="ov-slop-label">Slop Test</span>
        <span class="ov-slop-val \${slop.passed ? 'slop-pass' : 'slop-fail'}">\${slop.passed ? 'Đạt' : 'Không đạt'}</span>
        \${slop.tells && slop.tells.length ? \`<span style="font-size:11px;color:var(--faint)">\${slop.tells.slice(0,2).map(t => esc(t)).join(' · ')}</span>\` : ''}
      </div>\`;
    }
    html += '</div>';
  }

  if (critical.length > 0) {
    html += \`<div class="overview-hint">Phát hiện <strong>\${critical.length} vấn đề nghiêm trọng</strong> cần xử lý — xem tại <strong>Nghiêm trọng</strong> ở thanh bên.</div>\`;
  } else if (issues.length > 0) {
    html += \`<div class="overview-hint">Tìm thấy \${issues.length} vấn đề. Nhấn <strong>Tất cả vấn đề</strong> để xem chi tiết.</div>\`;
  }

  if (data.systemicIssues && data.systemicIssues.length) {
    html += '<div class="ov-systemic"><div class="ov-systemic-head">Vấn đề hệ thống</div>';
    data.systemicIssues.forEach(s => { html += \`<div class="ov-systemic-item">\${esc(s)}</div>\`; });
    html += '</div>';
  }

  el.innerHTML = html;

  // Animate overview bars after render
  if (!rm) {
    if (tech) {
      const b = document.getElementById('ovbar-tech');
      if (b) requestAnimationFrame(() => requestAnimationFrame(() => {
        b.style.transition = 'width 0.9s cubic-bezier(0.16,1,0.3,1) 0.5s';
        b.style.width = (tech.total / 20 * 100).toFixed(1) + '%';
      }));
    }
    if (ux) {
      const b = document.getElementById('ovbar-ux');
      if (b) requestAnimationFrame(() => requestAnimationFrame(() => {
        b.style.transition = 'width 0.9s cubic-bezier(0.16,1,0.3,1) 0.65s';
        b.style.width = (ux.total / 40 * 100).toFixed(1) + '%';
      }));
    }
  }
}

function buildPanelIssues(panelId, issues, headLabel) {
  const el = document.getElementById(panelId);
  if (!issues.length) {
    el.innerHTML = \`<p style="color:var(--faint);font-size:13.5px">Không có vấn đề nào.</p>\`; return;
  }

  const critical = issues.filter(i => { const p = normPriority(i.priority); return p === 'P0' || p === 'P1'; });
  const minor    = issues.filter(i => { const p = normPriority(i.priority); return p !== 'P0' && p !== 'P1'; });

  let html = \`<div class="panel-head">\${esc(headLabel)} (\${issues.length})</div>\`;

  // P0/P1: full visible blocks, no accordion
  if (critical.length) {
    html += '<div class="issue-blocks">';
    critical.forEach(f => {
      const p = normPriority(f.priority);
      const sevCls = p === 'P0' ? 'sev-p0' : 'sev-p1';
      html += \`<div class="issue-block \${sevCls}">
        <div class="issue-block-head">
          <span class="p-chip \${p}">\${p}</span>
          <div style="flex:1;min-width:0">
            <div class="issue-block-title">\${esc(f.title || f.id)}</div>
            <div class="issue-meta">
              \${f.location ? \`<code>\${esc(f.location)}</code>\` : ''}
              \${f.category ? \`<span>\${esc(f.category)}</span>\` : ''}
            </div>
          </div>
        </div>
        <div class="issue-block-body">
          \${f.impact ? \`<p class="issue-impact"><strong>Ảnh hưởng:</strong> \${esc(f.impact)}</p>\` : ''}
          \${f.recommendation ? \`<div class="issue-fix"><span class="fix-label">Cách sửa</span>\${esc(f.recommendation)}</div>\` : ''}
        </div>
      </div>\`;
    });
    html += '</div>';
  }

  // P2/P3: compact rows
  if (minor.length) {
    if (critical.length) html += \`<div class="panel-sub-head">Vấn đề khác (\${minor.length})</div>\`;
    html += '<div class="issue-compacts">';
    minor.forEach(f => {
      const p = normPriority(f.priority);
      html += \`<div class="issue-compact">
        <span class="p-chip \${p}">\${p}</span>
        <div class="issue-compact-body">
          <div class="issue-compact-title">\${esc(f.title || f.id)}</div>
          \${f.impact ? \`<div class="issue-compact-impact">\${esc(f.impact)}</div>\` : ''}
          \${f.recommendation ? \`<div class="issue-compact-fix"><span class="fix-arrow">→</span> \${esc(f.recommendation)}</div>\` : ''}
          \${f.location ? \`<div class="issue-meta" style="margin-top:4px"><code>\${esc(f.location)}</code></div>\` : ''}
        </div>
        \${f.category ? \`<span class="issue-compact-cat">\${esc(f.category)}</span>\` : ''}
      </div>\`;
    });
    html += '</div>';
  }

  el.innerHTML = html;

  if (!rm) {
    el.querySelectorAll('.issue-block').forEach((block, i) => {
      block.style.opacity = '0'; block.style.transform = 'translateY(4px)';
      const delay = i * 50;
      block.style.transition = \`opacity 0.3s \${delay}ms ease, transform 0.3s \${delay}ms ease\`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        block.style.opacity = '1'; block.style.transform = 'none';
        if (block.classList.contains('sev-p0')) {
          setTimeout(() => { block.style.animation = 'warnPulse 1.6s ease-in-out 2'; }, delay + 400);
        }
      }));
    });
    el.querySelectorAll('.issue-compact').forEach((row, i) => {
      row.style.opacity = '0'; row.style.transform = 'translateY(3px)';
      const delay = (critical.length * 50) + i * 20;
      row.style.transition = \`opacity 0.25s \${delay}ms ease, transform 0.25s \${delay}ms ease\`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        row.style.opacity = '1'; row.style.transform = 'none';
      }));
    });
  }
}

function buildPanelTech(tech) {
  const el = document.getElementById('panel-tech');
  if (!tech || !tech.breakdown || !tech.breakdown.length) {
    el.innerHTML = '<p style="color:var(--faint);font-size:13.5px">Không có dữ liệu.</p>'; return;
  }
  let html = '<div class="panel-head">Đánh giá kỹ thuật</div>';
  html += '<table class="dim-table"><thead><tr><th class="col-num">#</th><th class="col-name">Tiêu chí</th><th class="col-find">Phát hiện chính</th><th>Điểm</th></tr></thead><tbody>';
  tech.breakdown.forEach((d, i) => {
    html += \`<tr>
      <td class="col-num">\${i+1}</td>
      <td class="col-name">\${esc(d.label)}</td>
      <td class="col-find">\${esc(d.keyFinding || '—')}</td>
      <td><span class="schip \${sc(d.score)}">\${d.score}<span class="chip-max">/4</span></span></td>
    </tr>\`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function buildPanelUX(ux) {
  const el = document.getElementById('panel-ux');
  if (!ux || !ux.heuristics || !ux.heuristics.length) {
    el.innerHTML = '<p style="color:var(--faint);font-size:13.5px">Không có dữ liệu.</p>'; return;
  }
  let html = '<div class="panel-head">Nguyên tắc UX · Nielsen</div>';
  html += '<table class="dim-table"><thead><tr><th class="col-num">#</th><th class="col-name">Nguyên tắc</th><th class="col-find">Vấn đề chính</th><th>Điểm</th></tr></thead><tbody>';
  ux.heuristics.forEach(h => {
    html += \`<tr>
      <td class="col-num">\${h.id}</td>
      <td class="col-name">\${esc(h.name)}</td>
      <td class="col-find">\${esc(h.keyIssue || '—')}</td>
      <td><span class="schip \${sc(h.score)}">\${h.score}<span class="chip-max">/4</span></span></td>
    </tr>\`;
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
    html += '<div class="panel-head" style="margin-top:28px">Vấn đề hệ thống</div><ul class="callout-list systemic">';
    systemics.forEach(s => { html += \`<li>\${esc(s)}</li>\`; });
    html += '</ul>';
  }
  if (slop) {
    html += '<div class="panel-head" style="margin-top:28px">Slop Test</div>';
    if (slop.verdict) html += \`<p class="slop-verdict-panel">\${esc(slop.verdict)}</p>\`;
    if (slop.tells && slop.tells.length) {
      html += '<div class="slop-tells-list">' + slop.tells.map(t => esc(t)).join('<br>') + '</div>';
    }
  }
  if (!html) html = '<p style="color:var(--faint);font-size:13.5px">Không có dữ liệu.</p>';
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
