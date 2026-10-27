import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/check-publication.mjs', import.meta.url));
const cache = path.resolve('.cache'); mkdirSync(cache, { recursive: true });
function fixture(t) {
  const cwd = mkdtempSync(path.join(cache, 'publication-guard-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  git('init', '-q'); git('config', 'user.name', 'Synthetic test'); git('config', 'user.email', 'test@example.invalid');
  git('config', 'core.hooksPath', '/dev/null'); git('config', 'commit.gpgsign', 'false');
  const write = (file, body) => { mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); writeFileSync(path.join(cwd, file), body); };
  const commit = message => { git('add', '-f', '.'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  const run = (args = [], input) => spawnSync(process.execPath, [script, ...args], { cwd, input, encoding: 'utf8' });
  return { git, write, commit, run };
}

test('allows public code, documentation, example environment and binary art', t => {
  const f = fixture(t); f.write('src/index.ts', 'export const count = 2;'); f.write('docs/guide.md', '# Guide');
  f.write('.env.example', 'PUBLIC_URL=https://example.invalid/'); f.write('public/art.glb', Buffer.from([0, 1, 2]));
  f.write('src/styles.css', '@media(max-width:600px){.local-save{display:block}}');
  f.commit('Add public examples'); assert.equal(f.run().status, 0);
});

test('blocks force-staged private data even when ignored', t => {
  const f = fixture(t); f.write('.gitignore', '.private/'); f.write('.private/project.json', '{}'); f.write('AGENTS.override.md', 'Synthetic local instructions'); f.git('add', '-f', '.');
  const result = f.run(['--staged']); assert.equal(result.status, 1); assert.match(result.stderr, /private\/project.json/); assert.match(result.stderr, /AGENTS\.override\.md/);
});

test('blocks a private file committed then deleted before an outgoing push', t => {
  const f = fixture(t); f.write('README.md', '# Public'); const base = f.commit('Initial public source');
  f.write('notes/session.md', 'Synthetic private note'); f.commit('Temporary note'); f.git('rm', 'notes/session.md');
  const head = f.commit('Remove temporary note');
  const result = f.run(['--pre-push', 'origin'], `refs/heads/main ${head} refs/heads/main ${base}\n`);
  assert.equal(result.status, 1); assert.match(result.stderr, /notes\/session.md/);
});

test('blocks secret-shaped contents without printing the matched value', t => {
  const f = fixture(t); const fake = 'gh' + 'p_' + 'A'.repeat(36); f.write('src/config.ts', `export const value = '${fake}';`);
  f.commit('Synthetic credential fixture'); const result = f.run();
  assert.equal(result.status, 1); assert.match(result.stderr, /GitHub credential/); assert(!result.stderr.includes(fake));
});

test('checks commit messages as well as file contents', t => {
  const f = fixture(t); f.write('README.md', '# Public'); f.commit(['', 'Users', 'synthetic-user', 'private'].join('/'));
  const result = f.run(); assert.equal(result.status, 1); assert.match(result.stderr, /commit .*machine-specific path/);
});

test('fails closed on an invalid revision and permits a ref deletion', t => {
  const f = fixture(t); f.write('README.md', '# Public'); const head = f.commit('Initial public source');
  assert.equal(f.run(['--range', 'not-a-real-ref..HEAD']).status, 1);
  assert.equal(f.run(['--pre-push', 'origin'], `refs/heads/main ${'0'.repeat(40)} refs/heads/main ${head}\n`).status, 0);
});

test('hook setup preserves an existing custom hook path', t => {
  const f = fixture(t);
  const setup = fileURLToPath(new URL('../scripts/setup-hooks.mjs', import.meta.url));
  const cwd = f.git('rev-parse', '--show-toplevel');
  const result = spawnSync(process.execPath, [setup], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /custom hooks path was preserved/);
  assert.equal(f.git('config', '--get', 'core.hooksPath'), '/dev/null');
});

test('blocks device-local author/committer metadata before staging or pushing', t => {
  const f = fixture(t); f.write('README.md', '# Public');
  f.git('config', 'user.email', ['synthetic-user', 'synthetic-device.local'].join('@'));
  f.git('add', '.');
  assert.match(f.run(['--staged']).stderr, /device-local Git identity/);
  f.commit('Public code with unwanted metadata');
  const result = f.run(); assert.equal(result.status, 1); assert.match(result.stderr, /device-local Git identity/);
});

test('checks outgoing annotations and nested tags even when their commit is already public', t => {
  const f = fixture(t); f.write('README.md', '# Public'); const head = f.commit('Initial public source');
  f.git('update-ref', 'refs/remotes/origin/main', head);
  const pushTag = name => f.run(['--pre-push', 'origin'], `refs/tags/${name} ${f.git('rev-parse', `refs/tags/${name}`)} refs/tags/${name} ${'0'.repeat(40)}\n`);
  f.git('tag', '-a', 'public-release', '-m', 'Public release', head);
  assert.equal(pushTag('public-release').status, 0);

  const fake = 'gh' + 'p_' + 'A'.repeat(36);
  f.git('tag', '-a', 'private-annotation', '-m', fake, head);
  const direct = pushTag('private-annotation');
  assert.equal(direct.status, 1); assert.match(direct.stderr, /tag .*GitHub credential/); assert(!direct.stderr.includes(fake));
  f.git('tag', '-a', 'public-wrapper', '-m', 'Public wrapper', 'private-annotation');
  const nested = pushTag('public-wrapper');
  assert.equal(nested.status, 1); assert.match(nested.stderr, /tag .*GitHub credential/); assert(!nested.stderr.includes(fake));
});

test('checks the tagger identity without requiring a new outgoing commit', t => {
  const f = fixture(t); f.write('README.md', '# Public'); const head = f.commit('Initial public source');
  f.git('update-ref', 'refs/remotes/origin/main', head);
  f.git('config', 'user.email', ['synthetic-user', 'synthetic-device.local'].join('@'));
  f.git('tag', '-a', 'release', '-m', 'Public release', head);
  const result = f.run(['--pre-push', 'origin'], `refs/tags/release ${f.git('rev-parse', 'refs/tags/release')} refs/tags/release ${'0'.repeat(40)}\n`);
  assert.equal(result.status, 1); assert.match(result.stderr, /tag .*device-local Git identity/);
  assert(!result.stderr.includes('synthetic-device.local'));
});

test('hook setup preserves executable hooks in the default Git hook directory', t => {
  const f = fixture(t), cwd = f.git('rev-parse', '--show-toplevel');
  const setup = fileURLToPath(new URL('../scripts/setup-hooks.mjs', import.meta.url));
  f.git('config', '--unset', 'core.hooksPath');
  f.write('.githooks/pre-commit', '#!/bin/sh\n'); f.write('.githooks/pre-push', '#!/bin/sh\n');
  const directory = f.git('rev-parse', '--git-path', 'hooks'), hook = path.join(directory, 'pre-push');
  const body = '#!/bin/sh\nprintf existing-check\n'; f.write(hook, body); chmodSync(path.join(cwd, hook), 0o755);
  const result = spawnSync(process.execPath, [setup], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /executable default Git hooks were preserved/);
  assert.equal(spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd }).status, 1);
  assert.equal(readFileSync(path.join(cwd, hook), 'utf8'), body);
});

test('hook setup ignores executable sample hooks and inactive normal hooks', t => {
  const f = fixture(t), cwd = f.git('rev-parse', '--show-toplevel');
  const setup = fileURLToPath(new URL('../scripts/setup-hooks.mjs', import.meta.url));
  f.git('config', '--unset', 'core.hooksPath');
  f.write('.githooks/pre-commit', '#!/bin/sh\n'); f.write('.githooks/pre-push', '#!/bin/sh\n');
  const directory = f.git('rev-parse', '--git-path', 'hooks');
  for (const [name, mode] of [['pre-push.sample', 0o755], ['pre-push', 0o644]]) {
    const file = path.join(directory, name); f.write(file, '#!/bin/sh\n'); chmodSync(path.join(cwd, file), mode);
  }
  const result = spawnSync(process.execPath, [setup], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(f.git('config', '--get', 'core.hooksPath'), '.githooks');
});
