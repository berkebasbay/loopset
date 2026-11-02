import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function content(markdown) {
  let fence = '';
  return markdown.split('\n').filter(line => {
    const mark = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (mark) { if (!fence) fence = mark[1]; else if (mark[1][0] === fence[0] && mark[1].length >= fence.length) fence = ''; return false; }
    return !fence;
  }).join('\n');
}
export function headingAnchors(markdown) {
  const used = new Set();
  for (const match of content(markdown).matchAll(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = match[1].replace(/<[^>]*>/g, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}_ -]/gu, '').replace(/ /g, '-');
    let id = base, n = 0; while (used.has(id)) id = `${base}-${++n}`;
    used.add(id);
  }
  for (const match of content(markdown).matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) used.add(match[1]);
  return used;
}
export function checkDocumentation(root, files) {
  root = realpathSync(root);
  const errors = [], anchors = new Map(); let count = 0;
  for (const file of files) {
    const text = content(readFileSync(path.join(root, file), 'utf8')).replace(/`[^`\n]+`/g, '');
    const links = [...text.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g)].map(match => match[1] || match[2]);
    links.push(...[...text.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].map(match => match[1]));
    for (const link of links) {
      if (/^(?:https?:|mailto:|\/\/)/i.test(link)) continue;
      count++;
      try {
        const [url, hash] = link.split('#'), pathname = decodeURIComponent(url.split('?')[0]);
        const target = pathname ? path.resolve(pathname.startsWith('/') ? root : path.dirname(path.join(root, file)), pathname.startsWith('/') ? `.${pathname}` : pathname) : path.join(root, file);
        const relative = path.relative(root, target);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !existsSync(target) || !statSync(target).isFile()) throw new Error('target file is missing or outside the repository');
        const actual = path.relative(root, realpathSync(target));
        if (actual === '..' || actual.startsWith(`..${path.sep}`) || path.isAbsolute(actual)) throw new Error('target symlink is outside the repository');
        if (hash && path.extname(target).toLowerCase() === '.md') {
          if (!anchors.has(target)) anchors.set(target, headingAnchors(readFileSync(target, 'utf8')));
          if (!anchors.get(target).has(decodeURIComponent(hash))) throw new Error('heading anchor is missing');
        }
      } catch (error) { errors.push(`${file}: ${link} — ${error.message}`); }
    }
  }
  return { files: files.length, links: count, errors };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.md'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
  const result = checkDocumentation(root, files);
  if (result.errors.length) { console.error(result.errors.join('\n')); process.exitCode = 1; }
  else console.log(`Documentation checks passed: ${result.files} files, ${result.links} local links and anchors.`);
}
