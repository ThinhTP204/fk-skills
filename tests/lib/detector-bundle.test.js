import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { readSourceFiles } from '../../scripts/lib/utils.js';

const ROOT = process.cwd();

describe('skill detector bundle', () => {
  test('adds the detector wrapper and engine files to skill scripts', () => {
    const { skills } = readSourceFiles(ROOT);
    const skill = skills.find(s => s.name === 'fk');
    const scriptNames = new Set(skill.scripts.map(s => s.name));

    expect(scriptNames.has('detect.mjs')).toBe(true);
    expect(scriptNames.has('detector/detect-antipatterns.mjs')).toBe(true);
    expect(scriptNames.has('detector/detect-antipatterns-browser.js')).toBe(true);
    expect(scriptNames.has('detector/cli/main.mjs')).toBe(true);
    expect(scriptNames.has('detector/engines/static-html/detect-html.mjs')).toBe(true);
  });

  test('review references the bundled detector command', () => {
    const review = fs.readFileSync(path.join(ROOT, 'skill/reference/review.md'), 'utf-8');

    expect(review).toContain('node {{scripts_path}}/detect.mjs --json [target]');
    expect(review).not.toContain('npx fk-skills detect');
  });
});
