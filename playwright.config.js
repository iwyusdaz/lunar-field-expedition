import { defineConfig } from '@playwright/test';
// Browser tests run against a VITE_TEST_HOOKS=1 build (window.__TEST__) served by
// vite preview on this repo's own port (DECISIONS #14). tests/sub-path.spec.js
// tests the release build in dist/ (npm run test:subpath builds it first).
// Headless Chromium uses software WebGL: functional checks only; the GPU
// gates run headed with _tools/ui-audit.mjs.
const PORT = 4175;
export default defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.js',
  timeout: 300_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `VITE_TEST_HOOKS=1 npx vite build --outDir tmp/e2e-dist --emptyOutDir && npx vite preview --outDir tmp/e2e-dist --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    // Never reuse: another repo's preview server on a shared port would be tested by mistake.
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  outputDir: 'tmp/test-results',
});
