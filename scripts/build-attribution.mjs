/**
 * build-attribution.mjs — generates public/attribution.json from ATTRIBUTION.md
 * (the markdown table is the single source of truth; the build contract, 08
 * section 5.4, requires an array of {asset, author, source, license, changes}
 * at the build root).
 * Run: node scripts/build-attribution.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const md = readFileSync('ATTRIBUTION.md', 'utf8');
const rows = [];
for (const line of md.split('\n')) {
  if (!/^\| \d+ \|/.test(line)) continue;
  const cells = line.split('|').slice(1, -1).map(c => c.trim());
  if (cells.length < 7) continue;
  // columns: # | Asset | Author | Source | License | Date retrieved | Changes made
  // (H-2: the leading # column used to shift every key by one)
  const [, asset, author, source, license, date, changes] = cells;
  rows.push({
    asset: asset.replace(/\s+/g, ' '),
    author: author.replace(/\s+/g, ' '),
    source,
    license: license.replace(/\s+/g, ' '),
    retrieved: date,
    changes: changes.replace(/\s+/g, ' '),
  });
}
if (rows.length < 5) {
  console.error(`attribution: expected >= 5 rows, parsed ${rows.length}`);
  process.exit(1);
}
writeFileSync('public/attribution.json', JSON.stringify(rows, null, 2) + '\n');
console.log(`public/attribution.json: ${rows.length} entries`);
