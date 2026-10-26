/**
 * Traverse cost model — PURE (no THREE/DOM) so the route costing, budget
 * accounting and traverse quality scoring are unit-testable.
 * All rules come from content/stations.json resourceModel; the app passes them in.
 * SIMPLIFIED EVA model — the app labels it as simplified wherever it appears.
 * @module systems/traverse-model
 */

/**
 * Cost of driving one segment.
 * @param {number} distanceM straight-line distance (the map route is segment-wise)
 * @param {number} worstSlope worst grade (rise/run) along the segment, from the DTM
 * @param {{evaMinutesBudget:number,consumablesStart:number,consumablesPerHour:number,roverSpeedKmh:number,slopeCostFactor:{freeBelowSlope:number,perSlopeMultiplier:number,maxMultiplier:number},stationMinutes:Record<string,number>,maxStations:number}} model
 * @returns {{minutes:number, slopeMultiplier:number, km:number}}
 */
export function segmentCost(distanceM, worstSlope, model) {
  const f = model.slopeCostFactor;
  const mult = Math.min(f.maxMultiplier, 1 + f.perSlopeMultiplier * Math.max(0, (worstSlope || 0) - f.freeBelowSlope));
  const km = distanceM / 1000;
  const minutes = (km / model.roverSpeedKmh) * 60 * mult;
  return { minutes, slopeMultiplier: mult, km };
}

/**
 * Plan accounting: given an ordered route of {id, toolId} stations (first is the
 * LM start), compute time and consumables from station-to-station slope-aware
 * costs. `segments` supplies {fromId,toId,distanceM,worstSlope}.
 * @returns {{totalMinutes:number, consumablesLeft:number, withinBudget:boolean, segments:Array, stationMinutes:number, driveMinutes:number}}
 */
export function planAccounting(route, segments, model) {
  const byPair = new Map(segments.map(s => [`${s.fromId}>${s.toId}`, s]));
  let driveMinutes = 0, stationMinutes = 0;
  const detail = [];
  for (let i = 1; i < route.length; i++) {
    const prev = route[i - 1], cur = route[i];
    const seg = byPair.get(`${prev.id}>${cur.id}`);
    if (!seg) return { error: `missing segment ${prev.id}>${cur.id}` };
    const c = segmentCost(seg.distanceM, seg.worstSlope, model);
    driveMinutes += c.minutes;
    const dwell = model.stationMinutes[cur.toolId] ?? 0;
    stationMinutes += dwell;
    detail.push({ fromId: prev.id, toId: cur.id, km: c.km, slopeMultiplier: c.slopeMultiplier, driveMinutes: c.minutes, dwellMinutes: dwell });
  }
  const totalMinutes = driveMinutes + stationMinutes;
  const consumablesLeft = Math.max(0, model.consumablesStart - (totalMinutes / 60) * model.consumablesPerHour);
  return {
    totalMinutes,
    driveMinutes,
    stationMinutes,
    consumablesLeft: Math.round(consumablesLeft * 10) / 10,
    withinBudget: totalMinutes <= model.evaMinutesBudget,
    segments: detail,
  };
}

/**
 * Traverse quality scored against criteria (used in the debrief; informational —
 * this IS structured scoring of choices, not of free text).
 * @param {{hypothesis:string, route:Array<{id,toolId}>, accounting:{withinBudget:boolean, totalMinutes:number}, evidenceTags:string[]}} plan
 * @param {{neededEvidence:string[], maxStations:number}} hypothesisDef
 * @returns {{criteria:Array<{id:string,met:boolean,detail:string}>, metCount:number}}
 */
export function scoreTraverse(plan, hypothesisDef) {
  const criteria = [];
  const needed = hypothesisDef.neededEvidence;
  const missing = needed.filter(t => !plan.evidenceTags.includes(t));
  criteria.push({
    id: 'evidence-coverage',
    met: missing.length === 0,
    detail: missing.length === 0
      ? 'All required evidence types for your question were collected.'
      : `Missing evidence types: ${missing.join(', ')}.`,
  });
  criteria.push({
    id: 'budget',
    met: plan.accounting.withinBudget,
    detail: plan.accounting.withinBudget
      ? `The plan fits the EVA budget (${Math.round(plan.accounting.totalMinutes)} of ${200} min).`
      : `The plan exceeds the EVA budget (${Math.round(plan.accounting.totalMinutes)} min) — the EVA would end early with partial data.`,
  });
  criteria.push({
    id: 'station-count',
    met: plan.route.length - 1 <= hypothesisDef.maxStations && plan.route.length >= 2,
    detail: `${plan.route.length - 1} station(s) planned (limit ${hypothesisDef.maxStations}).`,
  });
  const toolVariety = new Set(plan.route.slice(1).map(r => r.toolId)).size;
  criteria.push({
    id: 'method-variety',
    met: toolVariety >= 2,
    detail: toolVariety >= 2
      ? 'Multiple methods used (photography, profiles, sampling).'
      : 'Only one method used — a second method would strengthen the case.',
  });
  return { criteria, metCount: criteria.filter(c => c.met).length };
}

/**
 * All-pairs segment table between stations (used by the planner UI and by
 * planAccounting). Requires a slope sampler fn(x0,y0,x1,y1) -> {average, worst}.
 * @param {Array<{id:string,xM:number,yM:number}>} points
 * @param {Function} slopeSampler
 */
export function buildSegmentTable(points, slopeSampler) {
  const segments = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const a = points[i], b = points[j];
      const d = Math.hypot(b.xM - a.xM, b.yM - a.yM);
      const s = slopeSampler(a.xM, a.yM, b.xM, b.yM);
      segments.push({ fromId: a.id, toId: b.id, distanceM: d, worstSlope: s ? s.worst : 0, sampleable: Boolean(s && !Number.isNaN(s.worst)) });
    }
  }
  return segments;
}
