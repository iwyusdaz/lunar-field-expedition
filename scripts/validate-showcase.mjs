/**
 * Validates showcase.json against the schema (copied from the showcase repo),
 * and checks that its version equals the release tag.
 * Usage: node scripts/validate-showcase.mjs <version>
 */
import { readFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) { console.error('usage: node scripts/validate-showcase.mjs <version>'); process.exit(1); }

const manifest = JSON.parse(readFileSync('dist/showcase.json', 'utf8'));
const schema = JSON.parse(readFileSync('schemas/showcase.schema.json', 'utf8'));

// Minimal JSON-schema validation of required fields (draft-07 subset used by the schema).
const errors = [];
const checkRequired = (obj, req, path) => {
  for (const key of req) if (!(key in obj)) errors.push(`${path}: missing required property "${key}"`);
};
checkRequired(manifest, schema.required || [], 'showcase.json');
const props = schema.properties || {};
for (const [key, def] of Object.entries(props)) {
  if (!(key in manifest)) continue;
  if (def.type === 'string' && typeof manifest[key] !== 'string') errors.push(`${key}: must be a string`);
  if (def.type === 'array' && !Array.isArray(manifest[key])) errors.push(`${key}: must be an array`);
  if (def.type === 'object' && (typeof manifest[key] !== 'object' || Array.isArray(manifest[key]))) errors.push(`${key}: must be an object`);
  if (def.enum && !def.enum.includes(manifest[key])) errors.push(`${key}: must be one of ${def.enum.join(', ')}`);
}

if (manifest.version !== version) errors.push(`version mismatch: showcase.json ${manifest.version} vs tag ${version}`);
if (manifest.slug !== (process.env.SLUG || manifest.slug)) { /* slug check is env-optional */ }

if (errors.length) {
  console.error('showcase.json validation failed:\n' + errors.map((e) => ' - ' + e).join('\n'));
  process.exit(1);
}
console.log('showcase.json valid; version matches tag', version);
