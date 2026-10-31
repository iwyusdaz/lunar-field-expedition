/**
 * layout-math.js — pure screen-space helpers for the v3 shell (no DOM, no three):
 * label declutter (plan 10 §2.2), info-card placement beside an object (§4.2),
 * framing distance for inspected objects (§4.3), and rectangle maths.
 * Kept pure so the unit tests can pin the behaviour down.
 * @module v3/layout-math
 */

/** @typedef {{ left: number, top: number, right: number, bottom: number }} Rect */

export const rect = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });
export const area = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
export function overlap(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}
const inflate = (r, m) => ({ left: r.left - m, top: r.top - m, right: r.right + m, bottom: r.bottom + m });

/**
 * Declutter in-world labels: screen-space collision avoidance so labels never
 * stack. Forced labels (hovered, focused, selected) always show; the others are
 * placed by priority and hidden ("crowded") when no free spot is left.
 *
 * @param {Array<{ id: string, x: number, y: number, w: number, h: number, priority?: number, forced?: boolean }>} items
 *   x, y = anchor in px (top centre of the object on screen); w, h = label size
 * @param {object} [opts]
 * @param {Rect} [opts.bounds]      area labels may use (viewport minus top bar)
 * @param {Rect[]} [opts.reserved]  UI rectangles labels must avoid (Now card, cluster, info card)
 * @param {number} [opts.gap=6]
 * @returns {Map<string, { x: number, y: number, visible: boolean, crowded: boolean }>}  x, y = label top-left
 */
export function declutter(items, { bounds = rect(0, 0, 1e5, 1e5), reserved = [], gap = 6 } = {}) {
  const order = [...items].sort((a, b) => (Number(!!b.forced) - Number(!!a.forced)) || ((b.priority ?? 0) - (a.priority ?? 0)));
  const placed = [];
  const out = new Map();
  for (const it of order) {
    const candidates = [0, 1, 2].map((k) => ({ x: it.x - it.w / 2, y: it.y - it.h - gap - k * (it.h + 4) }));
    candidates.push({ x: it.x - it.w / 2, y: it.y + gap });
    let chosen = null;
    for (const c of candidates) {
      const x = Math.min(Math.max(c.x, bounds.left + 4), bounds.right - it.w - 4);
      const y = Math.min(Math.max(c.y, bounds.top + 4), bounds.bottom - it.h - 4);
      const r = rect(x, y, it.w, it.h);
      const hit = placed.some((p) => overlap(inflate(p, 2), r) > 0) || reserved.some((p) => overlap(p, r) > 0);
      if (!hit) { chosen = { x, y, r }; break; }
    }
    if (!chosen && it.forced) {
      const c = candidates[0];
      const x = Math.min(Math.max(c.x, bounds.left + 4), bounds.right - it.w - 4);
      const y = Math.min(Math.max(c.y, bounds.top + 4), bounds.bottom - it.h - 4);
      chosen = { x, y, r: rect(x, y, it.w, it.h) };
    }
    if (chosen) {
      placed.push(chosen.r);
      out.set(it.id, { x: chosen.x, y: chosen.y, visible: true, crowded: false });
    } else {
      out.set(it.id, { x: it.x - it.w / 2, y: it.y - it.h - gap, visible: false, crowded: true });
    }
  }
  return out;
}

/**
 * Place the info card beside the object, never over it (plan 10 §4.2).
 * Tries right, left, below, above; each candidate is clamped into `bounds`
 * and scored by how much it would cover the object (heavily penalised) and the
 * reserved UI rectangles. Returns the best top-left corner.
 * @param {Rect} obj           object's on-screen box
 * @param {{ w: number, h: number }} card
 * @param {Rect} bounds        usable area (viewport minus top bar, with margins)
 * @param {Rect[]} [reserved]  Now card, camera cluster, ...
 * @returns {{ x: number, y: number, side: string, coversObject: number }}
 */
export function placeCard(obj, card, bounds, reserved = [], gap = 16) {
  const cy = (obj.top + obj.bottom) / 2 - card.h / 2;
  const cx = (obj.left + obj.right) / 2 - card.w / 2;
  const cands = [
    { side: 'right', x: obj.right + gap, y: cy },
    { side: 'left', x: obj.left - gap - card.w, y: cy },
    { side: 'below', x: cx, y: obj.bottom + gap },
    { side: 'above', x: cx, y: obj.top - gap - card.h },
  ];
  let best = null;
  cands.forEach((c, i) => {
    const x = Math.min(Math.max(c.x, bounds.left), bounds.right - card.w);
    const y = Math.min(Math.max(c.y, bounds.top), bounds.bottom - card.h);
    const r = rect(x, y, card.w, card.h);
    const cover = overlap(r, obj);
    const score = cover * 20 + reserved.reduce((s, q) => s + overlap(r, q), 0) + i; // i: prefer the earlier side on ties
    if (!best || score < best.score) best = { x, y, side: c.side, score, coversObject: area(obj) ? cover / area(obj) : 0 };
  });
  return { x: Math.round(best.x), y: Math.round(best.y), side: best.side, coversObject: +best.coversObject.toFixed(3) };
}

/**
 * Camera distance that makes an object fill `heightFrac` of the viewport height
 * (plan 10 §4.3: at least 35% when framed after a click), without letting its
 * width exceed `maxWidthFrac` of the viewport width (room for the info card).
 * @param {{ x: number, y: number, z: number }} size  bounding-box size, metres
 * @param {number} fovDeg  vertical field of view
 * @param {number} aspect  width / height
 */
export function frameDistance(size, fovDeg, aspect, { heightFrac = 0.45, maxWidthFrac = 0.5, minDistance = 0.3 } = {}) {
  const tv = Math.tan((fovDeg * Math.PI) / 360);
  const th = tv * aspect;
  const h = Math.max(size.y, 1e-3);
  const w = Math.max(size.x, size.z, 1e-3);
  const depth = Math.min(size.x, size.z);
  const dH = h / (2 * tv * heightFrac);
  const dW = w / (2 * th * maxWidthFrac);
  return Math.max(dH, dW, minDistance) + depth / 2;
}

/** Fraction of the viewport height an object of height h covers at distance d. */
export function heightFraction(h, d, fovDeg) {
  return h / (2 * d * Math.tan((fovDeg * Math.PI) / 360));
}
