import { test, expect, type Page } from '@playwright/test';

// ────────────────────────────────────────────────────────────
// 環境変数チェック
// ────────────────────────────────────────────────────────────

test.beforeEach(() => {
  const required = [
    'E2E_TEST_EMAIL_A',
    'E2E_TEST_PASSWORD_A',
    'E2E_TEST_EMAIL_B',
    'E2E_TEST_PASSWORD_B',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    test.skip(true, `必須環境変数が未設定: ${missing.join(', ')}`);
  }
});

// ────────────────────────────────────────────────────────────
// ヘルパー
// ────────────────────────────────────────────────────────────

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/auth/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/', { timeout: 10_000 });
}

/**
 * 同一 BrowserContext のセッション Cookie を使って /api/users/search を直接呼び出す。
 */
async function callSearchAPI(
  page: Page,
  query: string
): Promise<{ status: number; body: unknown; headers: Record<string, string | null> }> {
  const response = await page.request.get(`/api/users/search?q=${encodeURIComponent(query)}`);
  let body = null;
  try { body = await response.json(); } catch { /* ignore */ }
  return {
    status: response.status(),
    body,
    headers: {
      'x-ratelimit-limit':     response.headers()['x-ratelimit-limit'] ?? null,
      'x-ratelimit-remaining': response.headers()['x-ratelimit-remaining'] ?? null,
      'x-ratelimit-reset':     response.headers()['x-ratelimit-reset'] ?? null,
      'retry-after':           response.headers()['retry-after'] ?? null,
    },
  };
}

// ────────────────────────────────────────────────────────────
// NORMAL-RL01: 未認証ユーザーは401（レートリミット前に弾かれる）
// ────────────────────────────────────────────────────────────

test('NORMAL-RL01: 未認証ユーザーのリクエストは401を返す（レートリミット対象外）', async ({ page }) => {
  await page.goto('/');
  const response = await page.request.get('/api/users/search?q=test');
  expect(response.status()).toBe(401);
});

// ────────────────────────────────────────────────────────────
// NORMAL-RL02: 正常系（200）レスポンスにレートリミットヘッダーなし
// ────────────────────────────────────────────────────────────

test('NORMAL-RL02: 正常系（200）レスポンスに X-RateLimit-* ヘッダーは付与されない', async ({ page }) => {
  // 正常系テストはユーザー B を使い、超過系（A 使用）と分離する
  const emailB = process.env.E2E_TEST_EMAIL_B!;
  const passB  = process.env.E2E_TEST_PASSWORD_B!;

  await loginAs(page, emailB, passB);

  const result = await callSearchAPI(page, 'normal_test');
  expect(result.status).toBe(200);
  expect(result.headers['x-ratelimit-limit']).toBeNull();
  expect(result.headers['x-ratelimit-remaining']).toBeNull();
  expect(result.headers['x-ratelimit-reset']).toBeNull();
});

// ────────────────────────────────────────────────────────────
// CRITICAL-RL01: レートリミット超過時に429が返される
// ────────────────────────────────────────────────────────────

test('CRITICAL-RL01: 30回以内のリクエストは正常、31回目は429を返す', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;

  await loginAs(page, emailA, passA);

  for (let i = 1; i <= 30; i++) {
    const result = await callSearchAPI(page, `test_query_${i}`);
    expect(result.status).toBe(200);
  }

  const result31 = await callSearchAPI(page, 'test_query_31');
  expect(result31.status).toBe(429);
});

// ────────────────────────────────────────────────────────────
// CRITICAL-RL02: 429レスポンスに必要なヘッダーが含まれる
// ────────────────────────────────────────────────────────────

test('CRITICAL-RL02: 429レスポンスに X-RateLimit-* ヘッダーが含まれる', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;

  await loginAs(page, emailA, passA);

  for (let i = 1; i <= 30; i++) {
    await callSearchAPI(page, `limit_test_${i}`);
  }

  const result = await callSearchAPI(page, 'limit_test_31');
  expect(result.status).toBe(429);
  expect(result.headers['x-ratelimit-limit']).toBe('30');
  expect(result.headers['x-ratelimit-remaining']).toBe('0');
  // headers は `string | null`。null だと matcher error で失敗理由が読みにくいので
  // `expect.stringMatching` で「null は明確に拒否、形は数字列」を一度に検証する。
  expect(result.headers['x-ratelimit-reset']).toEqual(expect.stringMatching(/^\d+$/));
  expect(result.headers['retry-after']).toEqual(expect.stringMatching(/^\d+$/));
});

// ────────────────────────────────────────────────────────────
// CRITICAL-RL03: user.id 単位の分離（ユーザーAとユーザーBで独立）
// ────────────────────────────────────────────────────────────

test('CRITICAL-RL03: レートリミットはuser.id単位で分離される（複数ユーザー独立）', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const emailB = process.env.E2E_TEST_EMAIL_B!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;
  const passB  = process.env.E2E_TEST_PASSWORD_B!;

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    await loginAs(pageA, emailA, passA);
    for (let i = 1; i <= 30; i++) {
      await callSearchAPI(pageA, `userA_query_${i}`);
    }

    await loginAs(pageB, emailB, passB);
    const resultB = await callSearchAPI(pageB, 'userB_query_1');
    expect(resultB.status).toBe(200);

    const resultA = await callSearchAPI(pageA, 'userA_query_31');
    expect(resultA.status).toBe(429);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
