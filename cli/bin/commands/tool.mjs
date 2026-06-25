/**
 * `fk-skills tool` — local UI checker
 *
 * Usage:
 *   npx fk-skills tool              Start the local check server
 *   npx fk-skills tool --setup      Re-run setup wizard
 *   npx fk-skills tool --port 3333  Use a custom port
 */

import { createServer } from 'node:http';
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

// ─── Config ────────────────────────────────────────────────────────────────

function globalConfigPath() {
  return join(homedir(), '.config', 'fk-skills', 'tool.json');
}

function projectConfigPath() {
  return join(process.cwd(), '.fk-skills', 'tool.json');
}

function readConfig() {
  for (const p of [projectConfigPath(), globalConfigPath()]) {
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { /* skip */ }
    }
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
  const found = [];
  for (const cli of ['claude', 'codex']) {
    try {
      const r = spawnSync('which', [cli], { encoding: 'utf-8', timeout: 3000 });
      if (r.status === 0 && r.stdout.trim()) found.push(cli);
    } catch { /* not found */ }
  }
  return found;
}

// ─── Setup wizard ──────────────────────────────────────────────────────────

async function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function setupWizard() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n  fk-skills tool — setup\n');

  const clis = detectAvailableClis();

  let agent;
  if (clis.length === 0) {
    console.log('  No AI CLI detected (claude / codex).\n');
    console.log('  Install Claude Code: https://claude.ai/download');
    console.log('  Install Codex CLI:   npm i -g @openai/codex\n');
    rl.close();
    process.exit(1);
  } else if (clis.length === 1) {
    agent = clis[0];
    console.log(`  Detected: ${agent} ✓`);
  } else {
    console.log(`  Detected: ${clis.join(', ')}`);
    const ans = await prompt(rl, `  Use which? [${clis[0]}] `);
    agent = clis.includes(ans.trim()) ? ans.trim() : clis[0];
  }

  const scopeAns = await prompt(rl, '  Scope — global or project? [global] ');
  const scope = scopeAns.trim() === 'project' ? 'project' : 'global';

  rl.close();

  const config = { agent, scope };
  const saved = writeConfig(config, scope);
  console.log(`\n  Saved to ${saved}`);
  return config;
}

// ─── LLM via subprocess ────────────────────────────────────────────────────

const SCORE_PROMPT = `You are a senior UI/UX design director. Analyze the HTML below and return a comprehensive JSON review report identical in depth to what a human design director would write.

RETURN ONLY VALID JSON — no markdown, no explanation, no code fences.

Schema (fill every field — do not omit or abbreviate):
{
  "register": "brand" | "product",
  "scores": {
    "technical": {
      "total": <0-20>,
      "breakdown": [
        { "id": "accessibility", "label": "Accessibility", "score": <0-4>, "keyFinding": "<specific finding or issue, 1 sentence>" },
        { "id": "performance",   "label": "Performance",   "score": <0-4>, "keyFinding": "<specific finding>" },
        { "id": "theming",       "label": "Theming",       "score": <0-4>, "keyFinding": "<specific finding>" },
        { "id": "responsive",    "label": "Responsive",    "score": <0-4>, "keyFinding": "<specific finding>" },
        { "id": "antiPatterns",  "label": "Anti-Patterns", "score": <0-4>, "keyFinding": "<specific finding>" }
      ]
    },
    "ux": {
      "total": <0-40>,
      "heuristics": [
        { "id": 1,  "name": "Visibility of System Status",      "score": <0-4>, "keyIssue": "<specific finding or 'solid'>" },
        { "id": 2,  "name": "Match System and Real World",      "score": <0-4>, "keyIssue": "<specific finding>" },
        { "id": 3,  "name": "User Control and Freedom",        "score": <0-4>, "keyIssue": "<specific finding>" },
        { "id": 4,  "name": "Consistency and Standards",       "score": <0-4>, "keyIssue": "<specific finding>" },
        { "id": 5,  "name": "Error Prevention",                "score": <0-4>, "keyIssue": "<specific finding>" },
        { "id": 6,  "name": "Recognition Rather Than Recall",  "score": <0-4>, "keyIssue": "<specific finding>" },
        { "id": 7,  "name": "Flexibility and Efficiency",      "score": <0-4>, "keyIssue": "<specific finding>" },
        { "id": 8,  "name": "Aesthetic and Minimalist Design", "score": <0-4>, "keyIssue": "<specific finding>" },
        { "id": 9,  "name": "Error Recovery",                  "score": <0-4>, "keyIssue": "<specific finding>" },
        { "id": 10, "name": "Help and Documentation",          "score": <0-4>, "keyIssue": "<specific finding>" }
      ]
    },
    "slopTest": {
      "passed": true | false,
      "tells": [],
      "verdict": "<1-2 sentence plain verdict — be brutally honest>"
    }
  },
  "issues": [
    {
      "id": "kebab-case-id",
      "priority": "P0" | "P1" | "P2" | "P3",
      "title": "<short issue name>",
      "location": "<component, selector, or file area>",
      "category": "Accessibility" | "Performance" | "Theming" | "Responsive" | "Anti-Pattern" | "UX",
      "impact": "<how this affects real users, 1 sentence>",
      "recommendation": "<specific actionable fix, 1-2 sentences>"
    }
  ],
  "positiveFindings": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "systemicIssues": ["<pattern 1 — e.g. 'Hard-coded colors appear in 15+ components'>", "<pattern 2>"],
  "summary": "<2-3 sentence executive summary — what is the page, what is the biggest problem, what is the biggest strength>"
}

Scoring rules:
- register: "brand" = marketing/landing/portfolio page; "product" = app/dashboard/tool/admin UI
- technical scores 0-4 per dimension:
  - accessibility: 0=fails WCAG A, 1=major gaps, 2=partial, 3=WCAG AA mostly met, 4=excellent
  - performance: 0=severe issues, 1=major problems, 2=partial, 3=mostly optimized, 4=excellent
  - theming: 0=no tokens/chaos, 1=minimal, 2=partial, 3=good with minor gaps, 4=full system
  - responsive: 0=desktop-only, 1=major issues, 2=works but rough, 3=good, 4=excellent
  - antiPatterns: 0=5+ AI tells, 1=3-4 tells, 2=1-2 tells, 3=subtle issues only, 4=no tells
- ux heuristics: Nielsen's 10, 0–4 each (0=completely absent, 4=exemplary)
- slopTest.tells: any of: gradient-text, everything-in-cards, glassmorphism-overuse, sparkle-icons, bento-grid, excessive-border-radius, emoji-overuse, generic-cta, rainbow-gradient, side-tab-borders, oversized-h1, hero-eyebrow-label, hero-metrics-row, floating-labels-without-purpose
- issues: P0=blocking/a11y, P1=major UX/WCAG AA, P2=minor, P3=polish. Include 6-12 issues.
- positiveFindings: list 3-5 genuine strengths (do not make these up if there are none)
- systemicIssues: identify 1-3 recurring patterns that indicate systemic gaps (omit if none)`;

function extractJson(text) {
  const clean = text.trim();
  // Strip markdown code fences
  const fenced = clean.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) return fenced[1].trim();
  // Find first { ... } block
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start !== -1 && end !== -1) return clean.slice(start, end + 1);
  return clean;
}

function callLLM(agent, htmlContent) {
  const truncated = htmlContent.slice(0, 30000);
  const fullPrompt = `${SCORE_PROMPT}\n\n<html>\n${truncated}\n</html>`;

  const args = agent === 'claude'
    ? ['-p', fullPrompt]
    : ['--no-git', '--full-auto', '-q', `${SCORE_PROMPT}\n\nHTML:\n${truncated}`];

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let done = false;

    const proc = spawn(agent, args, { env: process.env });

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      proc.kill('SIGTERM');
      reject(new Error(`${agent} timed out — try again or reduce page complexity`));
    }, 120000);

    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    proc.on('error', err => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(`${agent} subprocess error: ${err.message}`));
    });

    proc.on('close', code => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${agent} exited with code ${code}`));
        return;
      }
      const raw = stdout.trim();
      if (!raw) { reject(new Error(`${agent} returned empty response`)); return; }
      try {
        resolve(JSON.parse(extractJson(raw)));
      } catch {
        reject(new Error(`${agent} response was not valid JSON — try again`));
      }
    });
  });
}

// ─── detectHtml via temp file ──────────────────────────────────────────────

async function runDetectHtml(html, url) {
  const { detectHtml } = await import('../../engine/detect-antipatterns.mjs');
  const tmpFile = join(tmpdir(), `fk-tool-${Date.now()}.html`);
  try {
    writeFileSync(tmpFile, html, 'utf-8');
    const findings = await detectHtml(tmpFile, { url });
    return findings;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* best effort */ }
  }
}

// ─── Request handlers ──────────────────────────────────────────────────────

async function handleCheck(body) {
  const { url } = body;
  if (!url || typeof url !== 'string') throw new Error('url is required');

  const start = Date.now();
  const res = await fetch(url, {
    headers: { 'User-Agent': 'fk-skills-tool/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();

  const findings = await runDetectHtml(html, url);

  const counts = findings.reduce((acc, f) => {
    const cat = f.category || 'other';
    acc[cat] = (acc[cat] || 0) + 1;
    acc.total = (acc.total || 0) + 1;
    return acc;
  }, {});

  return { url, findings, counts, engine: 'static-html', durationMs: Date.now() - start };
}

async function handleScore(body, config) {
  const { url } = body;
  if (!url || typeof url !== 'string') throw new Error('url is required');

  const start = Date.now();

  const res = await fetch(url, {
    headers: { 'User-Agent': 'fk-skills-tool/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();

  const [findings, llmResult] = await Promise.all([
    runDetectHtml(html, url),
    callLLM(config.agent, html),
  ]);

  return {
    url,
    ...llmResult,
    findings,
    agent: config.agent,
    durationMs: Date.now() - start,
  };
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
    --bg: #0d0d0e;
    --surface: #161618;
    --surface2: #1c1c1f;
    --border: #2a2a2e;
    --text: #e8e8ea;
    --muted: #888;
    --accent: oklch(72% 0.18 85);
    --p0: #ef4444; --p0-bg: #2d0a0a; --p0-border: #7f1d1d;
    --p1: #f97316; --p1-bg: #2a1000; --p1-border: #7c2d12;
    --p2: #eab308; --p2-bg: #261c00; --p2-border: #713f12;
    --p3: #9ca3af; --p3-bg: #111115; --p3-border: #374151;
    --good: #22c55e;
  }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.5; }
  header { padding: 20px 32px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; position: sticky; top: 0; background: var(--bg); z-index: 10; }
  header h1 { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
  .badge { font-size: 11px; background: var(--surface); border: 1px solid var(--border); padding: 2px 8px; border-radius: 99px; color: var(--muted); }
  .agent-tag { margin-left: auto; font-size: 11px; color: var(--accent); }
  main { max-width: 900px; margin: 0 auto; padding: 28px 32px 60px; }

  /* Form */
  .form-row { display: flex; gap: 8px; margin-bottom: 28px; align-items: center; }
  .url-input { flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; color: var(--text); font-size: 14px; outline: none; transition: border-color 0.15s; }
  .url-input:focus { border-color: var(--accent); }
  .url-input::placeholder { color: var(--muted); }
  .tabs { display: flex; gap: 3px; }
  .tab { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border); background: none; color: var(--muted); font-size: 12px; cursor: pointer; transition: all 0.12s; white-space: nowrap; }
  .tab.active { background: var(--surface); color: var(--text); border-color: var(--accent); }
  .scan-btn { background: var(--accent); border: none; border-radius: 8px; padding: 10px 18px; color: #000; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: opacity 0.12s; }
  .scan-btn:hover { opacity: 0.88; }
  .scan-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  /* State */
  .loading { display: none; text-align: center; padding: 64px 0; color: var(--muted); }
  .loading.show { display: block; }
  .spinner { width: 28px; height: 28px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; margin: 0 auto 14px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-steps { font-size: 12px; color: var(--muted); margin-top: 8px; }
  .error { display: none; padding: 12px 16px; background: var(--p0-bg); border: 1px solid var(--p0-border); border-radius: 8px; color: #fca5a5; margin-bottom: 20px; font-size: 13px; }
  .error.show { display: block; }

  /* Section wrapper */
  .section { display: none; margin-bottom: 28px; }
  .section.show { display: block; }
  .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); margin-bottom: 12px; }

  /* Score cards */
  .score-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .score-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; }
  .score-card .sc-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 8px; }
  .score-card .sc-value { font-size: 30px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
  .score-card .sc-max { font-size: 13px; font-weight: 400; color: var(--muted); }
  .score-card .sc-bar { height: 3px; background: var(--border); border-radius: 2px; margin-top: 12px; overflow: hidden; }
  .sc-fill { height: 100%; border-radius: 2px; transition: width 0.5s ease; }
  .sc-fill.good { background: var(--good); }
  .sc-fill.mid  { background: var(--p2); }
  .sc-fill.bad  { background: var(--p0); }
  .slop-pass { color: var(--good); }
  .slop-fail { color: var(--p0); }
  .slop-tells { font-size: 11px; color: var(--muted); margin-top: 6px; line-height: 1.5; }
  .slop-verdict { font-size: 12px; color: var(--muted); margin-top: 6px; line-height: 1.5; font-style: italic; }

  /* Summary */
  .summary-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; }
  .register-badge { display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); border: 1px solid currentColor; padding: 2px 8px; border-radius: 4px; margin-bottom: 10px; }
  .summary-text { font-size: 13px; color: var(--muted); line-height: 1.65; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 500; padding: 0 12px 10px; text-align: left; border-bottom: 1px solid var(--border); }
  thead th:last-child { text-align: right; }
  tbody tr { border-bottom: 1px solid var(--border); }
  tbody tr:last-child { border-bottom: none; }
  tbody td { padding: 10px 12px; vertical-align: top; }
  tbody td:last-child { text-align: right; white-space: nowrap; }
  .score-pill { font-weight: 700; font-size: 13px; }
  .score-pill.s4 { color: var(--good); }
  .score-pill.s3 { color: oklch(78% 0.15 140); }
  .score-pill.s2 { color: var(--p2); }
  .score-pill.s1 { color: var(--p1); }
  .score-pill.s0 { color: var(--p0); }
  .key-finding { color: var(--muted); font-size: 12px; }
  .table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; overflow-x: auto; }

  /* Issues */
  .issue { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 8px; }
  .issue-header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 8px; }
  .pchip { font-size: 10px; font-weight: 700; padding: 3px 7px; border-radius: 4px; white-space: nowrap; flex-shrink: 0; margin-top: 1px; }
  .pchip.p0 { background: var(--p0-bg); color: #fca5a5; border: 1px solid var(--p0-border); }
  .pchip.p1 { background: var(--p1-bg); color: #fdba74; border: 1px solid var(--p1-border); }
  .pchip.p2 { background: var(--p2-bg); color: #fde047; border: 1px solid var(--p2-border); }
  .pchip.p3 { background: var(--p3-bg); color: #9ca3af; border: 1px solid var(--p3-border); }
  .issue-title { font-size: 13px; font-weight: 600; line-height: 1.4; }
  .issue-meta { display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
  .meta-tag { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 4px; }
  .meta-tag b { color: oklch(65% 0.08 260); font-weight: 500; }
  .issue-impact { font-size: 12px; color: var(--muted); margin-bottom: 6px; line-height: 1.55; }
  .issue-rec { font-size: 12px; color: var(--text); background: var(--surface2); border-left: 2px solid var(--accent); padding: 8px 12px; border-radius: 0 6px 6px 0; line-height: 1.55; }
  .issue-rec::before { content: 'Fix: '; color: var(--accent); font-weight: 600; }

  /* Positive / Systemic */
  .callout-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .callout-list li { font-size: 13px; color: var(--muted); padding: 9px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; line-height: 1.5; }
  .callout-list.positive li::before { content: '✓ '; color: var(--good); font-weight: 700; }
  .callout-list.systemic li::before { content: '⚠ '; color: var(--p2); }
</style>
</head>
<body>
<header>
  <h1>fk-skills tool</h1>
  <span class="badge">local</span>
  <span class="agent-tag">${config.agent}</span>
</header>
<main>
  <div class="form-row">
    <input id="url" class="url-input" type="url" placeholder="https://your-app.com" autocomplete="off" spellcheck="false">
    <div class="tabs">
      <button class="tab active" data-mode="score">Full scan</button>
      <button class="tab" data-mode="check">Static only</button>
    </div>
    <button id="scan" class="scan-btn">Scan</button>
  </div>

  <div id="error" class="error"></div>
  <div id="loading" class="loading">
    <div class="spinner"></div>
    <div id="loading-label">Fetching page...</div>
    <div class="loading-steps" id="loading-steps"></div>
  </div>

  <!-- Score summary -->
  <div id="sec-scores" class="section">
    <div class="section-title">Design Health Score</div>
    <div class="score-cards">
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
        <div id="slop-val" class="sc-value" style="font-size:22px">—</div>
        <div id="slop-tells" class="slop-tells"></div>
        <div id="slop-verdict" class="slop-verdict"></div>
      </div>
    </div>
  </div>

  <!-- Summary -->
  <div id="sec-summary" class="section">
    <div class="section-title">Executive Summary</div>
    <div class="summary-card">
      <div id="register-badge" class="register-badge" style="display:none"></div>
      <div id="summary-text" class="summary-text"></div>
    </div>
  </div>

  <!-- Technical breakdown -->
  <div id="sec-tech" class="section">
    <div class="section-title">Technical Audit — 5 Dimensions</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Dimension</th><th>Key Finding</th><th>Score</th></tr></thead>
        <tbody id="tech-tbody"></tbody>
      </table>
    </div>
  </div>

  <!-- UX heuristics -->
  <div id="sec-ux" class="section">
    <div class="section-title">UX Heuristics — Nielsen's 10</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Heuristic</th><th>Key Issue</th><th>Score</th></tr></thead>
        <tbody id="ux-tbody"></tbody>
      </table>
    </div>
  </div>

  <!-- Issues -->
  <div id="sec-issues" class="section">
    <div class="section-title" id="issues-label">Issues</div>
    <div id="issues-list"></div>
  </div>

  <!-- Positive findings -->
  <div id="sec-positive" class="section">
    <div class="section-title">Positive Findings</div>
    <ul id="positive-list" class="callout-list positive"></ul>
  </div>

  <!-- Systemic issues -->
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
    setLoading(true, mode);
    clearResults();
    try {
      const res = await fetch(mode === 'score' ? '/api/score' : '/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      renderResults(data, mode);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  });

  function setLoading(on, m) {
    document.getElementById('loading').classList.toggle('show', on);
    document.getElementById('scan').disabled = on;
    if (on && m === 'score') {
      document.getElementById('loading-label').textContent = 'Running scan...';
      document.getElementById('loading-steps').textContent = 'Fetching page → detecting anti-patterns → scoring with ${config.agent}';
    } else if (on) {
      document.getElementById('loading-label').textContent = 'Running static analysis...';
      document.getElementById('loading-steps').textContent = '';
    }
  }

  function clearResults() {
    document.getElementById('error').classList.remove('show');
    ['sec-scores','sec-summary','sec-tech','sec-ux','sec-issues','sec-positive','sec-systemic']
      .forEach(id => document.getElementById(id).classList.remove('show'));
    ['tech-tbody','ux-tbody','issues-list','positive-list','systemic-list']
      .forEach(id => { document.getElementById(id).innerHTML = ''; });
    document.getElementById('slop-tells').textContent = '';
    document.getElementById('slop-verdict').textContent = '';
  }

  function showError(msg) {
    const el = document.getElementById('error');
    el.textContent = msg;
    el.classList.add('show');
  }

  function scoreClass(s) {
    return ['s0','s1','s2','s3','s4'][Math.max(0, Math.min(4, Math.round(s)))];
  }

  function barClass(pct) {
    if (pct >= 0.7) return 'good';
    if (pct >= 0.45) return 'mid';
    return 'bad';
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function show(id) { document.getElementById(id).classList.add('show'); }

  function renderResults(data, mode) {
    // ── LLM full scan ──────────────────────────────
    if (data.scores) {
      const { technical: tech, ux, slopTest: slop } = data.scores;

      // Score cards
      if (tech) {
        const pct = tech.total / 20;
        document.getElementById('tech-val').innerHTML = \`\${tech.total}<span class="sc-max"> /20</span>\`;
        const bar = document.getElementById('tech-bar');
        bar.style.width = (pct * 100) + '%';
        bar.className = 'sc-fill ' + barClass(pct);
      }
      if (ux) {
        const pct = ux.total / 40;
        document.getElementById('ux-val').innerHTML = \`\${ux.total}<span class="sc-max"> /40</span>\`;
        const bar = document.getElementById('ux-bar');
        bar.style.width = (pct * 100) + '%';
        bar.className = 'sc-fill ' + barClass(pct);
      }
      if (slop) {
        const el = document.getElementById('slop-val');
        el.textContent = slop.passed ? 'Pass' : 'Fail';
        el.className = 'sc-value ' + (slop.passed ? 'slop-pass' : 'slop-fail');
        if (slop.tells?.length) document.getElementById('slop-tells').textContent = slop.tells.join(', ');
        if (slop.verdict) document.getElementById('slop-verdict').textContent = slop.verdict;
      }
      show('sec-scores');

      // Technical table
      const techRows = Array.isArray(tech?.breakdown) ? tech.breakdown : [];
      const tbody = document.getElementById('tech-tbody');
      techRows.forEach((d, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = \`
          <td style="color:var(--muted);width:28px">\${i+1}</td>
          <td style="font-weight:500">\${esc(d.label)}</td>
          <td class="key-finding">\${esc(d.keyFinding || '—')}</td>
          <td><span class="score-pill \${scoreClass(d.score)}">\${d.score}/4</span></td>
        \`;
        tbody.appendChild(tr);
      });
      if (techRows.length) show('sec-tech');

      // UX table
      const heuristicRows = Array.isArray(ux?.heuristics) ? ux.heuristics : [];
      const uBody = document.getElementById('ux-tbody');
      heuristicRows.forEach(h => {
        const tr = document.createElement('tr');
        tr.innerHTML = \`
          <td style="color:var(--muted);width:28px">\${h.id}</td>
          <td style="font-weight:500">\${esc(h.name)}</td>
          <td class="key-finding">\${esc(h.keyIssue || '—')}</td>
          <td><span class="score-pill \${scoreClass(h.score)}">\${h.score}/4</span></td>
        \`;
        uBody.appendChild(tr);
      });
      if (heuristicRows.length) show('sec-ux');
    }

    // ── Summary ────────────────────────────────────
    if (data.summary || data.register) {
      const badge = document.getElementById('register-badge');
      if (data.register) { badge.textContent = data.register; badge.style.display = 'inline-block'; }
      document.getElementById('summary-text').textContent = data.summary || '';
      show('sec-summary');
    }

    // ── Issues (LLM + static merged) ───────────────
    const allIssues = [
      ...(data.issues || []),
      ...(data.findings || []).map(f => ({
        id: f.antipattern || f.id,
        priority: f.severity || 'P2',
        title: f.name || f.antipattern,
        category: f.category || 'Anti-Pattern',
        location: f.selector || '',
        impact: f.description || '',
        recommendation: '',
      })),
    ];

    if (allIssues.length) {
      const order = { P0:0, P1:1, P2:2, P3:3 };
      allIssues.sort((a, b) => (order[a.priority]??4) - (order[b.priority]??4));
      const list = document.getElementById('issues-list');
      allIssues.forEach(f => {
        const p = (f.priority || 'P2').toLowerCase();
        const div = document.createElement('div');
        div.className = 'issue';
        div.innerHTML = \`
          <div class="issue-header">
            <span class="pchip \${p}">\${f.priority || 'P2'}</span>
            <div class="issue-title">\${esc(f.title || f.id)}</div>
          </div>
          \${(f.location || f.category) ? \`
          <div class="issue-meta">
            \${f.location ? \`<span class="meta-tag"><b>Location</b> \${esc(f.location)}</span>\` : ''}
            \${f.category ? \`<span class="meta-tag"><b>Category</b> \${esc(f.category)}</span>\` : ''}
          </div>\` : ''}
          \${f.impact ? \`<div class="issue-impact">\${esc(f.impact)}</div>\` : ''}
          \${f.recommendation ? \`<div class="issue-rec">\${esc(f.recommendation)}</div>\` : ''}
        \`;
        list.appendChild(div);
      });
      document.getElementById('issues-label').textContent = \`Issues (\${allIssues.length})\`;
      show('sec-issues');
    }

    // ── Positive findings ──────────────────────────
    if (data.positiveFindings?.length) {
      const ul = document.getElementById('positive-list');
      data.positiveFindings.forEach(s => {
        const li = document.createElement('li');
        li.textContent = s;
        ul.appendChild(li);
      });
      show('sec-positive');
    }

    // ── Systemic issues ────────────────────────────
    if (data.systemicIssues?.length) {
      const ul = document.getElementById('systemic-list');
      data.systemicIssues.forEach(s => {
        const li = document.createElement('li');
        li.textContent = s;
        ul.appendChild(li);
      });
      show('sec-systemic');
    }
  }
</script>
</body>
</html>`;
}

// ─── HTTP server ────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function startServer(config, port) {
  const ui = buildUI(config);

  const server = createServer(async (req, res) => {
    const { method, url } = req;

    if (method === 'GET' && url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ui);
      return;
    }

    if (method === 'POST' && (url === '/api/check' || url === '/api/score')) {
      try {
        const body = await parseBody(req);
        const result = url === '/api/score'
          ? await handleScore(body, config)
          : await handleCheck(body);
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: err.message });
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise((resolve, reject) => {
    server.on('error', err => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Try --port <other>`));
      } else {
        reject(err);
      }
    });
    server.listen(port, '127.0.0.1', resolve);
  });

  return server;
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
    const cliAvailable = spawnSync('which', [config.agent], { encoding: 'utf-8' }).status === 0;
    if (!cliAvailable) {
      console.log(`\n  Configured agent "${config.agent}" not found in PATH.`);
      config = await setupWizard();
    }
  }

  const server = await startServer(config, port);

  const url = `http://localhost:${port}`;
  console.log(`\n  fk-skills tool running at ${url}`);
  console.log(`  Agent: ${config.agent}  |  Press Ctrl+C to stop\n`);

  // Try to open browser
  try {
    const open = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
      : 'xdg-open';
    spawnSync(open, [url], { detached: true, stdio: 'ignore' });
  } catch { /* not critical */ }

  // Keep alive
  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });
}
