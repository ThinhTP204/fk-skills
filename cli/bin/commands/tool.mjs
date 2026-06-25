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

async function ensurePlaywrightBrowser(onStatus) {
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
      await ensurePlaywrightBrowser(onStatus);
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

Evaluate against these standards:
- Absolute bans: side-stripe borders (border-left/right >1px as accent), gradient text (background-clip:text + gradient), glassmorphism decoratively, hero-metric template, identical card grids, tracked eyebrow above every section, numbered section scaffolding, text overflow
- Slop tells: gradient-text, glassmorphism-overuse, identical-card-grids, hero-metrics-row, eyebrow-every-section, excessive-border-radius, everything-in-cards, bento-grid, emoji-overuse, oversized-h1, side-stripe-border
- Technical: accessibility (WCAG 2.1 AA), performance, theming/color tokens, responsive design, anti-patterns
- UX: Nielsen's 10 heuristics

Required JSON schema:
{
  "register": "brand" | "product",
  "scores": {
    "technical": {
      "total": <0-20>,
      "breakdown": [
        { "id": "accessibility", "label": "Khả năng tiếp cận", "score": <0-4>, "keyFinding": "<specific finding>" },
        { "id": "performance",   "label": "Hiệu suất",         "score": <0-4>, "keyFinding": "<specific finding>" },
        { "id": "theming",       "label": "Màu sắc & Giao diện","score": <0-4>, "keyFinding": "<specific finding>" },
        { "id": "responsive",    "label": "Responsive",         "score": <0-4>, "keyFinding": "<specific finding>" },
        { "id": "antiPatterns",  "label": "Anti-Pattern",       "score": <0-4>, "keyFinding": "<specific finding>" }
      ]
    },
    "ux": {
      "total": <0-40>,
      "heuristics": [
        { "id": 1,  "name": "Trạng thái hệ thống rõ ràng",       "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 2,  "name": "Phù hợp thực tế người dùng",         "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 3,  "name": "Kiểm soát và tự do",                 "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 4,  "name": "Nhất quán và chuẩn mực",             "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 5,  "name": "Ngăn ngừa lỗi",                     "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 6,  "name": "Nhận diện thay vì ghi nhớ",         "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 7,  "name": "Linh hoạt và hiệu quả",             "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 8,  "name": "Thiết kế tối giản",                  "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 9,  "name": "Xử lý lỗi",                         "score": <0-4>, "keyIssue": "<finding>" },
        { "id": 10, "name": "Tài liệu và hỗ trợ",                "score": <0-4>, "keyIssue": "<finding>" }
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
      "title": "<short name in Vietnamese>",
      "location": "<selector or area>",
      "category": "Khả năng tiếp cận"|"Hiệu suất"|"Giao diện"|"Responsive"|"Anti-Pattern"|"UX",
      "impact": "<user impact in Vietnamese, 1 sentence>",
      "recommendation": "<actionable fix in Vietnamese, 1-2 sentences>"
    }
  ],
  "positiveFindings": ["<strength in Vietnamese>"],
  "systemicIssues": ["<recurring pattern in Vietnamese>"],
  "summary": "<2-3 sentence executive summary in Vietnamese>"
}

Rules:
- register: brand=marketing/landing, product=app/dashboard/tool
- All issues, findings, and summary MUST be in Vietnamese
- technical scores 0-4: 4=xuất sắc, 3=tốt, 2=trung bình, 1=kém, 0=lỗi nghiêm trọng
- P0=chặn hoàn toàn, P1=nghiêm trọng, P2=nhỏ, P3=tinh chỉnh. Include 6-10 issues.
- positiveFindings: 2-4 genuine strengths
- systemicIssues: recurring patterns (omit if none)`;

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
  const { url } = body;
  if (!url) { sseEvent(res, 'error', { text: 'Vui lòng nhập URL' }); return; }

  const start = Date.now();

  // 1. Fetch (with SPA fallback)
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

  // 2. Static analysis
  sseEvent(res, 'status', { text: 'Đang phát hiện anti-pattern...' });
  let findings = [];
  try {
    findings = await runDetectHtml(html, url);
    sseEvent(res, 'findings', { findings, counts: findings.reduce((a, f) => {
      a[f.category || 'other'] = (a[f.category || 'other'] || 0) + 1;
      a.total = (a.total || 0) + 1;
      return a;
    }, {}) });
  } catch (err) {
    sseEvent(res, 'status', { text: `Cảnh báo phân tích tĩnh: ${err.message}` });
  }

  // 3. LLM scoring with streaming
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
      if (err.code === 'EADDRINUSE') reject(new Error(`Cổng ${port} đang được sử dụng. Thử --port <khác>`));
      else reject(err);
    });
    server.listen(port, '127.0.0.1', resolve);
  });

  return server;
}

// ─── Inline HTML UI ────────────────────────────────────────────────────────

function buildUI(config) {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fk skills — Kiểm tra Giao diện</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Alumni+Sans+Pinstripe&family=Albert+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:       oklch(98.5% 0 0);
  --surface:  oklch(100% 0 0);
  --surface2: oklch(97% 0 0);
  --rule:     oklch(91% 0 0);
  --rule-mid: oklch(83% 0 0);

  --ink:   oklch(14% 0.018 95);
  --text:  oklch(22% 0.016 95);
  --muted: oklch(43% 0.012 95);
  --faint: oklch(60% 0.008 95);

  --gold:        oklch(84% 0.19 80.46);
  --gold-pale:   oklch(93% 0.05 82);
  --gold-text:   oklch(51% 0.13 76);
  --gold-bg:     oklch(98.5% 0.016 82);
  --gold-border: oklch(88% 0.055 82);

  --patina:        oklch(70% 0.12 188);
  --patina-text:   oklch(36% 0.1 188);
  --patina-bg:     oklch(97% 0.025 188);
  --patina-border: oklch(86% 0.058 188);

  --p0-color:  oklch(46% 0.2 25);
  --p0-bg:     oklch(97.5% 0.022 25);
  --p0-border: oklch(86% 0.055 25);
  --p0-title:  oklch(40% 0.22 25);

  --p1-color:  oklch(47% 0.17 46);
  --p1-bg:     oklch(98% 0.018 58);
  --p1-border: oklch(87% 0.05 58);
  --p1-title:  oklch(42% 0.18 46);

  --font-display: 'Alumni Sans Pinstripe', 'Albert Sans', Arial, sans-serif;
  --font-body:    'Albert Sans', 'Avenir Next', Helvetica, Arial, system-ui, sans-serif;
  --font-mono:    'SF Mono', 'Roboto Mono', Consolas, monospace;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}

/* ── Header ── */
header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--surface);
  border-bottom: 1px solid var(--rule);
  padding: 0 40px;
  height: 52px;
  display: flex;
  align-items: center;
  gap: 14px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 9px;
}
.brand-mark {
  width: 22px;
  height: 22px;
  background: var(--ink);
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}
.brand-mark::after {
  content: '';
  position: absolute;
  top: 0; right: 0;
  width: 0; height: 0;
  border-style: solid;
  border-width: 0 22px 22px 0;
  border-color: transparent var(--gold) transparent transparent;
}
.wordmark {
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink);
}
.wordmark span { color: var(--gold-text); }
.gold-seam {
  height: 2px;
  background: var(--gold);
  width: 100%;
}
.header-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
.local-tag {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--faint);
  text-transform: uppercase;
}
.agent-tag {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--gold-text);
  background: var(--gold-bg);
  border: 1px solid var(--gold-border);
  padding: 3px 9px;
  border-radius: 2px;
  text-transform: uppercase;
}

/* ── Main ── */
main {
  max-width: 900px;
  margin: 0 auto;
  padding: 44px 40px 100px;
}

/* ── Form strip ── */
.form-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 40px;
  border-bottom: 1px solid var(--rule);
}
.url-input {
  flex: 1;
  min-width: 0;
  height: 46px;
  border: 1px solid var(--rule-mid);
  border-radius: 3px;
  padding: 0 18px;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--text);
  background: var(--surface);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.url-input:focus {
  border-color: var(--gold);
  box-shadow: 0 0 0 3px oklch(84% 0.19 80.46 / 0.13);
}
.url-input::placeholder { color: var(--faint); font-style: italic; }

.scan-btn {
  height: 46px;
  padding: 0 32px;
  background: var(--gold);
  color: var(--ink);
  border: none;
  border-radius: 3px;
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, transform 0.1s, box-shadow 0.2s;
}
.scan-btn.ready {
  box-shadow: 0 0 0 3px oklch(84% 0.19 80.46 / 0.22);
}
.scan-btn:hover {
  background: var(--gold-pale);
  transform: translateY(-1px);
  box-shadow: 0 4px 18px oklch(84% 0.19 80.46 / 0.32);
}
.scan-btn:active { transform: translateY(0); box-shadow: none; }
.scan-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

/* ── Error ── */
.error-bar {
  display: none;
  margin-top: 20px;
  padding: 13px 16px;
  background: var(--p0-bg);
  border: 1px solid var(--p0-border);
  border-radius: 3px;
  color: var(--p0-color);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.6;
}
.error-bar.show { display: block; animation: fadeIn 0.2s ease; }

/* ── Progress ── */
.progress-block {
  display: none;
  margin-top: 32px;
  border: 1px solid var(--rule);
  border-radius: 3px;
  overflow: hidden;
  background: var(--surface);
}
.progress-block.show { display: block; animation: fadeIn 0.25s ease; }

.sweep-track { height: 2px; background: var(--rule); overflow: hidden; }
.sweep-fill {
  height: 100%;
  background: var(--gold);
  width: 0%;
}
.sweep-fill.running {
  animation: sweep 2.8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
@keyframes sweep {
  0%   { width: 0%; }
  45%  { width: 68%; }
  75%  { width: 84%; }
  100% { width: 84%; }
}

.progress-inner { padding: 22px 26px; }
.progress-status {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 14px;
}
.progress-dots::after {
  content: '';
  animation: dots 1.4s steps(4, end) infinite;
}
@keyframes dots {
  0%   { content: ''; }
  25%  { content: '.'; }
  50%  { content: '..'; }
  75%  { content: '...'; }
  100% { content: ''; }
}
.stream-box {
  background: var(--surface2);
  border-radius: 2px;
  padding: 14px 16px;
  max-height: 160px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.7;
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-all;
}
.stream-box:empty { display: none; }

/* ── Animations ── */
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: none; }
}
@keyframes warnPulse {
  0%, 100% { background: var(--p0-bg); }
  50%       { background: oklch(95.5% 0.03 25); }
}
@keyframes warnPulseP1 {
  0%, 100% { background: var(--p1-bg); }
  50%       { background: oklch(96.5% 0.025 55); }
}
@keyframes interpretIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
}

/* ── Results wrapper ── */
.results-wrap { display: none; }
.results-wrap.show { display: block; }

/* ── Score trio ── */
.score-section { padding-top: 48px; }
.score-trio {
  display: grid;
  grid-template-columns: 1fr 1px 1fr 1px 1fr;
}
.score-col-divider { background: var(--rule); }
.score-cell {
  padding: 0 40px 36px;
}
.score-cell:first-child { padding-left: 0; }
.score-cell:last-child { padding-right: 0; }

.score-eyebrow {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  font-weight: 500;
  color: var(--faint);
  text-transform: uppercase;
  margin-bottom: 16px;
  margin-top: 36px;
}
.score-number {
  font-family: var(--font-display);
  font-size: clamp(3rem, 6vw, 4.8rem);
  font-weight: 300;
  line-height: 1;
  letter-spacing: -0.01em;
  color: var(--ink);
}
.score-denom {
  font-size: 13px;
  color: var(--faint);
  margin-top: 6px;
  margin-bottom: 6px;
}
.score-interpret {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 16px;
  display: none;
  animation: interpretIn 0.4s ease 0.9s both;
}
.score-interpret.show { display: block; }
.si-great  { color: var(--patina-text); }
.si-good   { color: var(--gold-text); }
.si-mid    { color: var(--p1-color); }
.si-bad    { color: var(--p0-color); }
.score-track {
  height: 2px;
  background: var(--rule);
  border-radius: 1px;
  overflow: hidden;
}
.score-fill {
  height: 100%;
  border-radius: 1px;
  width: 0%;
  transition: width 1s cubic-bezier(0.16, 1, 0.3, 1) 0.3s;
}
.score-fill.bar-gold    { background: var(--gold); }
.score-fill.bar-patina  { background: var(--patina); }
.score-fill.bar-red     { background: var(--p0-color); }

.slop-pass { color: var(--patina-text); }
.slop-fail { color: var(--p0-color); }
.slop-tags {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--muted);
  margin-top: 10px;
  line-height: 1.7;
}
.slop-verdict {
  font-size: 12px;
  color: var(--muted);
  margin-top: 6px;
  line-height: 1.65;
  font-style: italic;
}

/* ── Summary ── */
.summary-section {
  border-top: 1px solid var(--rule);
  padding: 32px 0 36px;
}
.reg-tag {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.15em;
  font-weight: 500;
  text-transform: uppercase;
  color: var(--gold-text);
  border: 1px solid var(--gold-border);
  padding: 3px 9px;
  border-radius: 2px;
  margin-bottom: 14px;
}
.summary-text {
  font-size: 14px;
  color: var(--muted);
  line-height: 1.8;
  max-width: 66ch;
  text-wrap: pretty;
}

/* ── Section heading ── */
.sec-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  border-top: 1px solid var(--rule);
  padding-top: 32px;
}
.sec-head-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  font-weight: 500;
  color: var(--faint);
  text-transform: uppercase;
}
.sec-head-count { color: var(--gold-text); }

/* ── Heuristics table ── */
.htable-wrap { margin-bottom: 8px; }
.htable { width: 100%; border-collapse: collapse; }
.htable thead th {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.13em;
  font-weight: 500;
  text-transform: uppercase;
  color: var(--faint);
  padding: 16px 0 12px;
  text-align: left;
  border-bottom: 1px solid var(--rule);
}
.htable thead th:last-child { text-align: right; }
.htable tbody tr { border-bottom: 1px solid var(--rule); transition: background 0.1s; }
.htable tbody tr:last-child { border-bottom: none; }
.htable tbody tr:hover { background: oklch(99.5% 0 0); }
.htable tbody td { padding: 14px 0 13px; vertical-align: top; }
.htable tbody td:last-child { text-align: right; }
.hnum  { font-family: var(--font-mono); font-size: 11px; color: var(--faint); width: 30px; }
.hname { font-weight: 600; font-size: 13px; color: var(--ink); padding-right: 24px; min-width: 160px; }
.hfind { font-size: 12.5px; color: var(--muted); line-height: 1.55; }
.schip { font-family: var(--font-mono); font-size: 13px; font-weight: 600; }
.schip.s4 { color: var(--patina-text); }
.schip.s3 { color: oklch(40% 0.12 145); }
.schip.s2 { color: var(--gold-text); }
.schip.s1 { color: var(--p1-color); }
.schip.s0 { color: var(--p0-color); }
.chip-max { font-weight: 400; color: var(--faint); }

/* ── Issues ── */
.issues-wrap { margin-bottom: 8px; }

.issue-row {
  display: grid;
  grid-template-columns: 52px 1fr;
  padding: 24px 0;
  border-bottom: 1px solid var(--rule);
  transition: background 0.2s;
}
.issue-row:last-child { border-bottom: none; }

/* P0: severe — full background + pulse */
.issue-row.sev-p0 {
  background: var(--p0-bg);
  border: 1px solid var(--p0-border);
  border-radius: 3px;
  padding: 20px 16px;
  margin-bottom: 8px;
}
.issue-row.sev-p0.pulse {
  animation: warnPulse 1.6s ease-in-out 2;
}

/* P1: major — tinted but subtle */
.issue-row.sev-p1 {
  background: var(--p1-bg);
  border: 1px solid var(--p1-border);
  border-radius: 3px;
  padding: 20px 16px;
  margin-bottom: 6px;
}
.issue-row.sev-p1.pulse {
  animation: warnPulseP1 1.8s ease-in-out 1;
}

.p-chip {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  font-weight: 600;
  padding: 3px 7px;
  border-radius: 2px;
  display: inline-block;
  width: fit-content;
  margin-top: 2px;
}
.p-chip.P0 { color: var(--p0-color); background: oklch(94% 0.04 25); border: 1.5px solid var(--p0-border); }
.p-chip.P1 { color: var(--p1-color); background: oklch(94% 0.03 50); border: 1.5px solid var(--p1-border); }
.p-chip.P2 { color: var(--gold-text); background: var(--gold-bg); border: 1px solid var(--gold-border); }
.p-chip.P3 { color: var(--faint); background: var(--surface2); border: 1px solid var(--rule); }

.issue-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  margin-bottom: 8px;
  color: var(--ink);
}
.sev-p0 .issue-title { color: var(--p0-title); }
.sev-p1 .issue-title { color: var(--p1-title); }

.issue-meta-row {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 9px;
}
.meta-item { font-size: 11px; color: var(--faint); display: flex; gap: 5px; }
.meta-item b { color: var(--muted); font-weight: 600; }

.issue-impact { font-size: 13px; color: var(--muted); line-height: 1.65; margin-bottom: 10px; }
.sev-p0 .issue-impact { color: oklch(38% 0.05 25); }
.sev-p1 .issue-impact { color: oklch(38% 0.04 46); }

.issue-fix {
  padding: 11px 14px;
  background: var(--gold-bg);
  border: 1px solid var(--gold-border);
  border-radius: 3px;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text);
}
.sev-p0 .issue-fix { background: var(--surface); }
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

/* ── Callout lists ── */
.callout-list { list-style: none; }
.callout-list li {
  font-size: 13px;
  line-height: 1.65;
  padding: 15px 0 15px 28px;
  border-bottom: 1px solid var(--rule);
  position: relative;
  color: var(--muted);
}
.callout-list li:last-child { border-bottom: none; }
.callout-list.positive li { color: var(--patina-text); }
.callout-list.positive li::before {
  content: '✓';
  position: absolute;
  left: 0;
  color: var(--patina);
  font-weight: 700;
}
.callout-list.systemic li::before {
  content: '◆';
  position: absolute;
  left: 0;
  color: var(--p1-color);
  font-size: 9px;
  top: 19px;
}

/* ── Sections ── */
.section { display: none; }
.section.show { display: block; }

/* ── Responsive ── */
@media (max-width: 640px) {
  main { padding: 28px 20px 80px; }
  header { padding: 0 20px; }
  .score-trio { grid-template-columns: 1fr; }
  .score-col-divider { height: 1px; width: 100%; }
  .score-cell { padding: 24px 0; }
  .score-cell:first-child { padding-top: 36px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
}
</style>
</head>
<body>

<header>
  <div class="brand">
    <div class="brand-mark"></div>
    <div class="wordmark">fk <span>skills</span></div>
  </div>
  <div class="header-right">
    <span class="local-tag">cục bộ</span>
    <span class="agent-tag">${config.agent}</span>
  </div>
</header>
<div class="gold-seam"></div>

<main>
  <div class="form-strip">
    <input id="url" class="url-input" type="url"
      placeholder="https://trang-web.com hoặc http://localhost:3000"
      autocomplete="off" spellcheck="false">
    <button id="scan" class="scan-btn">Quét</button>
  </div>

  <div id="error" class="error-bar"></div>

  <div id="progress" class="progress-block">
    <div class="sweep-track">
      <div id="sweep" class="sweep-fill"></div>
    </div>
    <div class="progress-inner">
      <div id="progress-label" class="progress-status">Đang quét<span class="progress-dots"></span></div>
      <div id="stream-area" class="stream-box"></div>
    </div>
  </div>

  <div id="results" class="results-wrap">

    <!-- Điểm số -->
    <div id="sec-scores" class="section">
      <div class="score-section">
        <div class="score-trio">
          <div class="score-cell">
            <div class="score-eyebrow">Kỹ thuật</div>
            <div class="score-number" id="tech-num">—</div>
            <div class="score-denom">/20</div>
            <div class="score-interpret" id="tech-interp"></div>
            <div class="score-track"><div class="score-fill" id="tech-bar"></div></div>
          </div>
          <div class="score-col-divider"></div>
          <div class="score-cell">
            <div class="score-eyebrow">UX · Nielsen</div>
            <div class="score-number" id="ux-num">—</div>
            <div class="score-denom">/40</div>
            <div class="score-interpret" id="ux-interp"></div>
            <div class="score-track"><div class="score-fill" id="ux-bar"></div></div>
          </div>
          <div class="score-col-divider"></div>
          <div class="score-cell">
            <div class="score-eyebrow">Slop Test</div>
            <div class="score-number" id="slop-val">—</div>
            <div id="slop-tags" class="slop-tags"></div>
            <div id="slop-verdict" class="slop-verdict"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tóm tắt -->
    <div id="sec-summary" class="section">
      <div class="summary-section">
        <div id="reg-tag" class="reg-tag" style="display:none"></div>
        <p id="summary-text" class="summary-text"></p>
      </div>
    </div>

    <!-- Đánh giá kỹ thuật -->
    <div id="sec-tech" class="section">
      <div class="sec-head">
        <span class="sec-head-label">Đánh giá kỹ thuật</span>
        <span class="sec-head-count sec-head-label">5 chiều</span>
      </div>
      <div class="htable-wrap">
        <table class="htable">
          <thead><tr>
            <th class="hnum">#</th>
            <th class="hname">Chiều</th>
            <th class="hfind">Phát hiện chính</th>
            <th>Điểm</th>
          </tr></thead>
          <tbody id="tech-body"></tbody>
        </table>
      </div>
    </div>

    <!-- UX Heuristics -->
    <div id="sec-ux" class="section">
      <div class="sec-head">
        <span class="sec-head-label">Nguyên tắc UX · Nielsen</span>
        <span class="sec-head-count sec-head-label">10 nguyên tắc</span>
      </div>
      <div class="htable-wrap">
        <table class="htable">
          <thead><tr>
            <th class="hnum">#</th>
            <th class="hname">Nguyên tắc</th>
            <th class="hfind">Vấn đề chính</th>
            <th>Điểm</th>
          </tr></thead>
          <tbody id="ux-body"></tbody>
        </table>
      </div>
    </div>

    <!-- Vấn đề -->
    <div id="sec-issues" class="section">
      <div class="sec-head">
        <span class="sec-head-label" id="issues-head">Vấn đề</span>
      </div>
      <div class="issues-wrap" id="issues-list"></div>
    </div>

    <!-- Điểm mạnh -->
    <div id="sec-positive" class="section">
      <div class="sec-head">
        <span class="sec-head-label">Điểm mạnh</span>
      </div>
      <ul id="positive-list" class="callout-list positive"></ul>
    </div>

    <!-- Vấn đề hệ thống -->
    <div id="sec-systemic" class="section">
      <div class="sec-head">
        <span class="sec-head-label">Vấn đề hệ thống</span>
      </div>
      <ul id="systemic-list" class="callout-list systemic"></ul>
    </div>

  </div>
</main>

<script>
const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Nút Quét "thức dậy" khi có URL
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
  reset();
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
    const lbl = document.getElementById('progress-label');
    lbl.innerHTML = \`\${esc(data.text)}<span class="progress-dots"></span>\`;
  } else if (event === 'stream') {
    const area = document.getElementById('stream-area');
    area.textContent += data.text;
    area.scrollTop = area.scrollHeight;
  } else if (event === 'findings') {
    window._staticFindings = data.findings || [];
  } else if (event === 'result') {
    renderResult(data);
  } else if (event === 'error') {
    showError(data.text);
  } else if (event === 'done') {
    const sf = window._staticFindings;
    if (sf?.length && !document.getElementById('sec-issues').classList.contains('show')) {
      renderIssues(sf.map(f => ({
        id: f.antipattern || f.id, priority: f.severity || 'P2',
        title: f.name || f.antipattern, category: f.category || 'Anti-Pattern',
        location: f.selector || '', impact: f.description || '',
      })));
    }
  }
}

function setScanning(on) {
  document.getElementById('scan').disabled = on;
  document.getElementById('scan').classList.remove('ready');
  const prog = document.getElementById('progress');
  const sweep = document.getElementById('sweep');
  if (on) {
    prog.classList.add('show');
    sweep.style.cssText = 'width:0%;opacity:1;transition:none;';
    sweep.classList.add('running');
  } else {
    sweep.classList.remove('running');
    sweep.style.transition = 'width 0.4s ease-out';
    sweep.style.width = '100%';
    setTimeout(() => { sweep.style.transition = 'opacity 0.5s'; sweep.style.opacity = '0'; }, 420);
    setTimeout(() => prog.classList.remove('show'), 980);
  }
}

function reset() {
  document.getElementById('error').classList.remove('show');
  document.getElementById('stream-area').textContent = '';
  document.getElementById('progress-label').innerHTML = 'Đang quét<span class="progress-dots"></span>';
  document.getElementById('results').classList.remove('show');
  ['sec-scores','sec-summary','sec-tech','sec-ux','sec-issues','sec-positive','sec-systemic']
    .forEach(id => document.getElementById(id).classList.remove('show'));
  ['tech-body','ux-body','issues-list','positive-list','systemic-list']
    .forEach(id => { document.getElementById(id).innerHTML = ''; });
  document.getElementById('slop-tags').textContent = '';
  document.getElementById('slop-verdict').textContent = '';
  ['tech-interp','ux-interp'].forEach(id => {
    const el = document.getElementById(id);
    el.textContent = ''; el.className = 'score-interpret';
  });
  window._staticFindings = [];
}

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.classList.add('show');
}

function show(id) {
  const el = document.getElementById(id);
  el.classList.add('show');
  if (!rm) {
    el.style.animation = 'none';
    requestAnimationFrame(() => { el.style.animation = 'slideUp 0.35s ease forwards'; });
  }
}

function sc(s) { return ['s0','s1','s2','s3','s4'][Math.max(0, Math.min(4, Math.round(s)))]; }
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function interpret(score, max) {
  const p = score / max;
  if (p >= 0.85) return { text: 'Xuất sắc', cls: 'si-great' };
  if (p >= 0.70) return { text: 'Khá tốt', cls: 'si-good' };
  if (p >= 0.50) return { text: 'Cần cải thiện', cls: 'si-mid' };
  return { text: 'Cần xem lại', cls: 'si-bad' };
}

function countUp(el, target, dur, interpEl, interpMax) {
  if (rm || typeof target !== 'number') {
    el.textContent = target;
    if (interpEl && interpMax != null) {
      const r = interpret(target, interpMax);
      interpEl.textContent = r.text;
      interpEl.className = \`score-interpret show \${r.cls}\`;
    }
    return;
  }
  const d = dur || 950;
  const t0 = performance.now();
  function tick(now) {
    const progress = Math.min((now - t0) / d, 1);
    const ease = 1 - Math.pow(1 - progress, 4);
    el.textContent = Math.round(ease * target);
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = target;
      if (interpEl && interpMax != null) {
        const r = interpret(target, interpMax);
        interpEl.textContent = r.text;
        interpEl.className = \`score-interpret show \${r.cls}\`;
      }
    }
  }
  requestAnimationFrame(tick);
}

function barClass(pct) {
  return pct >= 0.7 ? 'bar-patina' : pct >= 0.45 ? 'bar-gold' : 'bar-red';
}

function renderResult(data) {
  const { scores, issues, findings, positiveFindings, systemicIssues, summary, register } = data;

  if (scores) {
    const { technical: tech, ux, slopTest: slop } = scores;

    if (tech) {
      countUp(
        document.getElementById('tech-num'), tech.total, 900,
        document.getElementById('tech-interp'), 20
      );
      const bar = document.getElementById('tech-bar');
      const p = tech.total / 20;
      setTimeout(() => { bar.style.width = (p * 100) + '%'; bar.className = 'score-fill ' + barClass(p); }, 120);
    }
    if (ux) {
      countUp(
        document.getElementById('ux-num'), ux.total, 980,
        document.getElementById('ux-interp'), 40
      );
      const bar = document.getElementById('ux-bar');
      const p = ux.total / 40;
      setTimeout(() => { bar.style.width = (p * 100) + '%'; bar.className = 'score-fill ' + barClass(p); }, 160);
    }
    if (slop) {
      const el = document.getElementById('slop-val');
      el.textContent = slop.passed ? 'Đạt' : 'Không đạt';
      el.className = 'score-number ' + (slop.passed ? 'slop-pass' : 'slop-fail');
      if (slop.tells?.length) document.getElementById('slop-tags').textContent = slop.tells.join(' · ');
      if (slop.verdict) document.getElementById('slop-verdict').textContent = slop.verdict;
    }

    document.getElementById('results').classList.add('show');
    show('sec-scores');

    const tb = document.getElementById('tech-body');
    (Array.isArray(tech?.breakdown) ? tech.breakdown : []).forEach((d, i) => {
      tb.insertAdjacentHTML('beforeend', \`<tr>
        <td class="hnum">\${i + 1}</td>
        <td class="hname">\${esc(d.label)}</td>
        <td class="hfind">\${esc(d.keyFinding || '—')}</td>
        <td><span class="schip \${sc(d.score)}">\${d.score}<span class="chip-max">/4</span></span></td>
      </tr>\`);
    });
    if (tech?.breakdown?.length) show('sec-tech');

    const ub = document.getElementById('ux-body');
    (Array.isArray(ux?.heuristics) ? ux.heuristics : []).forEach(h => {
      ub.insertAdjacentHTML('beforeend', \`<tr>
        <td class="hnum">\${h.id}</td>
        <td class="hname">\${esc(h.name)}</td>
        <td class="hfind">\${esc(h.keyIssue || '—')}</td>
        <td><span class="schip \${sc(h.score)}">\${h.score}<span class="chip-max">/4</span></span></td>
      </tr>\`);
    });
    if (ux?.heuristics?.length) show('sec-ux');
  }

  if (summary || register) {
    const tag = document.getElementById('reg-tag');
    if (register) {
      tag.textContent = register === 'brand' ? 'Thương hiệu' : register === 'product' ? 'Sản phẩm' : register;
      tag.style.display = 'inline-block';
    }
    document.getElementById('summary-text').textContent = summary || '';
    show('sec-summary');
  }

  const allIssues = [
    ...(issues || []),
    ...(findings || []).map(f => ({
      id: f.antipattern || f.id, priority: f.severity || 'P2',
      title: f.name || f.antipattern, category: f.category || 'Anti-Pattern',
      location: f.selector || '', impact: f.description || '', recommendation: '',
    })),
  ];
  renderIssues(allIssues);

  if (positiveFindings?.length) {
    const ul = document.getElementById('positive-list');
    positiveFindings.forEach(s => { const li = document.createElement('li'); li.textContent = s; ul.appendChild(li); });
    show('sec-positive');
  }
  if (systemicIssues?.length) {
    const ul = document.getElementById('systemic-list');
    systemicIssues.forEach(s => { const li = document.createElement('li'); li.textContent = s; ul.appendChild(li); });
    show('sec-systemic');
  }
}

function renderIssues(allIssues) {
  if (!allIssues.length) return;
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  allIssues.sort((a, b) => (order[a.priority] ?? 4) - (order[b.priority] ?? 4));
  const list = document.getElementById('issues-list');
  allIssues.forEach((f, idx) => {
    const p = f.priority || 'P2';
    const isCritical = p === 'P0';
    const isMajor = p === 'P1';
    const sevClass = isCritical ? 'sev-p0' : isMajor ? 'sev-p1' : '';
    const el = document.createElement('div');
    el.className = \`issue-row \${sevClass}\`;
    el.innerHTML = \`
      <div><span class="p-chip \${p}">\${p}</span></div>
      <div>
        <div class="issue-title">\${esc(f.title || f.id)}</div>
        \${(f.location || f.category) ? \`<div class="issue-meta-row">
          \${f.location ? \`<span class="meta-item"><b>Vị trí</b>\${esc(f.location)}</span>\` : ''}
          \${f.category ? \`<span class="meta-item"><b>Loại</b>\${esc(f.category)}</span>\` : ''}
        </div>\` : ''}
        \${f.impact ? \`<div class="issue-impact">\${esc(f.impact)}</div>\` : ''}
        \${f.recommendation ? \`<div class="issue-fix"><span class="fix-label">Cách sửa</span>\${esc(f.recommendation)}</div>\` : ''}
      </div>\`;
    list.appendChild(el);

    // Pulse P0/P1 after stagger to draw eye
    if ((isCritical || isMajor) && !rm) {
      const delay = idx * 38;
      el.style.cssText = \`opacity:0;transform:translateY(7px);transition:opacity 0.32s \${delay}ms ease,transform 0.32s \${delay}ms ease\`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.opacity = '1';
        el.style.transform = 'none';
        setTimeout(() => el.classList.add('pulse'), delay + 400);
      }));
    } else if (!rm) {
      el.style.cssText = \`opacity:0;transform:translateY(7px);transition:opacity 0.3s \${idx * 38}ms ease,transform 0.3s \${idx * 38}ms ease\`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.opacity = '1';
        el.style.transform = 'none';
      }));
    }
  });
  document.getElementById('issues-head').textContent = \`Vấn đề (\${allIssues.length})\`;
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
