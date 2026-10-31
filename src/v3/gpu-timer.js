/**
 * gpu-timer.js — whole-frame GPU time with EXT_disjoint_timer_query_webgl2.
 *
 * Usage (once per frame, around every render call of that frame):
 *   timer.begin(); composer.render(); timer.end(); timer.poll();
 *
 * Queries are pooled and read back asynchronously (results arrive a few frames
 * later), so the timer never stalls the pipeline. Frames during which the GPU
 * reported a disjoint event are discarded. TIME_ELAPSED queries cannot nest:
 * nothing else in the page may run one between begin() and end().
 *
 * Copied unchanged from _templates/spikes/shared/gpu-timer.js (S2, validated on
 * ANGLE/Metal, see spikes/RESULTS.md "GPU timer validation"). Used by the v3
 * engine only while the startup preset benchmark runs (v3/quality.js), so it
 * never overlaps ui-audit's own per-frame query.
 */
export class GpuTimer {
  /** @param {WebGL2RenderingContext} gl */
  constructor(gl, { maxSamples = 2000 } = {}) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.supported = !!this.ext;
    this.pool = [];
    this.pending = []; // { query, frame }
    this.active = null;
    this.samples = []; // ms, oldest first
    this.latencies = []; // frames between end() and result availability
    this.maxSamples = maxSamples;
    this.frame = 0;
    this.discarded = 0;
  }

  begin() {
    if (!this.supported || this.active) return;
    const gl = this.gl;
    const query = this.pool.pop() || gl.createQuery();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push({ query: this.active, frame: this.frame });
    this.active = null;
  }

  /** Read back finished queries; call once per frame after end(). */
  poll() {
    this.frame++;
    if (!this.supported) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const { query, frame } = this.pending[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      const ns = gl.getQueryParameter(query, gl.QUERY_RESULT);
      if (disjoint) this.discarded++;
      else {
        this.samples.push(ns / 1e6);
        this.latencies.push(this.frame - frame);
        if (this.samples.length > this.maxSamples) this.samples.shift();
        if (this.latencies.length > this.maxSamples) this.latencies.shift();
      }
      this.pool.push(query);
    }
  }

  reset() {
    this.samples.length = 0;
    this.latencies.length = 0;
    this.discarded = 0;
  }

  /** Latest smoothed value (mean of the last n samples), for live HUDs and auto-pick. */
  recentMean(n = 30) {
    const s = this.samples.slice(-n);
    return s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN;
  }
}

export function percentile(values, p) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}
