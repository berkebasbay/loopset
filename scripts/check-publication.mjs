import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (args, input) => execFileSync('git', args, { input, maxBuffer: 256 * 1024 * 1024 });
const text = (args, input) => git(args, input).toString('utf8');
const split = value => value.split('\0').filter(Boolean);
const deniedComponents = new Set(['.private', '.omx', '.cache', '.git', 'node_modules', '.venv', 'playwright-report', 'test-results', 'coverage']);
const privateRoots = new Set(['notes', 'context', 'memories', 'evidence', 'artifacts', 'output', 'dist', 'dist-engine']);
const contentRules = [
  ['machine-specific path', /\/(?:Users|home)\/[^/\s"'<>]+(?:\/|$)|\/Volumes\/[^/\s"'<>]+/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['API credential', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['device-local Git identity', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.local\b/i],
];

function privatePath(file) {
  const parts = file.toLowerCase().split('/'), name = parts.at(-1);
  return parts.some(part => deniedComponents.has(part)) || privateRoots.has(parts[0])
    || name === '.ds_store' || name === 'progress.md'
    || (name.startsWith('.env') && name !== '.env.example')
    || /\.(?:zip|bundle|sqlite3?|db|har|p12|pfx|pem|key)$/.test(name);
}

function entries(ref) {
  return split(text(['ls-tree', '-rz', ref])).map(row => {
    const tab = row.indexOf('\t'), [mode, type, oid] = row.slice(0, tab).split(' ');
    return { file: row.slice(tab + 1), oid, type, mode };
  });
}

function indexEntries() {
  return split(text(['ls-files', '--stage', '-z'])).map(row => {
    const tab = row.indexOf('\t'), [mode, oid, stage] = row.slice(0, tab).split(' ');
    if (stage !== '0') throw new Error('Resolve index conflicts before publication checks.');
    return { file: row.slice(tab + 1), oid, type: 'blob', mode };
  });
}

function inspect(snapshots, messages) {
  const findings = new Set(), blobs = new Map();
  for (const { file, oid, type } of snapshots) {
    if (privatePath(file)) findings.add(`${file}: private/generated file path`);
    if (type === 'commit') findings.add(`${file}: submodule requires explicit publication review`);
    if (type === 'blob' && !blobs.has(oid)) blobs.set(oid, file);
  }
  if (blobs.size) {
    const output = git(['cat-file', '--batch'], `${[...blobs.keys()].join('\n')}\n`);
    let offset = 0;
    for (const [oid, file] of blobs) {
      const end = output.indexOf(10, offset), [actual, type, size] = output.subarray(offset, end).toString().split(' ');
      if (actual !== oid || type !== 'blob' || !/^\d+$/.test(size)) throw new Error('Could not verify Git object contents.');
      offset = end + 1;
      const body = output.subarray(offset, offset + Number(size)); offset += Number(size) + 1;
      if (body.includes(0)) continue; // Images, models and films require separate visual/provenance review.
      for (const [label, rule] of contentRules) if (rule.test(body.toString('utf8'))) findings.add(`${file}: ${label}`);
    }
  }
  for (const { id, body } of messages) {
    for (const [label, rule] of contentRules) if (rule.test(body)) findings.add(`commit ${id.slice(0, 8)}: ${label}`);
  }
  if (findings.size) {
    console.error(`Publication blocked:\n${[...findings].map(f => `- ${f}`).join('\n')}\nRepair the staged/outgoing history. Do not bypass the guard. Matching contents are never printed.`);
    process.exitCode = 1;
  } else console.log('Publication check passed: checked Git snapshots and commit text. Review prose, images and licences separately.');
}

try {
  const [mode, value] = process.argv.slice(2);
  if (mode === '--staged') inspect(indexEntries(), [{ id: 'staged', body: text(['var', 'GIT_AUTHOR_IDENT']) + text(['var', 'GIT_COMMITTER_IDENT']) }]);
  else {
    const revisions = new Set();
    if (mode === '--pre-push') {
      for (const line of readFileSync(0, 'utf8').trim().split('\n').filter(Boolean)) {
        const [, local, , remote] = line.trim().split(/\s+/);
        if (!local || !remote) throw new Error('Invalid pre-push input.');
        if (/^0+$/.test(local)) continue;
        const args = /^0+$/.test(remote) ? [local, '--not', `--remotes=${value}`] : [`${remote}..${local}`];
        for (const id of text(['rev-list', ...args]).trim().split('\n').filter(Boolean)) revisions.add(id);
      }
    } else if (!mode || mode === '--range') {
      if (mode === '--range' && !value) throw new Error('Provide the outgoing commit range.');
      for (const id of text(['rev-list', ...(mode ? [value] : ['-1', 'HEAD'])]).trim().split('\n').filter(Boolean)) revisions.add(id);
    } else throw new Error('Use --staged, --range BASE..HEAD, --pre-push REMOTE, or no arguments.');
    inspect([...revisions].flatMap(entries), [...revisions].map(id => ({ id, body: text(['show', '-s', '--format=%B%n%an <%ae>%n%cn <%ce>', id]) })));
  }
} catch {
  console.error('Publication check could not complete. Resolve Git/index/range errors and retry; do not bypass the guard.');
  process.exitCode = 1;
}
