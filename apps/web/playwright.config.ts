import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  workers: 1,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3100',
    channel: 'msedge',
    headless: true,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'powershell -NoLogo -Command "$env:NEXT_PUBLIC_API_BASE=\'http://127.0.0.1:8001\'; $env:NEXT_DIST_DIR=\'.next-e2e\'; npm run dev -- --hostname 127.0.0.1 --port 3100"',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: true,
    timeout: 120_000,
    cwd: __dirname,
  },
  reporter: [['list']],
})
