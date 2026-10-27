import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

try {
  const current = spawnSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
  if (current.status !== 0 && current.status !== 1) throw new Error('Could not read Git hook settings.');
  if (current.stdout.trim() && current.stdout.trim() !== '.githooks') throw new Error('An existing custom hooks path was preserved. Integrate the publication checks into it explicitly.');
  if (!existsSync('.githooks/pre-commit') || !existsSync('.githooks/pre-push')) throw new Error('Run this command from the repository root with the checked-in hooks present.');
  execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks']);
  execFileSync('git', ['config', '--local', 'user.useConfigOnly', 'true']);
  console.log('Repository-local publication hooks are enabled.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
