import { test, expect, type Page } from '@playwright/test';

/**
 * BUG-007: ログイン成功後にページ遷移しない問題の修正
 * 2026-06-15 実装テスト
 *
 * 修正内容：
 * 1. router.refresh() 削除（push 効果を打ち消していた）
 * 2. useSearchParams() 導入により ?next= パラメータに対応
 * 3. エラー処理を early return に整理
 */

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

// ===== ヘルパー関数 =====

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/auth/login');
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

// ===== テストケース =====

// BUG-007-1: 通常ログイン（遷移先指定なし）→ / に遷移
test('BUG-007-1: ログイン成功時にページが / に遷移すること（router.refresh削除確認）', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;

  await loginAs(page, emailA, passA);

  // ページ遷移が発生し、URL が /auth/login から / に変わったことを確認
  await page.waitForURL('/', { timeout: 15_000 });

  // URL が確実に / であることを確認（クエリパラメータがあっても OK）
  const url = page.url();
  expect(url).toMatch(/^http:\/\/localhost:3000\/(\?.*)?$/);
});

// BUG-007-2: ?next= パラメータ付きログイン → 指定パスに遷移
test('BUG-007-2: ?next=/history 付きログイン時に /history に遷移すること（useSearchParams対応確認）', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;

  // ?next=/history を付けてログインページを開く
  await page.goto('/auth/login?next=/history');
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });

  // ログイン
  await page.fill('input[type="email"]', emailA);
  await page.fill('input[type="password"]', passA);
  await page.click('button[type="submit"]');

  // /history に遷移することを確認
  await page.waitForURL(/\/history/, { timeout: 15_000 });
  const url = page.url();
  expect(url).toMatch(/\/history/);
});

// BUG-007-4: open redirect 防御（負例）
// `?next=` に外部ドメインや protocol-relative URL が渡されても外部に遷移せず "/" にフォールバックすること
test('BUG-007-4: 不正な next 値は外部に遷移せず / にフォールバックすること（open redirect 防御）', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;

  // protocol-relative URL: //example.com は外部 origin に飛ぼうとするが、ガードで弾く
  await page.goto('/auth/login?next=//example.com/evil');
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
  await page.fill('input[type="email"]', emailA);
  await page.fill('input[type="password"]', passA);
  await page.click('button[type="submit"]');

  // ログイン後に同一 origin (localhost) に留まり、example.com に飛んでいないこと
  await page.waitForURL('/', { timeout: 15_000 });
  const url = page.url();
  expect(url).toMatch(/^http:\/\/localhost:3000\//);
  expect(url).not.toMatch(/example\.com/);
});

// BUG-007-3: 誤ったパスワード → エラーメッセージ表示＆ URL 変わらず（リグレッション確認）
test('BUG-007-3: パスワード誤り時にエラーメッセージが表示され、ページに留まること', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const wrongPassword = 'WrongPassword123!';

  await loginAs(page, emailA, wrongPassword);

  // エラーメッセージが表示されることを確認
  await page.waitForSelector('text=メールアドレスまたはパスワードが違います', { timeout: 10_000 });

  // URL は /auth/login のままであること（リダイレクトされていない）
  const url = page.url();
  expect(url).toMatch(/\/auth\/login/);

  // エラーメッセージが見えることを確認
  const errorMsg = page.locator('text=メールアドレスまたはパスワードが違います');
  await expect(errorMsg).toBeVisible();
});
