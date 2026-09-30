import path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * E2E runs against a DEDICATED production server on :8795 with its own data
 * directory (Phase 1 auth): the suite is authenticated via a storage state
 * produced by the global setup, and the real Hermes gateway is used for chat.
 * Yuri's dev instance (:5173/:8789) is never touched by the test suite.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:8795',
    trace: 'retain-on-failure',
    storageState: './e2e/.auth/storage-state.json',
  },
  webServer: {
    command: 'node --env-file=apps/server/.env apps/server/dist/main.js',
    url: 'http://127.0.0.1:8795/healthz',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: '8795',
      HOST: '127.0.0.1',
      HERMES_WEBUI_DATA_DIR: '/tmp/hwui-e2e-data',
      // The suite claims its own local owner account (global-setup), so it
      // never needs the real Hermes dashboard password.
      HERMES_WEBUI_AUTH_MODE: 'local',
      WEB_DIST_DIR: path.resolve('apps/web/dist'),
      LOG_LEVEL: 'warn',
    },
  },
});
