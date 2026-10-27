import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const current = spawnSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
  if (current.status !== 0 && current.status !== 1) throw new Error('Could not read Git hook settings.');
  if (current.stdout.trim() && current.stdout.trim() !== '.githooks') throw new Error('An existing custom hooks path was preserved. Integrate the publication checks into it explicitly.');
  if (!current.stdout.trim()) {
    const directory = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { encoding: 'utf8' }).trim();
    const active = existsSync(directory) ? readdirSync(directory).filter(name => {
      if (name.endsWith('.sample')) return false;
      const file = resolve(directory, name);
      if (!statSync(file).isFile()) return false;
      try { accessSync(file, constants.X_OK); return true; }
      catch (error) { if (error.code === 'EACCES') return false; throw error; }
    }) : [];
    if (active.length) throw new Error('Existing executable default Git hooks were preserved. Integrate the publication checks into them explicitly before changing core.hooksPath.');
  }
  if (!existsSync('.githooks/pre-commit') || !existsSync('.githooks/pre-push')) throw new Error('Run this command from the repository root with the checked-in hooks present.');
  execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks']);
  execFileSync('git', ['config', '--local', 'user.useConfigOnly', 'true']);
  console.log('Repository-local publication hooks are enabled.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
