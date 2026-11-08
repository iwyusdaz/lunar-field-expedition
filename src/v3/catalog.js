/**
 * catalog.js — object catalog loader and checks (plan 10 §4.1, §4.3).
 *
 * Each repo keeps one entry per inspectable thing in content/objects.json, so an
 * instructional designer can edit names and text without touching code:
 *   { "objects": [ { id, name, short, more, whyItMatters, realSize, honesty,
 *                    source, role, objective?, scene?, priority?, realSizeNote?, realDistance? } ] }
 * (a bare array is accepted too).
 *
 * Roles (owner decision 2026-11-07, G2 feedback §1): only course-relevant
 * objects are inspectable.
 *  - "task": the learner acts on it in a step (a question choice, a reading, a
 *    hazard). Needs whyItMatters and objective.
 *  - "learn": it teaches something an objective needs. Needs whyItMatters and
 *    objective.
 *  - "decorative": set dressing, ambient life, sky, background props. No hover
 *    label, outline, info card, Objects-list entry, journal entry or text-mode
 *    card. The entry stays in the catalog for the scale check and the honesty
 *    record; short, more and whyItMatters are optional.
 * `objective` names the module or learning objective the object serves (free
 * text, e.g. "m2: read the wind speed"), so whyItMatters is tied to it.
 * The old role "explore" is rejected: re-classify it as learn or decorative.
 *
 * Scale (plan 10 §4.3) has two exceptions, both recorded in the catalog:
 *  - `realSize: null` with a `realSizeNote` saying why no bounding box can be
 *    compared (a landform larger than the modelled terrain, a layer, a line, a
 *    flash, the stars). The scale check reports it as exempt, with the note.
 *  - Objects that turn or animate set userData.scaleFrame = 'local' or
 *    userData.restSize (see measureObject) so their measured box does not
 *    depend on their heading or pose.
 *  - `realDistance` (metres) for sky bodies drawn at their true angular size on
 *    a far sky shell (Earth, Sun): the check compares the angular size the
 *    camera sees (largest side / distance) with realSize / realDistance.
 *
 * Import the JSON in the app (`import raw from '../content/objects.json'`) so it
 * is bundled and works at any sub-path, then `createCatalog(raw)`.
 * @module v3/catalog
 */

export const HONESTY = Object.freeze(['real', 'reconstructed', 'fictional', 'illustrative', 'time-lapse']);
export const ROLES = Object.freeze(['task', 'learn', 'decorative']);
/** Roles that are inspectable (course-relevant). */
export const COURSE_ROLES = Object.freeze(['task', 'learn']);
/** True for a course-relevant (inspectable) catalog entry. */
export const isInspectable = (o) => COURSE_ROLES.includes(o?.role);
/** Tag text on cards, lists and text mode for each inspectable role. */
export const ROLE_LABELS = Object.freeze({ task: 'Task object', learn: 'Learn' });
export const LIMITS = Object.freeze({ shortWords: 25, moreWords: 120, scaleTolerance: 0.15 });

/** Human label shown on cards and in text mode for each honesty value. */
export const HONESTY_LABELS = Object.freeze({
  real: 'Real',
  reconstructed: 'Reconstructed',
  fictional: 'Fictional',
  illustrative: 'Illustrative',
  'time-lapse': 'Time-lapse',
});

/** Word count used by every v3 text limit (same tokenisation as ui-audit). */
export function countWords(text) {
  return (String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

const isSize = (v) => (typeof v === 'number' && v > 0)
  || (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && x >= 0) && v.some((x) => x > 0));

/**
 * Check a raw catalog. Returns every problem found; an empty `errors` list means
 * the catalog is valid. `warnings` never fail a build.
 * @param {object|object[]} raw
 * @returns {{ objects: object[], errors: string[], warnings: string[] }}
 */
export function validateCatalog(raw) {
  const list = Array.isArray(raw) ? raw : (raw?.objects || []);
  const errors = [];
  const warnings = [];
  const seen = new Set();
  if (!list.length) errors.push('catalog is empty');
  list.forEach((o, i) => {
    const at = `objects[${i}]${o?.id ? ` (${o.id})` : ''}`;
    if (!o || typeof o !== 'object') { errors.push(`${at}: not an object`); return; }
    if (!o.id || typeof o.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(o.id)) errors.push(`${at}: id must be lower-case kebab-case`);
    if (seen.has(o.id)) errors.push(`${at}: duplicate id`);
    seen.add(o.id);
    const course = isInspectable(o);
    if (o.role === 'explore') errors.push(`${at}: role "explore" was replaced (owner decision 2026-11-07): use "learn" with whyItMatters and objective, or "decorative" (not inspectable)`);
    else if (!ROLES.includes(o.role)) errors.push(`${at}: role must be task, learn or decorative`);
    for (const k of course ? ['name', 'short', 'more'] : ['name']) {
      if (typeof o[k] !== 'string' || !o[k].trim()) errors.push(`${at}: ${k} is required`);
    }
    if (countWords(o.short) > LIMITS.shortWords) errors.push(`${at}: short has ${countWords(o.short)} words (max ${LIMITS.shortWords})`);
    if (countWords(o.more) > LIMITS.moreWords) errors.push(`${at}: more has ${countWords(o.more)} words (max ${LIMITS.moreWords})`);
    if (course) {
      if (typeof o.whyItMatters !== 'string' || !o.whyItMatters.trim()) errors.push(`${at}: a ${o.role} object needs whyItMatters (what it teaches for its objective)`);
      if (typeof o.objective !== 'string' || !o.objective.trim()) errors.push(`${at}: a ${o.role} object needs objective (the module or objective it serves)`);
    } else if (o.whyItMatters !== undefined && typeof o.whyItMatters !== 'string') errors.push(`${at}: whyItMatters must be a string`);
    if (o.realSize === null) {
      if (typeof o.realSizeNote !== 'string' || !o.realSizeNote.trim()) errors.push(`${at}: realSize null needs a realSizeNote (why no size can be compared)`);
    } else if (!isSize(o.realSize)) errors.push(`${at}: realSize must be metres (a number, or [x, y, z]), or null with a realSizeNote`);
    if (o.realDistance !== undefined && !(typeof o.realDistance === 'number' && o.realDistance > 0)) errors.push(`${at}: realDistance must be metres (> 0)`);
    if (o.realDistance !== undefined && typeof o.realSize !== 'number') errors.push(`${at}: realDistance needs a single-number realSize (the diameter)`);
    if (!HONESTY.includes(o.honesty)) errors.push(`${at}: honesty must be one of ${HONESTY.join(', ')}`);
    if (typeof o.source !== 'string') errors.push(`${at}: source is required (URL from the research notes)`);
    else if (!o.source.trim()) {
      if (o.honesty !== 'fictional') errors.push(`${at}: source may be empty only for fictional objects`);
    } else if (!/^https?:\/\/\S+$/.test(o.source) && !/^research\/\S+/.test(o.source)) {
      errors.push(`${at}: source must be an http(s) URL or a research/ path`);
    }
  });
  if (list.length && !list.some(isInspectable)) errors.push('catalog has no task or learn object');
  return { objects: list, errors, warnings };
}

/**
 * Build the runtime catalog. Throws on an invalid catalog in dev and test builds
 * so mistakes surface early; release builds log and keep the valid entries.
 */
export function createCatalog(raw, { strict = true } = {}) {
  const { objects, errors, warnings } = validateCatalog(raw);
  if (errors.length) {
    const msg = `content/objects.json: ${errors.length} problem(s)\n  ${errors.join('\n  ')}`;
    if (strict) throw new Error(msg);
    console.warn(msg);
  }
  for (const w of warnings) console.warn(`content/objects.json: ${w}`);
  const byId = new Map(objects.map((o) => [o.id, o]));
  const inspectable = objects.filter(isInspectable);
  return {
    objects,
    /** Course-relevant entries (task, learn): the journal, Objects list and text mode use these. */
    inspectable,
    isInspectable: (id) => isInspectable(byId.get(id)),
    byId,
    get: (id) => byId.get(id) || null,
    has: (id) => byId.has(id),
    size: objects.length,
    inScene: (scene) => objects.filter((o) => !o.scene || o.scene === scene || (Array.isArray(o.scene) && o.scene.includes(scene))),
  };
}

/** Fetch a catalog at runtime (for repos that stream catalogs per scene). */
export async function loadCatalog(path = 'content/objects.json', opts) {
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || './';
  const res = await fetch(`${base}${path.replace(/^\//, '')}`);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return createCatalog(await res.json(), opts);
}

/**
 * Scale check (plan 10 §4.3): compare a measured bounding-box size [x, y, z] in
 * metres with the catalog's realSize. A number is compared with the largest
 * side; an array is compared side by side after sorting both (orientation-free).
 * Same rule as ui-audit's scale gate.
 * @returns {{ ok: boolean, error: number }}
 */
export function scaleError(measured, realSize, tolerance = LIMITS.scaleTolerance) {
  const s = [...measured].map(Number);
  let err;
  if (Array.isArray(realSize)) {
    const a = [...s].sort((x, y) => y - x);
    const b = [...realSize].sort((x, y) => y - x);
    err = Math.max(...b.map((v, i) => (v ? Math.abs(a[i] - v) / v : 0)));
  } else {
    err = Math.abs(Math.max(...s) - realSize) / realSize;
  }
  return { ok: err <= tolerance, error: +err.toFixed(3) };
}

/**
 * Run the scale check over a scene: every catalog object needs a root with
 * userData.objectId in `root`. Pass three's Box3 and Vector3 so this module
 * stays free of a three import (it runs in node tests and the browser).
 * @returns {{ id: string, ok: boolean, error?: number, measured?: number[], reason?: string }[]}
 */
export function checkSceneScale(catalog, root, { Box3, Vector3 }, tolerance = LIMITS.scaleTolerance, { camera = null } = {}) {
  const roots = new Map();
  root.traverse((o) => { const id = o.userData?.objectId; if (id && !roots.has(id)) roots.set(id, o); });
  const box = new Box3();
  const size = new Vector3();
  const centre = new Vector3();
  return catalog.objects.map((c) => {
    if (c.realSize === null) return { id: c.id, ok: true, exempt: true, reason: c.realSizeNote || 'no realSize' };
    const obj = roots.get(c.id);
    if (!obj) return { id: c.id, ok: false, reason: 'no object with this userData.objectId' };
    box.setFromObject(obj);
    const m = measureObject(obj, { Box3, Vector3 });
    const measured = m.size.map((x) => +x.toFixed(3));
    if (c.realDistance) {
      if (!camera) return { id: c.id, ok: false, measured, reason: 'angular check needs the camera' };
      const dist = box.getCenter(centre).distanceTo(camera.getWorldPosition(new Vector3()));
      return { id: c.id, measured, frame: m.frame, angular: true, distance: +dist.toFixed(1), ...angularScaleError(Math.max(...measured), dist, c.realSize, c.realDistance, tolerance) };
    }
    return { id: c.id, measured, frame: m.frame, ...scaleError(measured, c.realSize, tolerance) };
  });
}

/**
 * Size of a catalog object for the scale check (same rules as ui-audit):
 *  - userData.restSize: an articulated figure's box in its rest pose, which the
 *    scene computes from the figure's own geometry when it builds it (a walking
 *    or kneeling pose would change the box, not the figure's size);
 *  - userData.scaleFrame === 'local': the box in the object's own axes, so a
 *    turning globe, a vehicle's heading or a billboard does not inflate it;
 *  - otherwise the world-axis box (Box3.setFromObject).
 * @returns {{ size: number[], frame: 'rest pose'|'local'|'world' }}
 */
export function measureObject(obj, { Box3, Vector3 }) {
  if (Array.isArray(obj.userData?.restSize)) return { size: obj.userData.restSize.map(Number), frame: 'rest pose' };
  if (obj.userData?.scaleFrame === 'local') return { size: localBoxSize(obj, { Box3, Vector3 }), frame: 'local' };
  const s = new Box3().setFromObject(obj).getSize(new Vector3());
  return { size: [s.x, s.y, s.z], frame: 'world' };
}

/** Box of an object's geometry in its own axes, times its world scale. */
export function localBoxSize(obj, { Box3, Vector3 }) {
  obj.updateWorldMatrix(true, true);
  const M4 = obj.matrixWorld.constructor;
  const inv = new M4().copy(obj.matrixWorld).invert();
  const m = new M4();
  const acc = new Box3(), tmp = new Box3();
  const pv = new Vector3();
  obj.traverse((c) => {
    if (!c.geometry) return;
    m.multiplyMatrices(inv, c.matrixWorld);
    const pa = c.geometry.attributes?.position;
    // Vertex-exact for ordinary meshes (a spinning wheel's box corners would overstate it).
    if (pa && pa.count <= 60000 && !c.isInstancedMesh) { for (let i = 0; i < pa.count; i++) acc.expandByPoint(pv.fromBufferAttribute(pa, i).applyMatrix4(m)); return; }
    if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
    acc.union(tmp.copy(c.geometry.boundingBox).applyMatrix4(m));
  });
  const ws = obj.getWorldScale(new Vector3());
  const sz = acc.getSize(new Vector3());
  return [Math.abs(sz.x * ws.x), Math.abs(sz.y * ws.y), Math.abs(sz.z * ws.z)];
}

/**
 * Angular scale check for sky bodies: the size seen from the camera
 * (largest side / distance) against the real one (realSize / realDistance).
 * Same rule as ui-audit's scale gate.
 */
export function angularScaleError(measuredSize, distance, realSize, realDistance, tolerance = LIMITS.scaleTolerance) {
  const seen = measuredSize / distance, real = realSize / realDistance;
  const err = Math.abs(seen - real) / real;
  return { ok: err <= tolerance, error: +err.toFixed(3) };
}
