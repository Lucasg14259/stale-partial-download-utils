import { statSync, readdirSync, lstatSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const PARTIAL_EXTENSIONS = new Set(['.part', '.tmp', '.crdownload']);

/**
 * Returns true when the file name looks like a partial download.
 * We match on the final extension only, so `archive.tar.part` counts but
 * `notes.part.txt` does not. This is deliberate: the convention is that the
 * partial marker is the last suffix, and treating a `.part` in the middle as a
 * marker would flag ordinary backup or scratch files.
 */
export function isPartialName(fileName) {
  const ext = extname(fileName).toLowerCase();
  return PARTIAL_EXTENSIONS.has(ext);
}

/**
 * Walk `root` recursively and collect partial files whose mtime is older than
 * `thresholdMs` milliseconds relative to `nowMs`.
 *
 * `nowMs` is injected rather than read from Date.now() so callers (and tests)
 * can pin the clock. The threshold is exclusive: a file exactly at the cutoff is
 * not stale. This is the least surprising rule when a cleanup job runs on a
 * schedule and two consecutive runs should not both claim the same file.
 *
 * Symlinked directories are not followed, avoiding cycles and surprising jumps
 * outside the tree the caller pointed at.
 */
export function findStalePartialFiles(root, { thresholdMs, nowMs }) {
  if (typeof thresholdMs !== 'number' || !Number.isFinite(thresholdMs) || thresholdMs < 0) {
    throw new TypeError('thresholdMs must be a non-negative finite number');
  }
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
    throw new TypeError('nowMs must be a finite number');
  }

  const results = [];
  const stack = [root];

  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      // A directory we cannot read is skipped rather than aborting the whole
      // scan; a cleanup tool that dies on one permission error is useless.
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!isPartialName(entry.name)) {
        continue;
      }

      let stats;
      try {
        stats = statSync(fullPath);
      } catch (err) {
        continue;
      }

      const ageMs = nowMs - stats.mtimeMs;
      if (ageMs > thresholdMs) {
        results.push({
          path: fullPath,
          name: basename(fullPath),
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          ageMs,
        });
      }
    }
  }

  return results;
}
