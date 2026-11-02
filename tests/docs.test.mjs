import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDocumentation, headingAnchors } from '../scripts/check-docs.mjs';
test('heading anchors preserve real headings, duplicate IDs and explicit anchors without code examples', () => {
  assert.deepEqual([...headingAnchors('# Start\n## Same\n## Same\n## `Use API` & files\n## Déjà vu\n```md\n# Hidden\n```\n<a id="example"></a>')], ['start', 'same', 'same-1', 'use-api--files', 'déjà-vu', 'example']);
});
test('local document and image links pass; missing files, anchors and paths outside the repo fail', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loopset-docs-'));
  try {
    fs.mkdirSync(path.join(root, 'docs')); fs.writeFileSync(path.join(root, 'asset.svg'), '<svg/>');
    fs.writeFileSync(path.join(root, 'docs/guide.md'), '# Hello\n## Example\n');
    fs.writeFileSync(path.join(root, 'README.md'), '# Demo\n[Guide](docs/guide.md#example)\n<img src="asset.svg">\n[Web](https://example.com/)\n```md\n[Not a link](missing.md)\n```');
    assert.equal(checkDocumentation(root, ['README.md', 'docs/guide.md']).errors.length, 0);
    fs.writeFileSync(path.join(root, 'README.md'), '[Gone](gone.md) [Wrong heading](docs/guide.md#gone) [Outside](../outside.md)');
    assert.equal(checkDocumentation(root, ['README.md']).errors.length, 3);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('documentation links cannot read a symlink outside the repository', { skip: process.platform === 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loopset-docs-')), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'loopset-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'note.md'), '# Outside'); fs.symlinkSync(path.join(outside, 'note.md'), path.join(root, 'linked.md'));
    fs.writeFileSync(path.join(root, 'README.md'), '[Link](linked.md#outside)');
    assert.equal(checkDocumentation(root, ['README.md']).errors.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});
