# stale-partial-download-utils

Find leftover `.part`, `.tmp`, and `.crdownload` files that are older than a threshold so a cleanup job can remove them.

```js
import { findStalePartialFiles, isPartialName } from 'stale-partial-download-utils';

const now = Date.now();
const stale = findStalePartialFiles('/downloads', {
  thresholdMs: 24 * 60 * 60 * 1000,
  nowMs: now,
});

for (const file of stale) {
  console.log(file.path, file.ageMs, file.size);
}

console.log(isPartialName('movie.mp4.part')); // true
console.log(isPartialName('notes.part.txt')); // false
```

## Why this exists

Download managers and browsers leave behind partial files when they crash or are interrupted. Those files are invisible to the user but consume disk. Deciding which ones are safe to delete is the whole problem: a file that is still being written must be left alone, and a file that merely *contains* a partial-looking word in its name must not be touched. The trade-off here is that staleness is measured purely by modification time against a caller-supplied clock, with no attempt to detect whether a process still holds the file open. That keeps the library dependency-free and deterministic, and it means the caller is responsible for choosing a threshold large enough that an active download is not mistaken for a dead one. The comparison is strict: a file whose age is exactly the threshold is not stale, so two runs of a scheduled cleanup will not both claim the same file.

## API

### `isPartialName(fileName)`

Returns `true` when the final extension of `fileName` is `.part`, `.tmp`, or `.crdownload` (case-insensitive). Intermediate extensions are ignored, so `notes.part.txt` is not a partial file.

### `findStalePartialFiles(root, { thresholdMs, nowMs })`

Walks `root` recursively and returns an array of objects for each partial file whose modification time is older than `thresholdMs` milliseconds before `nowMs`. Each object has `path`, `name`, `size`, `mtimeMs`, and `ageMs`.

- `thresholdMs` must be a non-negative finite number.
- `nowMs` must be a finite number. Pass `Date.now()` in production; tests pass a fixed value.
- Directories that cannot be read are skipped rather than aborting the scan.
- Symlinked directories are not followed.

## Edge case worth knowing

A file named `archive.tar.part` is reported, but `archive.part.tar` is not. The rule is that the partial marker must be the last suffix. If your tool writes partial files with the marker in the middle, this library will not see them.
