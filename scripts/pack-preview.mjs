/**
 * pack-preview.mjs — a preview build archive of the current commit for a
 * showcase preview PR (plan 10 §8 owner sign-off). Not a release: release
 * archives come only from release.yml on a vX.Y.Z tag.
 *
 * Builds dist/ (release build, no test hooks), stamps dist/showcase.json with
 * the preview version 3.0.0-preview.<sha7> (posters copied to that name, as the
 * showcase build copies posters by version) and writes
 * tmp/preview/<slug>-v3-preview-<sha7>.tar.gz plus its .sha256. The archive is
 * uploaded to a GitHub pre-release tagged v3-preview-<sha7> (no dots, so the
 * release workflow's v*.*.* trigger does not run).
 * Usage: node scripts/pack-preview.mjs   (refuses to run on a dirty tree)
 */
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const sh = (c) => execSync(c, { encoding: 'utf8' }).trim();
if (sh('git status --porcelain')) { console.error('pack-preview: the tree is dirty; commit first'); process.exit(1); }
const sha = sh('git rev-parse HEAD'), sha7 = sha.slice(0, 7);
const slug = JSON.parse(readFileSync('package.json', 'utf8')).name;
execSync('npm run build', { stdio: 'inherit', env: { ...process.env, VITE_TEST_HOOKS: '' } });
const m = JSON.parse(readFileSync('dist/showcase.json', 'utf8'));
const version = `3.0.0-preview.${sha7}`;
for (const ext of ['webp', 'jpg']) {
  const f = m.poster?.[ext];
  if (f && existsSync(join('dist', f))) { const to = `poster-${version}.${ext}`; copyFileSync(join('dist', f), join('dist', to)); m.poster[ext] = to; }
}
m.version = version;
m.preview = { commit: sha, note: 'Preview build of branch v3 for the owner visual review (plan 10 §8). Not a release.' };
writeFileSync('dist/showcase.json', JSON.stringify(m, null, 2) + '\n');
mkdirSync('tmp/preview', { recursive: true });
const name = `${slug}-v3-preview-${sha7}.tar.gz`, out = join('tmp/preview', name);
execFileSync('tar', ['-czf', out, '-C', 'dist', '.']);
const hash = createHash('sha256').update(readFileSync(out)).digest('hex');
writeFileSync(`${out}.sha256`, `${hash}  ${name}\n`);
console.log(JSON.stringify({ commit: sha, tag: `v3-preview-${sha7}`, version, archive: out, sha256: hash }));
