/**
 * `fk-skills tool` — local UI checker
 *
 * Usage:
 *   npx fk-skills tool              Start the local check server
 *   npx fk-skills tool --setup      Re-run setup wizard
 *   npx fk-skills tool --port 3333  Use a custom port
 */

import { createServer } from 'node:http';
import { spawnSync, execSync } from 'node:child_process';
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

const SCORE_PROMPT = `You are a senior UI/UX reviewer. Analyze the HTML below and return a JSON score report.

RETURN ONLY VALID JSON — no markdown, no explanation, no code fences.

Schema:
{
  "register": "brand" | "product",
  "scores": {
    "technical": {
      "total": <0-20>,
      "breakdown": {
        "accessibility": <0-4>,
        "performance": <0-4>,
        "theming": <0-4>,
        "responsive": <0-4>,
        "antiPatterns": <0-4>
      }
    },
    "ux": {
      "total": <0-40>,
      "heuristics": {
        "systemStatus": <0-4>,
        "realWorldMatch": <0-4>,
        "userControl": <0-4>,
        "consistency": <0-4>,
        "errorPrevention": <0-4>,
        "recognition": <0-4>,
        "flexibility": <0-4>,
        "minimalism": <0-4>,
        "errorRecovery": <0-4>,
        "helpDocs": <0-4>
      }
    },
    "slopTest": {
      "passed": true | false,
      "tells": []
    }
  },
  "issues": [
    { "id": "string", "priority": "P0"|"P1"|"P2"|"P3", "title": "string", "fix": "string" }
  ],
  "summary": "Two-sentence plain-text summary."
}

Scoring rules:
- register: "brand" = marketing/landing/portfolio; "product" = app/dashboard/tool/admin
- technical.accessibility: heading hierarchy, alt text, color contrast signals, form labels (0=broken, 4=solid)
- technical.performance: lazy loading, script placement, image optimization signals (0=many issues, 4=clean)
- technical.theming: consistent color palette, type scale, spacing rhythm (0=chaotic, 4=systematic)
- technical.responsive: viewport meta, fluid layouts, media queries, no fixed px widths (0=none, 4=full)
- technical.antiPatterns: AI-generated UI tells present (0=many, 4=none)
- ux heuristics: Nielsen's 10, 0–4 each
- slopTest.tells: any of: gradient-text, everything-in-cards, glassmorphism-overuse, sparkle-icons, bento-grid, excessive-border-radius, emoji-overuse, generic-cta, rainbow-gradient, side-tab-borders, oversized-h1, hero-eyebrow-label
- issues: list top issues, P0=blocking/accessibility, P1=major UX, P2=minor, P3=polish. Max 8 issues.`;

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
  const truncated = htmlContent.slice(0, 80000);
  const fullPrompt = `${SCORE_PROMPT}\n\n<html>\n${truncated}\n</html>`;

  const args = agent === 'claude'
    ? ['-p', fullPrompt]
    : ['--no-git', '--full-auto', '-q', `${SCORE_PROMPT}\n\nHTML:\n${truncated}`];

  const result = spawnSync(agent, args, {
    encoding: 'utf-8',
    timeout: 90000,
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) throw new Error(`${agent} subprocess error: ${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `${agent} exited with code ${result.status}`);

  const raw = result.stdout?.trim() || '';
  if (!raw) throw new Error(`${agent} returned empty response`);

  return JSON.parse(extractJson(raw));
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
    --border: #2a2a2e;
    --text: #e8e8ea;
    --muted: #888;
    --accent: oklch(72% 0.18 85);
    --p0: #ef4444;
    --p1: #f97316;
    --p2: #eab308;
    --p3: #6b7280;
    --good: #22c55e;
  }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    line-height: 1.5;
    min-height: 100vh;
  }
  header {
    padding: 24px 32px 20px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 12px;
  }
  header h1 { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
  header .badge {
    font-size: 11px;
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 2px 8px;
    border-radius: 99px;
    color: var(--muted);
  }
  .agent-tag {
    margin-left: auto;
    font-size: 11px;
    color: var(--accent);
    opacity: 0.8;
  }
  main { max-width: 860px; margin: 0 auto; padding: 32px; }
  .form-row {
    display: flex;
    gap: 10px;
    margin-bottom: 32px;
  }
  .url-input {
    flex: 1;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 14px;
    color: var(--text);
    font-size: 14px;
    outline: none;
    transition: border-color 0.15s;
  }
  .url-input:focus { border-color: var(--accent); }
  .url-input::placeholder { color: var(--muted); }
  .scan-btn {
    background: var(--accent);
    border: none;
    border-radius: 8px;
    padding: 10px 20px;
    color: #000;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.15s;
  }
  .scan-btn:hover { opacity: 0.9; }
  .scan-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .tabs { display: flex; gap: 4px; margin-bottom: 24px; }
  .tab {
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: none;
    color: var(--muted);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .tab.active { background: var(--surface); color: var(--text); border-color: var(--accent); }

  /* Loading */
  .loading { display: none; text-align: center; padding: 60px 0; color: var(--muted); }
  .loading.show { display: block; }
  .spinner {
    width: 32px; height: 32px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    margin: 0 auto 16px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Error */
  .error { display: none; padding: 14px 16px; background: #1a0a0a; border: 1px solid #7f1d1d; border-radius: 8px; color: #fca5a5; margin-bottom: 24px; }
  .error.show { display: block; }

  /* Score cards */
  .scores { display: none; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 28px; }
  .scores.show { display: grid; }
  .score-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
  }
  .score-card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 8px; }
  .score-card .value { font-size: 28px; font-weight: 700; letter-spacing: -0.03em; }
  .score-card .value .max { font-size: 14px; font-weight: 400; color: var(--muted); }
  .score-card .bar { height: 3px; background: var(--border); border-radius: 2px; margin-top: 10px; overflow: hidden; }
  .score-card .bar-fill { height: 100%; border-radius: 2px; transition: width 0.5s ease; }
  .bar-fill.good { background: var(--good); }
  .bar-fill.mid { background: var(--p2); }
  .bar-fill.bad { background: var(--p0); }

  /* Slop test */
  .slop-pass { color: var(--good); }
  .slop-fail { color: var(--p0); }
  .slop-tells { font-size: 11px; color: var(--muted); margin-top: 6px; }

  /* Summary */
  .summary-block { display: none; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin-bottom: 24px; color: var(--muted); font-size: 13px; line-height: 1.6; }
  .summary-block.show { display: block; }
  .summary-block .register { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); margin-bottom: 6px; }

  /* Findings */
  .findings { display: none; }
  .findings.show { display: block; }
  .findings-title { font-size: 13px; font-weight: 600; margin-bottom: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .finding {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 12px 14px;
    border-radius: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    margin-bottom: 8px;
  }
  .finding .priority {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .p0 { background: #7f1d1d; color: #fca5a5; }
  .p1 { background: #7c2d12; color: #fdba74; }
  .p2 { background: #713f12; color: #fde047; }
  .p3 { background: #1f2937; color: #9ca3af; }
  .finding .title { font-size: 13px; font-weight: 500; margin-bottom: 2px; }
  .finding .fix { font-size: 12px; color: var(--muted); }

  /* Breakdown */
  .breakdown { display: none; margin-top: 24px; }
  .breakdown.show { display: block; }
  .breakdown-title { font-size: 13px; font-weight: 600; margin-bottom: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .breakdown-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .metric {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
  }
  .metric .name { color: var(--muted); }
  .metric .score { font-weight: 600; }
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
  <div id="loading" class="loading"><div class="spinner"></div><div id="loading-text">Fetching page...</div></div>

  <div id="scores" class="scores">
    <div class="score-card">
      <div class="label">Technical</div>
      <div class="value" id="tech-score">—<span class="max"> /20</span></div>
      <div class="bar"><div class="bar-fill" id="tech-bar" style="width:0%"></div></div>
    </div>
    <div class="score-card">
      <div class="label">UX</div>
      <div class="value" id="ux-score">—<span class="max"> /40</span></div>
      <div class="bar"><div class="bar-fill" id="ux-bar" style="width:0%"></div></div>
    </div>
    <div class="score-card">
      <div class="label">Slop test</div>
      <div id="slop-result" class="value" style="font-size:20px">—</div>
      <div id="slop-tells" class="slop-tells"></div>
    </div>
  </div>

  <div id="summary" class="summary-block">
    <div id="register-badge" class="register"></div>
    <div id="summary-text"></div>
  </div>

  <div id="findings" class="findings">
    <div class="findings-title" id="findings-label">Issues</div>
    <div id="findings-list"></div>
  </div>

  <div id="breakdown" class="breakdown">
    <div class="breakdown-title">Score breakdown</div>
    <div id="breakdown-grid" class="breakdown-grid"></div>
  </div>
</main>

<script>
  let mode = 'score';

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      mode = tab.dataset.mode;
    });
  });

  document.getElementById('url').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('scan').click();
  });

  document.getElementById('scan').addEventListener('click', async () => {
    const url = document.getElementById('url').value.trim();
    if (!url) return;

    setLoading(true);
    clearResults();

    try {
      const endpoint = mode === 'score' ? '/api/score' : '/api/check';
      if (mode === 'score') setLoadingText('Fetching page... running rules... scoring with ${config.agent}...');

      const res = await fetch(endpoint, {
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

  function setLoading(on) {
    document.getElementById('loading').classList.toggle('show', on);
    document.getElementById('scan').disabled = on;
  }

  function setLoadingText(t) {
    document.getElementById('loading-text').textContent = t;
  }

  function clearResults() {
    document.getElementById('error').classList.remove('show');
    document.getElementById('scores').classList.remove('show');
    document.getElementById('summary').classList.remove('show');
    document.getElementById('findings').classList.remove('show');
    document.getElementById('breakdown').classList.remove('show');
  }

  function showError(msg) {
    const el = document.getElementById('error');
    el.textContent = msg;
    el.classList.add('show');
  }

  function barClass(pct) {
    if (pct >= 0.7) return 'good';
    if (pct >= 0.45) return 'mid';
    return 'bad';
  }

  function renderResults(data, mode) {
    // Findings (both modes)
    const allFindings = [
      ...(data.issues || []),
      ...(data.findings || []).map(f => ({
        id: f.antipattern || f.id,
        priority: f.severity || 'P2',
        title: f.name || f.antipattern,
        fix: f.description || '',
      })),
    ];

    if (allFindings.length > 0) {
      const list = document.getElementById('findings-list');
      const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
      allFindings
        .sort((a, b) => (order[a.priority] ?? 4) - (order[b.priority] ?? 4))
        .forEach(f => {
          const div = document.createElement('div');
          div.className = 'finding';
          div.innerHTML = \`
            <span class="priority \${f.priority?.toLowerCase()}">\${f.priority || 'P2'}</span>
            <div>
              <div class="title">\${esc(f.title || f.id)}</div>
              \${f.fix ? \`<div class="fix">\${esc(f.fix)}</div>\` : ''}
            </div>
          \`;
          list.appendChild(div);
        });
      document.getElementById('findings-label').textContent = \`Issues (\${allFindings.length})\`;
      document.getElementById('findings').classList.add('show');
    }

    // LLM scores (score mode only)
    if (data.scores) {
      const tech = data.scores.technical;
      const ux = data.scores.ux;
      const slop = data.scores.slopTest;

      if (tech) {
        const pct = tech.total / 20;
        document.getElementById('tech-score').innerHTML = \`\${tech.total}<span class="max"> /20</span>\`;
        const bar = document.getElementById('tech-bar');
        bar.style.width = (pct * 100) + '%';
        bar.className = 'bar-fill ' + barClass(pct);
      }
      if (ux) {
        const pct = ux.total / 40;
        document.getElementById('ux-score').innerHTML = \`\${ux.total}<span class="max"> /40</span>\`;
        const bar = document.getElementById('ux-bar');
        bar.style.width = (pct * 100) + '%';
        bar.className = 'bar-fill ' + barClass(pct);
      }
      if (slop) {
        const el = document.getElementById('slop-result');
        el.textContent = slop.passed ? 'Pass' : 'Fail';
        el.className = 'value ' + (slop.passed ? 'slop-pass' : 'slop-fail');
        if (slop.tells?.length) {
          document.getElementById('slop-tells').textContent = slop.tells.join(', ');
        }
      }
      document.getElementById('scores').classList.add('show');

      // Breakdown
      const grid = document.getElementById('breakdown-grid');
      const metrics = [
        ...(tech?.breakdown ? Object.entries(tech.breakdown).map(([k, v]) => ({ name: k, score: v, max: 4 })) : []),
        ...(ux?.heuristics ? Object.entries(ux.heuristics).map(([k, v]) => ({ name: k, score: v, max: 4 })) : []),
      ];
      metrics.forEach(({ name, score, max }) => {
        const div = document.createElement('div');
        div.className = 'metric';
        div.innerHTML = \`<span class="name">\${formatKey(name)}</span><span class="score">\${score}/<span style="color:var(--muted)">\${max}</span></span>\`;
        grid.appendChild(div);
      });
      document.getElementById('breakdown').classList.add('show');
    }

    // Summary
    if (data.summary || data.register) {
      document.getElementById('register-badge').textContent = data.register || '';
      document.getElementById('summary-text').textContent = data.summary || '';
      document.getElementById('summary').classList.add('show');
    }
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function formatKey(k) {
    return k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
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
