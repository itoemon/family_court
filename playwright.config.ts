import { defineConfig, devices } from '@playwright/test';
import { loadEnvConfig } from '@next/env';

// E2E 実行時はテスト用 Supabase / テスト用ユーザーを使う。
// NODE_ENV=test を明示することで Next の env ローダが
// `.env.test` / `.env.test.local` / `.env` を読み込み、`.env.local` をスキップする。
// セットアップは docs/operations/e2e-test-db.md を参照。
// `process.env.NODE_ENV` は @types/node で readonly 扱いだが、実行時は書き換え可能。
// loadEnvConfig は NODE_ENV を見て読み込むファイルを決めるので、ここで明示する。
Object.assign(process.env, { NODE_ENV: 'test' });
loadEnvConfig(process.cwd());

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT ?? 'test-results/test_result.json' }],
  ],
});
