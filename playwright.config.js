import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --port 4175 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4175',
    // Never reuse: another repo's preview server on a shared port would be tested by mistake.
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  outputDir: 'tmp/test-results',
});
