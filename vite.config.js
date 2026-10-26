import { defineConfig } from 'vite';
import { selfHostedDecoders } from './vite-plugin-decoders.js';

// base './' so the build works at any sub-path (build contract, 08 section 5.1).
export default defineConfig({
  base: './',
  plugins: [selfHostedDecoders()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    assetsInlineLimit: 4096,
  },
  server: { port: 5173 },
  define: {
    // Test hooks exposed only when building with VITE_TEST_HOOKS=1 (release builds omit them).
    '__TEST_HOOKS__': JSON.stringify(process.env.VITE_TEST_HOOKS === '1'),
  },
});
