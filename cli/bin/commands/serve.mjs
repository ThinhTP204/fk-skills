/**
 * `fk-skills serve` — local scan server
 *
 * GET  /health          → { ok, version }
 * GET  /api/check?url=  → fetch URL, run 44 rules, return findings JSON
 * POST /api/dom         → { url, html }, run 44 rules, return findings JSON
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SCAN_PORT = 3001;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function runDetect(html, url) {
  const { detectHtml } = await import('../../engine/detect-antipatterns.mjs');
  const tmp = join(tmpdir(), `fk-serve-${Date.now()}.html`);
  try {
    writeFileSync(tmp, html, 'utf-8');
    return await detectHtml(tmp, { url });
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; });
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function json(res, data, status = 200) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function createScanServer() {
  const pkg = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8'));

  return createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && req.url === '/health') {
      return json(res, { ok: true, version: pkg.version });
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/check')) {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const target = params.get('url');
      if (!target) return json(res, { error: 'Missing url param' }, 400);
      try {
        const r = await fetch(target, {
          headers: { 'User-Agent': 'fk-skills-scanner/1.0' },
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) return json(res, { error: `HTTP ${r.status} ${r.statusText}` }, 502);
        const html = await r.text();
        const findings = await runDetect(html, target);
        return json(res, { ok: true, url: target, findings, scannedAt: Date.now() });
      } catch (err) {
        return json(res, { error: err.message }, 502);
      }
    }

    if (req.method === 'POST' && req.url === '/api/dom') {
      let body;
      try { body = await parseBody(req); } catch { return json(res, { error: 'Invalid JSON' }, 400); }
      const { url = '', html = '' } = body;
      if (!html) return json(res, { error: 'Missing html' }, 400);
      try {
        const findings = await runDetect(html, url);
        return json(res, { ok: true, url, findings, scannedAt: Date.now() });
      } catch (err) {
        return json(res, { error: err.message }, 500);
      }
    }

    cors(res);
    res.writeHead(404);
    res.end('Not found');
  });
}

export async function run(args = []) {
  const portIdx = args.indexOf('--port');
  const port = portIdx !== -1 && args[portIdx + 1] ? parseInt(args[portIdx + 1], 10) : SCAN_PORT;

  const server = createScanServer();
  await new Promise((resolve, reject) => {
    server.on('error', err => {
      if (err.code === 'EADDRINUSE') reject(new Error(`Port ${port} in use. Try --port <other>`));
      else reject(err);
    });
    server.listen(port, '127.0.0.1', resolve);
  });

  console.log(`\n  fk-skills scan server  →  http://localhost:${port}`);
  console.log(`  Endpoints: /health  /api/check?url=  /api/dom`);
  console.log(`  Ctrl+C để dừng\n`);
  process.on('SIGINT', () => { server.close(); process.exit(0); });
}
