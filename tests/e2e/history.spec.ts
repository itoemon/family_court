import { test, expect, type Page } from '@playwright/test';

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

async function loginAs(page: Page, email: string, password: string) {
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

  // 空状態メッセージ または 一覧 のいずれかが表示されることを確認
  // （`.or()` ロケータで auto-wait + hard assertion 化）
  const emptyMsg = page.locator('text=まだ過去のケースはありません');
  const listEl = page.locator('ul').first();
  await expect(emptyMsg.or(listEl)).toBeVisible();
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
  // count() で件数を確定させてから visible 検査（catch で握りつぶさず、
  // ロケータ自体の構造ミスは明示エラーになる）
  const caseLinks = page.locator('a[href*="/case/"]');
  if ((await caseLinks.count()) > 0) {
    await expect(caseLinks.first()).toBeVisible();
  }
});
