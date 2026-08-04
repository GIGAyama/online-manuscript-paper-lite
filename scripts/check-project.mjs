#!/usr/bin/env node
/* 品質ゲート。共通の検査（project-quality.mjs）と
 * GIGA Standard v5 Part I の検査（giga-v5-checks.mjs）を合成して走らせる。
 *
 *   npm run check
 *
 * 検査そのものが動いていることは tests/quality-gate.test.mjs で確かめている
 * （わざと壊して、落ちることを見る）。
 */
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectQualityChecks } from './lib/project-quality.mjs';
import { gigaV5Checks } from './lib/giga-v5-checks.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.github/workflows/.cache']);

const listFiles = (dir = ROOT, acc = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) listFiles(abs, acc);
    else acc.push(relative(ROOT, abs).split('\\').join('/'));
  }
  return acc;
};

export const buildContext = (overrides = {}) => {
  const files = listFiles();
  const config = JSON.parse(readFileSync(join(ROOT, 'quality.config.json'), 'utf8'));
  const removed = new Set(overrides.removed || []);
  const patched = overrides.patched || {};
  const all = [...new Set([...files, ...Object.keys(patched)])].filter((f) => !removed.has(f));

  return {
    files: all,
    config: overrides.config ? { ...config, ...overrides.config } : config,
    exists: (f) => !removed.has(f) && (f in patched || existsSync(join(ROOT, f))),
    read: (f) => {
      if (removed.has(f)) return null;
      if (f in patched) return patched[f];
      try { return readFileSync(join(ROOT, f), 'utf8'); } catch { return null; }
    },
    size: (f) => {
      if (removed.has(f)) return 0;
      if (f in patched) return Buffer.byteLength(patched[f]);
      try { return statSync(join(ROOT, f)).size; } catch { return 0; }
    },
  };
};

export const runChecks = (ctx) => [...projectQualityChecks, ...gigaV5Checks].map((check) => {
  let result;
  try {
    result = check.run(ctx);
  } catch (err) {
    result = { ok: false, detail: `検査自体が落ちた: ${err.message}` };
  }
  return { id: check.id, title: check.title, ...result };
});

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const results = runChecks(buildContext());
  const failed = results.filter((r) => !r.skip && !r.ok);
  const skipped = results.filter((r) => r.skip);

  for (const r of results) {
    const mark = r.skip ? '－' : (r.ok ? '✅' : '❌');
    console.log(`${mark} ${r.id.padEnd(32)} ${r.title}${r.detail ? `  … ${r.detail}` : ''}`);
  }
  console.log(`\n合計 ${results.length} 件： 合格 ${results.length - failed.length - skipped.length} / 不合格 ${failed.length} / 対象外 ${skipped.length}`);
  if (failed.length) {
    console.log('\n不合格:');
    for (const r of failed) console.log(`  ❌ ${r.id}: ${r.detail}`);
  }
  process.exit(failed.length ? 1 : 0);
}
