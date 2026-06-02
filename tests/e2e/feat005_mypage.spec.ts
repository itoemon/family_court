import { test, expect, type Page } from '@playwright/test';

// ────────────────────────────────────────────────────────────
// 環境変数チェック
// ────────────────────────────────────────────────────────────

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

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/auth/login');
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/', { timeout: 15_000 });
}

// ────────────────────────────────────────────────────────────
// CRITICAL-FEAT005-01: /me ページが認証後に表示される
// ────────────────────────────────────────────────────────────

test('CRITICAL-FEAT005-01: マイページが正常に表示される', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;

  await loginAs(page, emailA, passA);
  await page.goto('/me');

  // ページが正常に読み込まれたことを確認（セクションカードが表示される）
  // MeHeader（アイデンティティ行）が表示される（アバター画像または SVG シルエット）
  await expect(page.locator('svg, img').first()).toBeVisible({ timeout: 5_000 });

  // セクションカード（見出しで確認）
  await expect(page.locator('h2:has-text("プロフィール")')).toBeVisible();
  await expect(page.locator('h2:has-text("フレンド")')).toBeVisible();
  await expect(page.locator('h2:has-text("過去のケース")')).toBeVisible();
  await expect(page.locator('h2:has-text("参加中の法律")')).toBeVisible();

  // セクション内に「編集する」または「見る」リンクが表示される
  const editLinks = await page.locator('section a[href]').count();
  expect(editLinks).toBeGreaterThanOrEqual(1);
});

// ────────────────────────────────────────────────────────────
// CRITICAL-FEAT005-02: 未認証時 /me でリダイレクト
// ────────────────────────────────────────────────────────────

test('CRITICAL-FEAT005-02: 未認証ユーザーは /me から /auth/login にリダイレクト', async ({ page }) => {
  await page.goto('/me');
  await page.waitForURL('/auth/login', { timeout: 10_000 });
  expect(page.url()).toContain('/auth/login');
});

// ────────────────────────────────────────────────────────────
// CRITICAL-FEAT005-03: ヘッダードロップダウンに「マイページ」が追加
// ────────────────────────────────────────────────────────────

test('CRITICAL-FEAT005-03: ヘッダーのドロップダウンに「マイページ」が表示される', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;

  await loginAs(page, emailA, passA);

  // ホームページで確認
  await page.goto('/');

  // アバターボタンをクリック（ドロップダウンを開く）
  // aria-label が "アカウントメニューを開く" のボタンをクリック
  await page.click('button[aria-label="アカウントメニューを開く"]');

  // ドロップダウンが展開されるまで待機
  await page.waitForSelector('[role="menu"]', { timeout: 5_000 });

  // 「マイページ」が表示されることを確認（Link要素として）
  await expect(page.locator('a[href="/me"]:has-text("マイページ")')).toBeVisible();

  // 「マイページ」をクリック
  await page.click('a[href="/me"]');

  // /me に遷移
  await page.waitForURL('/me', { timeout: 10_000 });
  expect(page.url()).toContain('/me');
});

// ────────────────────────────────────────────────────────────
// NORMAL-FEAT005-01: マイページの「もっと見る」リンク動作
// ────────────────────────────────────────────────────────────

test('NORMAL-FEAT005-01: マイページの「もっと見る」リンクが正しく遷移する', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;

  await loginAs(page, emailA, passA);
  await page.goto('/me');

  // プロフィール「もっと見る」→ /profile
  // section[aria-labelledby="me-section-profile"] 内のリンク
  const profileSection = page.locator('section[aria-labelledby="me-section-profile"]');
  const profileLink = profileSection.locator('a[href="/profile"]').filter({ hasText: '編集する' }).first();
  await profileLink.click();
  await page.waitForURL(/\/profile/, { timeout: 10_000 });
  expect(page.url()).toContain('/profile');

  // 戻る
  await page.goto('/me');

  // フレンド「もっと見る」
  // 設計上、空状態でもディープリンクは表示される（design.md FEAT-005 各セクション空状態）。
  // よって isVisible 条件分岐は不要、hard assertion で必ず通る形にする。
  const friendsSection = page.locator('section[aria-labelledby="me-section-friends"]');
  const friendsLink = friendsSection.locator('a[href="/friends"]').first();
  await expect(friendsLink).toBeVisible();
  await friendsLink.click();
  await page.waitForURL(/\/friends/, { timeout: 10_000 });
  expect(page.url()).toContain('/friends');
});

// ────────────────────────────────────────────────────────────
// NORMAL-FEAT005-02: マイページのレスポンシブ表示（全画面サイズ）
// ────────────────────────────────────────────────────────────

test('NORMAL-FEAT005-02: マイページが全画面サイズで正常に表示される', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;

  // モバイルサイズでテスト
  const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await context.newPage();

  try {
    await loginAs(page, emailA, passA);
    await page.goto('/me');

    // セクションカードが表示される（見出しで確認）
    await expect(page.locator('h2:has-text("プロフィール")')).toBeVisible();
    await expect(page.locator('h2:has-text("フレンド")')).toBeVisible();
    await expect(page.locator('h2:has-text("過去のケース")')).toBeVisible();
    await expect(page.locator('h2:has-text("参加中の法律")')).toBeVisible();

    // 横スクロール不要なことを確認
    const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasHorizontalScroll).toBe(false);
  } finally {
    await context.close();
  }
});
