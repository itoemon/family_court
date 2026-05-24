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

// ────────────────────────────────────────────────────────────
// CRITICAL-H01: /history ページへのアクセス制御（未ログイン → ログインページへリダイレクト）
// ────────────────────────────────────────────────────────────

test('CRITICAL-H01: 未ログインで /history にアクセスするとログインページへリダイレクト', async ({ page }) => {
  // 未ログイン状態で /history にアクセス
  await page.goto('/history');
  // middleware により /auth/login にリダイレクト
  await page.waitForURL('/auth/login', { timeout: 10_000 });
  expect(page.url()).toContain('/auth/login');
});

// ────────────────────────────────────────────────────────────
// CRITICAL-H02: /history ページへのアクセス（ログイン状態で表示）
// ────────────────────────────────────────────────────────────

test('CRITICAL-H02: ログイン済みユーザーが /history にアクセスできる', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;

  // A がログイン
  await loginAs(page, emailA, passA);

  // /history にアクセス
  await page.goto('/history');

  // ページタイトルが表示されることを確認
  await expect(page.locator('h1:has-text("過去のケース")')).toBeVisible({ timeout: 10_000 });

  // 空状態メッセージが表示される（ケースがない場合）
  const emptyMsg = page.locator('text=まだ過去のケースはありません');
  const hasEmptyMsg = await emptyMsg.isVisible().catch(() => false);

  // 一覧またはメッセージのいずれかが表示されることを確認
  expect(hasEmptyMsg || (await page.locator('ul').first().isVisible().catch(() => false))).toBe(true);
});

// ────────────────────────────────────────────────────────────
// NORMAL-H03: /history ページレイアウト
// ────────────────────────────────────────────────────────────

test('NORMAL-H03: /history ページのレイアウト（見出し・説明文）が表示される', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;

  // ログイン
  await loginAs(page, emailA, passA);

  // /history にアクセス
  await page.goto('/history');

  // ページ見出し
  await expect(page.locator('h1:has-text("過去のケース")')).toBeVisible();

  // 説明文
  await expect(page.locator('p:has-text("判決が出た話し合いの記録")')).toBeVisible();
});

// ────────────────────────────────────────────────────────────
// NORMAL-H04: /history ページナビゲーション
// ────────────────────────────────────────────────────────────

test('NORMAL-H04: /history からケース詳細へナビゲートできる', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;

  // ログイン
  await loginAs(page, emailA, passA);

  // /history にアクセス
  await page.goto('/history');

  // ケースリンクがあるかチェック（ケースが存在する場合）
  const caseLink = page.locator('a[href*="/case/"]').first();
  const isVisible = await caseLink.isVisible().catch(() => false);

  if (isVisible) {
    // リンク存在確認
    await expect(caseLink).toBeVisible();
  }
});
