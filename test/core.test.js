import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPartialName, findStalePartialFiles } from '../src/index.js';

function makeTree() {
  const root = mkdtempSync(join(tmpdir(), 'stale-partial-'));
  return root;
}

function writeAt(root, relPath, mtimeMs) {
  const full = join(root, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, 'x');
  const seconds = mtimeMs / 1000;
  utimesSync(full, seconds, seconds);
  return full;
}

test('isPartialName matches only the final extension', () => {
  assert.equal(isPartialName('movie.mp4.part'), true);
  assert.equal(isPartialName('movie.mp4.tmp'), true);
  assert.equal(isPartialName('movie.mp4.crdownload'), true);
  assert.equal(isPartialName('MOVIE.MP4.PART'), true);
  assert.equal(isPartialName('notes.part.txt'), false);
  assert.equal(isPartialName('archive.tar.gz'), false);
  assert.equal(isPartialName('part'), false);
});

test('findStalePartialFiles returns only stale partial files', () => {
  const root = makeTree();
  try {
    const now = 1_000_000_000_000;
    const oldPart = writeAt(root, 'a/movie.part', now - 10_000);
    const freshPart = writeAt(root, 'a/fresh.part', now - 100);
    const oldTmp = writeAt(root, 'b/deep/scratch.tmp', now - 20_000);
    const oldCrdownload = writeAt(root, 'b/installer.crdownload', now - 30_000);
    writeAt(root, 'b/keep.txt', now - 30_000);

    const found = findStalePartialFiles(root, { thresholdMs: 5_000, nowMs: now });
    const paths = found.map((f) => f.path).sort();

    assert.deepEqual(paths, [oldPart, oldTmp, oldCrdownload].sort());
    assert.ok(!paths.includes(freshPart));

    for (const f of found) {
      assert.equal(typeof f.size, 'number');
      assert.equal(typeof f.mtimeMs, 'number');
      assert.ok(f.ageMs > 5_000);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('threshold is exclusive: a file exactly at the cutoff is not stale', () => {
  const root = makeTree();
  try {
    const now = 2_000_000_000_000;
    const exact = writeAt(root, 'exact.part', now - 5_000);
    const justOver = writeAt(root, 'over.part', now - 5_001);

    const found = findStalePartialFiles(root, { thresholdMs: 5_000, nowMs: now });
    const paths = found.map((f) => f.path);

    assert.ok(!paths.includes(exact));
    assert.ok(paths.includes(justOver));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('non-partial files are never reported even when very old', () => {
  const root = makeTree();
  try {
    const now = 3_000_000_000_000;
    writeAt(root, 'old.log', now - 1_000_000);
    writeAt(root, 'old.part.txt', now - 1_000_000);

    const found = findStalePartialFiles(root, { thresholdMs: 1, nowMs: now });
    assert.deepEqual(found, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('symlinked directories are not followed', () => {
  const root = makeTree();
  const outside = makeTree();
  try {
    const now = 4_000_000_000_000;
    writeAt(outside, 'outside.part', now - 50_000);
    symlinkSync(outside, join(root, 'link'), 'dir');

    const found = findStalePartialFiles(root, { thresholdMs: 1_000, nowMs: now });
    assert.deepEqual(found, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('empty directory yields an empty list', () => {
  const root = makeTree();
  try {
    const found = findStalePartialFiles(root, { thresholdMs: 0, nowMs: 1 });
    assert.deepEqual(found, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects invalid threshold and clock values', () => {
  const root = makeTree();
  try {
    assert.throws(
      () => findStalePartialFiles(root, { thresholdMs: -1, nowMs: 0 }),
      TypeError,
    );
    assert.throws(
      () => findStalePartialFiles(root, { thresholdMs: NaN, nowMs: 0 }),
      TypeError,
    );
    assert.throws(
      () => findStalePartialFiles(root, { thresholdMs: 0, nowMs: Infinity }),
      TypeError,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
