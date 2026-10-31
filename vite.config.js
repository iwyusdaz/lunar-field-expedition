import { defineConfig } from 'vite';
import { selfHostedDecoders } from './vite-plugin-decoders.js';
// base './' so the build works at any sub-path (build contract, 08 section 5.1).
// v3 loads KTX2 textures and meshopt GLBs: the Basis transcoder is served from
// the site's own origin by the decoder plugin (DECISIONS #26, supersedes #13);
// the meshopt decoder is bundled from the pinned three package.
export default defineConfig({
  base: './',
  plugins: [selfHostedDecoders()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    assetsInlineLimit: 4096,
  },
  server: { port: 5173 },
  // Own port: other immersive repos' preview servers share this machine.
  preview: { port: 4175, strictPort: true, host: '127.0.0.1' },
  define: {
    // Test hooks exposed only when building with VITE_TEST_HOOKS=1 (release builds omit them).
    '__TEST_HOOKS__': JSON.stringify(process.env.VITE_TEST_HOOKS === '1'),
  },
});
