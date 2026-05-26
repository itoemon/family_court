import { test, expect } from '@playwright/test';

// ────────────────────────────────────────────────────────────
// 環境変数チェック
// ────────────────────────────────────────────────────────────

test.beforeEach(() => {
  const required = [
    'E2E_TEST_EMAIL_A',
    'E2E_TEST_PASSWORD_A',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    test.skip(true, `必須環境変数が未設定: ${missing.join(', ')}`);
  }
});

// ────────────────────────────────────────────────────────────
// ヘルパー
// ────────────────────────────────────────────────────────────

async function loginAs(page: any, email: string, password: string) {
  await page.goto('/auth/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/', { timeout: 10_000 });
}

/**
 * REST API 経由で /api/users/search を呼び出す。
 * Playwright のコンテキストから Cookie を取得して Authorization ヘッダー化する。
 */
async function callSearchAPI(
  page: any,
  query: string
): Promise<{ status: number; body: any; headers: any }> {
  // まず一度ページをロードして、セッション Cookie が設定されることを確認
  await page.goto('/');

  // ページ内で fetch を実行してレスポンスを取得
  const response = await page.evaluate(
    async (q) => {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
      const body = await res.json().catch(() => null);
      return {
        status: res.status,
        body,
        headers: {
          'x-ratelimit-limit': res.headers.get('x-ratelimit-limit'),
          'x-ratelimit-remaining': res.headers.get('x-ratelimit-remaining'),
          'x-ratelimit-reset': res.headers.get('x-ratelimit-reset'),
          'retry-after': res.headers.get('retry-after'),
        },
      };
    },
    query
  );
  return response;
}

// ────────────────────────────────────────────────────────────
// CRITICAL-RL01: レートリミット超過時に429が返される
// ────────────────────────────────────────────────────────────

test('CRITICAL-RL01: 30回以内のリクエストは正常、31回目は429を返す', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;

  await loginAs(page, emailA, passA);

  // 30 回まではすべて成功（200）
  for (let i = 1; i <= 30; i++) {
    const result = await callSearchAPI(page, `test_query_${i}`);
    expect(result.status).toBe(200, `Request #${i} should return 200`);
  }

  // 31 回目は 429
  const result31 = await callSearchAPI(page, 'test_query_31');
  expect(result31.status).toBe(429, 'Request #31 should return 429 (Too Many Requests)');
});

// ────────────────────────────────────────────────────────────
// CRITICAL-RL02: 429レスポンスに必要なヘッダーが含まれる
// ────────────────────────────────────────────────────────────

test('CRITICAL-RL02: 429レスポンスに X-RateLimit-* ヘッダーが含まれる', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;

  await loginAs(page, emailA, passA);

  // まず 30 回実行して制限に到達
  for (let i = 1; i <= 30; i++) {
    await callSearchAPI(page, `limit_test_${i}`);
  }

  // 31 回目で 429 を取得してヘッダー検証
  const result = await callSearchAPI(page, 'limit_test_31');
  expect(result.status).toBe(429);
  expect(result.headers['x-ratelimit-limit']).toBe('30');
  expect(result.headers['x-ratelimit-remaining']).toBe('0');
  // reset は Unix epoch seconds (整数)
  expect(result.headers['x-ratelimit-reset']).toBeTruthy();
  expect(/^\d+$/.test(result.headers['x-ratelimit-reset'])).toBe(true);
  // retry-after は秒数（0 以上の整数）
  expect(result.headers['retry-after']).toBeTruthy();
  expect(/^\d+$/.test(result.headers['retry-after'])).toBe(true);
});

// ────────────────────────────────────────────────────────────
// CRITICAL-RL03: user.id 単位の分離（ユーザーAとユーザーBで独立）
// ────────────────────────────────────────────────────────────

test('CRITICAL-RL03: レートリミットはuser.id単位で分離される（複数ユーザー独立）', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const emailB = process.env.E2E_TEST_EMAIL_B!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;
  const passB = process.env.E2E_TEST_PASSWORD_B!;

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // ユーザーA がログイン・30回リクエスト（制限に到達）
    await loginAs(pageA, emailA, passA);
    for (let i = 1; i <= 30; i++) {
      await callSearchAPI(pageA, `userA_query_${i}`);
    }

    // ユーザーB がログイン・1回リクエスト（ユーザー別なので成功すべき）
    await loginAs(pageB, emailB, passB);
    const resultB = await callSearchAPI(pageB, 'userB_query_1');
    expect(resultB.status).toBe(200, 'User B should not be blocked by User A\'s requests');

    // ユーザーA の 31回目は 429
    const resultA = await callSearchAPI(pageA, 'userA_query_31');
    expect(resultA.status).toBe(429, 'User A should be blocked');
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ────────────────────────────────────────────────────────────
// NORMAL-RL01: 未認証ユーザーは401（レートリミット前に弾かれる）
// ────────────────────────────────────────────────────────────

test('NORMAL-RL01: 未認証ユーザーのリクエストは401を返す（レートリミット対象外）', async ({ page }) => {
  // ログインしない状態で /api/users/search を呼び出し
  await page.goto('/');
  const response = await page.evaluate(async () => {
    const res = await fetch('/api/users/search?q=test');
    return {
      status: res.status,
      body: await res.json().catch(() => null),
    };
  });

  expect(response.status).toBe(401);
});

// ────────────────────────────────────────────────────────────
// NORMAL-RL02: 正常系レスポンスには429以外のヘッダーは付与されない
// ────────────────────────────────────────────────────────────

test('NORMAL-RL02: 正常系（200）レスポンスに X-RateLimit-* ヘッダーは付与されない', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;

  await loginAs(page, emailA, passA);

  // 最初の1リクエスト（成功）
  const result = await callSearchAPI(page, 'normal_test');
  expect(result.status).toBe(200);
  // 成功時はレートリミットヘッダーなし
  expect(result.headers['x-ratelimit-limit']).toBeNull();
  expect(result.headers['x-ratelimit-remaining']).toBeNull();
  expect(result.headers['x-ratelimit-reset']).toBeNull();
});
