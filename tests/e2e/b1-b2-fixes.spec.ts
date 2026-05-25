import { test, expect } from '@playwright/test';

// ────────────────────────────────────────────────────────────
// B-1・B-2 修正テスト
// B-1: API レスポンスから defendantId UUID が除去されているか
// B-2: ログアウトエラー通知（flash_error Cookie・ErrorBanner）
// ────────────────────────────────────────────────────────────

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

test.beforeEach(() => {
  const required = ['E2E_TEST_EMAIL_A', 'E2E_TEST_PASSWORD_A'];
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

async function createCase(page: any, topic: string): Promise<string> {
  await page.goto('/');
  await page.fill('input[type="text"]', topic);
  await page.click('button:has-text("はじめる")');
  await page.waitForURL(/\/case\//, { timeout: 15_000 });
  return page.url().split('?')[0];
}

// ────────────────────────────────────────────────────────────
// B-1: GET /api/cases/[id] のレスポンスに defendantId が含まれない
// ────────────────────────────────────────────────────────────

test('B-1: GET /api/cases/[id] のレスポンスに defendantId フィールドが含まれない', async ({
  browser,
}) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;

  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();

  try {
    // ケースを作成
    await loginAs(pageA, emailA, passA);
    const caseUrl = await createCase(pageA, 'B-1: defendantId 除去確認テスト');
    const caseId = caseUrl.split('/').pop()!;

    // GET /api/cases/[id] を直接呼び出してレスポンスを確認
    const response = await pageA.request.get(`/api/cases/${caseId}`);
    expect(response.status()).toBe(200);

    const body = await response.json();

    // defendantId フィールドが存在しないことを確認
    expect(body).not.toHaveProperty('defendantId');

    // defendant オブジェクト（name・joinedAt）は残っていることを確認
    // （waiting フェーズのため defendant は null だが、フィールド自体は存在する）
    expect(body).toHaveProperty('defendant');

    // 他の基本フィールドが存在することを確認（回帰チェック）
    expect(body).toHaveProperty('id', caseId);
    expect(body).toHaveProperty('topic', 'B-1: defendantId 除去確認テスト');
    expect(body).toHaveProperty('phase');
    expect(body).toHaveProperty('plaintiff');
    expect(body).toHaveProperty('callerRole');
  } finally {
    await ctxA.close();
  }
});

test('B-1: ゲスト（未認証）が GET /api/cases/[id] を呼び出しても defendantId が含まれない', async ({
  browser,
}) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;

  const ctxA = await browser.newContext();
  const ctxGuest = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageGuest = await ctxGuest.newPage();

  try {
    // 原告がケースを作成
    await loginAs(pageA, emailA, passA);
    const caseUrl = await createCase(pageA, 'B-1: ゲストからの defendantId 除去確認テスト');
    const caseId = caseUrl.split('/').pop()!;

    // ゲスト（未認証）がケースページを開く
    await pageGuest.goto(caseUrl);

    // ゲストとして直接 API を呼び出す
    const response = await pageGuest.request.get(`/api/cases/${caseId}`);
    expect(response.status()).toBe(200);

    const body = await response.json();

    // ゲストからのアクセスでも defendantId が含まれないことを確認
    expect(body).not.toHaveProperty('defendantId');
  } finally {
    await ctxA.close();
    await ctxGuest.close();
  }
});

// ────────────────────────────────────────────────────────────
// B-2: ログアウトエラー通知
// ────────────────────────────────────────────────────────────

test('B-2 正常系: ログアウト成功時にエラーバナーが表示されない', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;

  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();

  try {
    // ログインしてからログアウトする
    await loginAs(pageA, emailA, passA);

    // ヘッダーのログアウトボタンをクリック
    await pageA.click('button[aria-label="ログアウト"], button:has-text("ログアウト")');
    await pageA.waitForURL('/', { timeout: 10_000 });

    // エラーバナーが表示されないことを確認
    await expect(pageA.locator('.bg-rose-50').first()).not.toBeVisible();
  } finally {
    await ctxA.close();
  }
});

test('B-2 バナー表示: flash_error Cookie を手動セットするとエラーバナーが表示される', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();

  try {
    // flash_error Cookie を手動でセットする（ログアウトエラーをシミュレート）
    await pageA.context().addCookies([
      {
        name: 'flash_error',
        value: 'logout_failed',
        url: BASE_URL,
        httpOnly: false, // テスト用に httpOnly を外して直接セット
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    // ホームページをリロードしてバナーが表示されるか確認
    await pageA.goto('/');

    // エラーバナーが表示されることを確認
    const banner = pageA.locator('.bg-rose-50').first();
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // バナーにエラーメッセージが含まれることを確認
    await expect(banner).toContainText('ログアウト処理でエラーが発生しました');
  } finally {
    await ctxA.close();
  }
});

test('B-2 × ボタン: バナーの閉じるボタンをクリックするとバナーが非表示になる', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();

  try {
    // flash_error Cookie を手動でセット
    await pageA.context().addCookies([
      {
        name: 'flash_error',
        value: 'logout_failed',
        url: BASE_URL,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    await pageA.goto('/');

    // バナーが表示されていることを確認
    const banner = pageA.locator('.bg-rose-50').first();
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // × ボタンをクリック
    await pageA.click('button[aria-label="閉じる"]');

    // バナーが非表示になることを確認
    await expect(banner).not.toBeVisible();
  } finally {
    await ctxA.close();
  }
});

test('B-2 Cookie 削除: バナー表示後にページリロードするとバナーが再表示されない', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();

  try {
    // flash_error Cookie を手動でセット
    await pageA.context().addCookies([
      {
        name: 'flash_error',
        value: 'logout_failed',
        url: BASE_URL,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    // 1 回目のページ表示（バナーが表示される）
    await pageA.goto('/');
    const banner = pageA.locator('.bg-rose-50').first();
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // ErrorBanner の useEffect で /api/clear-flash が呼ばれ Cookie が削除されるのを待つ
    // （fetch は非同期で実行されるため少し待つ）
    await pageA.waitForResponse(
      (response) => response.url().includes('/api/clear-flash'),
      { timeout: 5_000 }
    );

    // 2 回目のページリロード（Cookie が削除済みのためバナーが表示されない）
    await pageA.reload();
    await expect(pageA.locator('.bg-rose-50').first()).not.toBeVisible();
  } finally {
    await ctxA.close();
  }
});
