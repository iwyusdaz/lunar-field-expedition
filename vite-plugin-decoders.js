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
 *
 * CSP (template-changes T-24, found at the lunar G1 preview): three's
 * basis_transcoder.js is Emscripten embind glue that builds each binding's
 * invoker with `new Function(...)`. The showcase CSP (`script-src 'self'
 * 'wasm-unsafe-eval'`, no 'unsafe-eval') blocks that, so every KTX2 texture
 * (and every GLB that embeds one) failed to load on the live site. The plugin
 * serves the glue with craftInvokerFunction and __emval_get_method_caller
 * replaced by equivalent closures (embind's own DYNAMIC_EXECUTION=0 form): same arguments, wire types,
 * destructors and return value, no string evaluation. The build fails if the
 * pattern is not found (a three upgrade must re-check the patch).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const INVOKER_START = 'function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc,isAsync){';
const INVOKER_END = 'return createNamedFunction(humanName,invokerFn)}';
const INVOKER_NO_EVAL = `${INVOKER_START}var argCount=argTypes.length;if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!")}`
  + 'var isClassMethodFunc=argTypes[1]!==null&&classType!==null;var needsDestructorStack=usesDestructorStack(argTypes);var returns=argTypes[0].name!=="void";var expected=argCount-2;'
  + 'var invokerFn=function(...a){if(a.length!==expected){throwBindingError("function "+humanName+" called with "+a.length+" arguments, expected "+expected)}'
  + 'var destructors=needsDestructorStack?[]:null;var wired=[];var thisWired;if(isClassMethodFunc){thisWired=argTypes[1]["toWireType"](destructors,this)}'
  + 'for(var i=0;i<expected;++i){wired.push(argTypes[i+2]["toWireType"](destructors,a[i]))}'
  + 'var rv=isClassMethodFunc?cppInvokerFunc(cppTargetFunc,thisWired,...wired):cppInvokerFunc(cppTargetFunc,...wired);'
  + 'if(needsDestructorStack){runDestructors(destructors)}else{for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){if(argTypes[i].destructorFunction!==null){argTypes[i].destructorFunction(i===1?thisWired:wired[i-2])}}}'
  + `if(returns){return argTypes[0]["fromWireType"](rv)}};${INVOKER_END}`;

const CALLER_START = 'var __emval_get_method_caller=(argCount,argTypes,kind)=>{';
const CALLER_END = 'var invokerFunction=newFunc(Function,params)(...args);';
const CALLER_NO_EVAL = `${CALLER_START}var types=emval_lookupTypes(argCount,argTypes);var retType=types.shift();argCount--;`
  + 'var offsets=[];var offset=0;for(var i=0;i<argCount;++i){offsets.push(offset);offset+=types[i]["argPackAdvance"]}'
  + 'var invokerFunction=function(obj,func,destructorsRef,args){var vals=[];for(var i=0;i<argCount;++i){vals.push(types[i].readValueFromPointer(args+offsets[i]))}'
  + 'var callArgs=kind===0?[obj,...vals]:vals;var rv=kind===1?new func(...callArgs):func.call(...callArgs);'
  + 'if(!retType.isVoid){return emval_returnValue(retType,destructorsRef,rv)}};';

function swap(src, start, end, replacement, what) {
  const i = src.indexOf(start);
  const j = i < 0 ? -1 : src.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error(`[self-hosted-decoders] basis_transcoder.js: ${what} not found; re-check the CSP patch for this three version`);
  return src.slice(0, i) + replacement + src.slice(j + end.length);
}

/** basis_transcoder.js without string evaluation in embind's invokers (see the header). */
export function patchBasisGlue(src) {
  let out = swap(src, INVOKER_START, INVOKER_END, INVOKER_NO_EVAL, 'craftInvokerFunction');
  out = swap(out, CALLER_START, CALLER_END, CALLER_NO_EVAL, '__emval_get_method_caller');
  if (/newFunc\(Function/.test(out)) throw new Error('[self-hosted-decoders] basis_transcoder.js still builds functions from strings');
  return out;
}
const PATCH = { 'decoders/basis/basis_transcoder.js': patchBasisGlue };
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
        res.end(PATCH[path] ? PATCH[path](readFileSync(src, 'utf8')) : readFileSync(src));
      });
    },
    closeBundle() {
      const outDir = this.environment?.config?.build?.outDir || 'dist';
      for (const [rel, src] of Object.entries(files)) {
        if (!existsSync(src)) { console.warn(`[self-hosted-decoders] missing: ${src}`); continue; }
        const dest = join(outDir, rel);
        mkdirSync(dirname(dest), { recursive: true });
        if (PATCH[rel]) writeFileSync(dest, PATCH[rel](readFileSync(src, 'utf8')));
        else copyFileSync(src, dest);
      }
    },
  };
}
