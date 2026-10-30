/**
 * check-v3-assets.mjs — verifies the v3 (plan 10, S4) assets and catalog, and writes the
 * asset manifest the app build (S5) reads.
 *
 * Checks (exit 1 on any failure):
 *   licences   every source in evaluation/results/asset-licence-check.json passed the fetch
 *              script's checks and has an allowed licence
 *   attribution every file under public/assets/v3 and public/assets/terrain-v3 maps to an
 *              ATTRIBUTION.md row (by the path written in the row) with an allowed licence,
 *              and public/attribution.json has the same number of rows
 *   sizes      every file <= 20 MB (plan §7); totals per tier
 *   catalog    content/objects.json: §4.1 fields and types, unique ids, honesty and role
 *              values, short <= 25 words, more <= 120 words, source URL listed in research/,
 *              realSize number | [x, y, z] | null with realSizeNote, >= 25 objects in the
 *              main scene (plan §6.1)
 *   bounds     authored and scanned models (models-meta.json) within 15% of realSize
 *   repo       size of the files git would commit (tracked + untracked, not ignored) and .git
 * Writes public/assets/v3/manifest.json and evaluation/results/v3-asset-check.json.
 * Run: node scripts/check-v3-assets.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const fail = (gate, msg) => fails.push(`${gate}: ${msg}`);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const MB = 1048576;
// Assets: CC0, public domain, CC BY 4.0, own work. Code and fonts: MIT, SIL OFL 1.1 (plan 09 §1).
const ALLOWED_LICENCE = /^(CC0 1\.0|Public domain|MIT \(code\) \/ CC BY 4\.0|CC BY 4\.0|MIT$|SIL OFL 1\.1$)/;
const FORBIDDEN = /\b(NC|ND|SA)\b|non-?commercial|no-?deriv|share-?alike/i;

// ---------------------------------------------------------------- licences
const lic = JSON.parse(read('evaluation/results/asset-licence-check.json'));
for (const s of lic.sources) {
  const c = s.checks || {};
  if (!lic.allowed.includes(s.licence)) fail('licences', `${s.id}: ${s.licence} not allowed`);
  if (!(c.allowedLicence && c.hostsAllowed && c.evidence && c.md5 !== false) || c.forbiddenTerms) fail('licences', `${s.id}: a fetch check did not pass`);
}

// ---------------------------------------------------------------- files, attribution, sizes
function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)])); }
const files = [...walk(join(ROOT, 'public/assets/v3')), ...walk(join(ROOT, 'public/assets/terrain-v3'))].map((f) => relative(ROOT, f)).sort();
const attrRows = read('ATTRIBUTION.md').split('\n').filter((l) => /^\| \d+ \|/.test(l)).map((l) => { const c = l.split('|').slice(1, -1).map((x) => x.trim()); return { n: +c[0], asset: c[1], licence: c[4] }; });
const attrJson = JSON.parse(read('public/attribution.json'));
if (attrJson.length !== attrRows.length) fail('attribution', `attribution.json has ${attrJson.length} rows, ATTRIBUTION.md ${attrRows.length}`);
for (const r of attrRows) if (!ALLOWED_LICENCE.test(r.licence) || FORBIDDEN.test(r.licence)) fail('attribution', `row ${r.n} licence "${r.licence}"`);
// A file is covered by a row whose asset cell names its path (or a parent folder / file prefix).
const rowPaths = attrRows.map((r) => ({ n: r.n, paths: [...r.asset.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\*$/, '')) }));
function rowFor(f) {
  const web = f.replace(/^public\//, '');
  const hits = rowPaths.filter((r) => r.paths.some((p) => { const q = p.replace(/^public\//, ''); return web === q || web.startsWith(q.endsWith('/') ? q : q.replace(/\.[a-z0-9]+$/, '')); }));
  return hits.map((h) => h.n);
}
const META = /(manifest|build-meta|models-meta|stars-bsc5p|albedo-clementine-750nm-1024)\.json$|tileset\.json$/;
const TIER = (f) => {
  if (/terrain-v3\/|v3\/terrain\//.test(f)) return 'streamed-after-first-click';
  if (/-1024\.ktx2$/.test(f) && /regolith\//.test(f)) return 'streamed-after-first-click';
  if (/earth-(day|clouds)-2048|models\/genesis-rock|decals\//.test(f)) return 'streamed-on-inspect';
  return 'first-load';
};
const manifest = [];
const tiers = {};
let largest = { f: '', b: 0 };
for (const f of files) {
  const bytes = statSync(join(ROOT, f)).size;
  if (bytes > 20 * MB) fail('sizes', `${f} is ${(bytes / MB).toFixed(1)} MB (> 20 MB)`);
  if (bytes > largest.b) largest = { f, b: bytes };
  const tier = TIER(f);
  tiers[tier] = (tiers[tier] || 0) + bytes;
  let rows = rowFor(f);
  if (/terrain-v3\/(near|far)\//.test(f)) rows = rowFor(f.replace(/\/\d+\/[^/]+$/, '/'));
  if (!rows.length && !META.test(f)) fail('attribution', `${f} has no ATTRIBUTION.md row`);
  if (!/terrain-v3\/(near|far)\//.test(f)) manifest.push({ path: f.replace(/^public\//, ''), bytes, sha256: createHash('sha256').update(readFileSync(join(ROOT, f))).digest('hex').slice(0, 16), tier, attribution: rows });
}
const tileStats = (k) => { const t = files.filter((f) => f.includes(`terrain-v3/${k}/`)); return { files: t.length, bytes: t.reduce((a, f) => a + statSync(join(ROOT, f)).size, 0) }; };
manifest.push({ path: 'assets/terrain-v3/near/', tier: 'streamed-after-first-click', attribution: rowFor('public/assets/terrain-v3/near/'), ...tileStats('near') });
manifest.push({ path: 'assets/terrain-v3/far/', tier: 'streamed-after-first-click', attribution: rowFor('public/assets/terrain-v3/far/'), ...tileStats('far') });

// ---------------------------------------------------------------- catalog
const cat = JSON.parse(read('content/objects.json'));
const research = read('research/sources.md') + read('research/apollo15-facts.md');
const FIELDS = ['id', 'name', 'short', 'more', 'whyItMatters', 'realSize', 'honesty', 'source', 'role'];
const HON = ['real', 'reconstructed', 'fictional', 'illustrative', 'time-lapse'];
const words = (s) => (s.match(/\S+/g) || []).length;
const ids = new Set();
const perScene = {};
for (const o of cat.objects) {
  for (const f of FIELDS) if (!(f in o)) fail('catalog', `${o.id}: missing ${f}`);
  if (ids.has(o.id)) fail('catalog', `duplicate id ${o.id}`);
  ids.add(o.id);
  for (const f of ['id', 'name', 'short', 'more', 'whyItMatters', 'source']) if (typeof o[f] !== 'string') fail('catalog', `${o.id}: ${f} not a string`);
  if (!o.name || !o.short || !o.more) fail('catalog', `${o.id}: empty name/short/more`);
  if (words(o.short) > 25) fail('catalog', `${o.id}: short has ${words(o.short)} words`);
  if (words(o.more) > 120) fail('catalog', `${o.id}: more has ${words(o.more)} words`);
  if (!HON.includes(o.honesty)) fail('catalog', `${o.id}: honesty "${o.honesty}"`);
  if (!['task', 'explore'].includes(o.role)) fail('catalog', `${o.id}: role "${o.role}"`);
  if (!/^https?:\/\//.test(o.source)) fail('catalog', `${o.id}: no source URL`);
  else if (!research.includes(o.source)) fail('catalog', `${o.id}: source ${o.source} not in research/`);
  const rs = o.realSize;
  const okSize = (typeof rs === 'number' && rs > 0) || (Array.isArray(rs) && rs.length === 3 && rs.every((v) => typeof v === 'number' && v > 0)) || (rs === null && typeof o.realSizeNote === 'string' && o.realSizeNote.length > 0);
  if (!okSize) fail('catalog', `${o.id}: realSize ${JSON.stringify(rs)}`);
  perScene[o.scene] = (perScene[o.scene] || 0) + 1;
}
const mainScene = cat._meta.scenes.find((s) => s.main).id;
if ((perScene[mainScene] || 0) < 25) fail('catalog', `main scene has ${perScene[mainScene]} objects (< 25, plan §6.1)`);

// ---------------------------------------------------------------- model bounds vs realSize
const models = JSON.parse(read('public/assets/v3/models/models-meta.json')).items.filter((i) => i.boundsM);
const bounds = [];
for (const m of models) {
  const o = cat.objects.find((x) => x.id === m.id);
  if (!o || o.realSize == null) continue;
  const a = [...m.boundsM].sort((x, y) => y - x);
  const b = Array.isArray(o.realSize) ? [...o.realSize].sort((x, y) => y - x) : [o.realSize];
  const err = Math.max(...b.map((v, i) => Math.abs(a[i] - v) / v));
  bounds.push({ id: m.id, boundsM: m.boundsM, realSize: o.realSize, error: +err.toFixed(3) });
  if (err > 0.15) fail('bounds', `${m.id}: model ${m.boundsM} vs realSize ${JSON.stringify(o.realSize)} (${(err * 100).toFixed(0)}%)`);
}

// ---------------------------------------------------------------- repo size
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
const commitList = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean);
let workTree = 0, biggest = { f: '', b: 0 };
for (const f of commitList) { try { const b = statSync(join(ROOT, f)).size; workTree += b; if (b > biggest.b) biggest = { f, b }; } catch { /* deleted */ } }
if (biggest.b > 20 * MB) fail('repo', `${biggest.f} is ${(biggest.b / MB).toFixed(1)} MB (> 20 MB)`);
const countObjects = Object.fromEntries(git('count-objects', '-vH').trim().split('\n').map((l) => l.split(': ')));
const workTreeMB = +(workTree / MB).toFixed(1);
if (workTreeMB > 300) fail('repo', `files to commit ${workTreeMB} MB (> 300 MB)`);

const result = {
  tool: 'scripts/check-v3-assets.mjs', pass: fails.length === 0, failures: fails,
  licences: { sources: lic.sources.length, allowed: lic.allowed },
  attribution: { rows: attrRows.length, attributionJsonRows: attrJson.length },
  files: { count: files.length, totalMB: +(files.reduce((a, f) => a + statSync(join(ROOT, f)).size, 0) / MB).toFixed(2), largest: { file: largest.f, MB: +(largest.b / MB).toFixed(3) }, tiersMB: Object.fromEntries(Object.entries(tiers).map(([k, v]) => [k, +(v / MB).toFixed(2)])) },
  catalog: { objects: cat.objects.length, perScene, realSizeNull: cat.objects.filter((o) => o.realSize === null).map((o) => o.id), honesty: Object.fromEntries(HON.map((h) => [h, cat.objects.filter((o) => o.honesty === h).length])), roles: { task: cat.objects.filter((o) => o.role === 'task').length, explore: cat.objects.filter((o) => o.role === 'explore').length } },
  bounds,
  repo: { filesToCommit: commitList.length, filesToCommitMB: workTreeMB, largestFile: { file: biggest.f, MB: +(biggest.b / MB).toFixed(2) }, gitCountObjects: countObjects },
};
writeFileSync(join(ROOT, 'public/assets/v3/manifest.json'), JSON.stringify({
  generatedBy: 'scripts/check-v3-assets.mjs',
  tiers: { 'first-load': 'needed for the first surface view (counts toward the 15 MB desktop / 8 MB phone budget)', 'streamed-after-first-click': 'loaded after the first interaction (plan §7)', 'streamed-on-inspect': 'loaded when the learner opens that object' },
  decoders: 'KTX2 needs three/examples/jsm/libs/basis (self-hosted); GLB tiles and models need the meshopt decoder (three/examples/jsm/libs/meshopt_decoder.module.js)',
  files: manifest,
}, null, 1) + '\n');
writeFileSync(join(ROOT, 'evaluation/results/v3-asset-check.json'), JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify(result, null, 1));
process.exit(fails.length ? 1 : 0);
