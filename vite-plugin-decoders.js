/**
 * Vite plugin: self-hosted decoders without vendoring files into the repo.
 *
 * The build contract (08 5.1) requires Draco/Basis/KTX2 decoders to be served
 * from the site's own origin — but the Emscripten JS glue trips static security
 * scanners when vendored into a repository, and the files are regenerable from
 * the pinned `three` package anyway. This plugin therefore:
 *  - in dev: serves /decoders/* straight from node_modules/three (in-memory),
 *  - on build: copies them into dist/decoders/ so every release build ships them.
 *
 * Runtime behavior is identical to vendored files: GLTFLoader/KTX2Loader/DRACOLoader
 * fetch `${BASE_URL}decoders/...` and the files are same-origin in the built site.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

function threePackageRoot() {
  const require = createRequire(import.meta.url);
  let p = dirname(require.resolve('three')); // returns a filesystem path
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(p, 'package.json')) && JSON.parse(readFileSync(join(p, 'package.json'), 'utf8')).name === 'three') return p;
    p = dirname(p);
  }
  throw new Error('could not locate the three package root');
}

export function selfHostedDecoders() {
  const libsDir = join(threePackageRoot(), 'examples', 'jsm', 'libs');
  const files = {
    'decoders/draco/draco_decoder.js': join(libsDir, 'draco/draco_decoder.js'),
    'decoders/draco/draco_decoder.wasm': join(libsDir, 'draco/draco_decoder.wasm'),
    'decoders/draco/draco_wasm_wrapper.js': join(libsDir, 'draco/draco_wasm_wrapper.js'),
    'decoders/basis/basis_transcoder.js': join(libsDir, 'basis/basis_transcoder.js'),
    'decoders/basis/basis_transcoder.wasm': join(libsDir, 'basis/basis_transcoder.wasm'),
  };

  return {
    name: 'self-hosted-decoders',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\//, '');
        const src = files[path];
        if (!src) return next();
        if (!existsSync(src)) { res.statusCode = 404; return res.end('decoder missing'); }
        res.setHeader('content-type', path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(readFileSync(src));
      });
    },
    closeBundle() {
      const outDir = this.environment?.config?.build?.outDir || 'dist';
      for (const [rel, src] of Object.entries(files)) {
        if (!existsSync(src)) { console.warn(`[self-hosted-decoders] missing: ${src}`); continue; }
        const dest = join(outDir, rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
      }
    },
  };
}
