/**
 * post-edit-detect.mjs — Claude Code hook: auto-detect sau khi Write/Edit file UI
 *
 * Thêm vào .claude/settings.local.json (của repo này):
 * {
 *   "hooks": {
 *     "PostToolUse": [{
 *       "matcher": "Write|Edit|MultiEdit",
 *       "hooks": [{ "type": "command", "command": "node scripts/post-edit-detect.mjs" }]
 *     }]
 *   }
 * }
 */

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

const FK_SERVER = 'http://localhost:3001';
const UI_EXTS = new Set(['.html', '.astro', '.tsx', '.jsx', '.svelte', '.vue']);

const filePath = process.env.CLAUDE_TOOL_INPUT_FILE_PATH
  || process.env.CLAUDE_TOOL_OUTPUT_FILE_PATH
  || '';

if (!filePath || !UI_EXTS.has(extname(filePath))) {
  process.exit(0);
}

// Check if server is running
let serverUp = false;
try {
  const r = await fetch(FK_SERVER + '/health', { signal: AbortSignal.timeout(500) });
  serverUp = r.ok;
} catch {
  // Server not running — skip silently
}

if (!serverUp) process.exit(0);

// Read the edited file and push to /api/dom
try {
  const html = readFileSync(filePath, 'utf-8');

  const resp = await fetch(FK_SERVER + '/api/dom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'file://' + filePath, html }),
    signal: AbortSignal.timeout(10000),
  });

  if (resp.ok) {
    const data = await resp.json();
    const count = data.findings?.length ?? 0;
    if (count > 0) {
      console.log(`[fk-skills] ${count} vấn đề phát hiện trong ${filePath} — xem tại ${FK_SERVER}`);
    }
  }
} catch (err) {
  // Non-blocking — hook failures should not interrupt Claude's workflow
}
