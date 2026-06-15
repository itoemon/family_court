import { test, expect, type Page } from '@playwright/test';

// ────────────────────────────────────────────────────────────
// 環境変数チェック
// ────────────────────────────────────────────────────────────

test.beforeEach(() => {
  const required = [
    'E2E_TEST_EMAIL_A',
    'E2E_TEST_EMAIL_B',
    'E2E_TEST_PASSWORD_A',
    'E2E_TEST_PASSWORD_B',
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
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/', { timeout: 15_000 });
}

async function createCase(page: Page, topic: string): Promise<string> {
  await page.goto('/');
  await page.fill('input[type="text"]', topic);
  await page.click('button:has-text("はじめる")');
  await page.waitForURL(/\/case\//, { timeout: 15_000 });
  return page.url().split('?')[0];
}

// ────────────────────────────────────────────────────────────
// BUG-004-Account: アカウント参加直後の弁護人 AI タブ表示
// ────────────────────────────────────────────────────────────

test('BUG-004-Account: アカウント参加直後に弁護人 AI タブが表示される', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const emailB = process.env.E2E_TEST_EMAIL_B!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;
  const passB  = process.env.E2E_TEST_PASSWORD_B!;

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // A（原告）がケースを作成
    await loginAs(pageA, emailA, passA);
    const caseUrl = await createCase(pageA, 'BUG-004: 弁護人 AI タブ直後表示テスト（アカウント）');

    // B（被告）がアカウントで参加
    await loginAs(pageB, emailB, passB);
    await pageB.goto(caseUrl);
    await pageB.click('button:has-text("アカウントでログインして参加")');
    await pageB.click('button:has-text("ログインして参加する")');

    // 弁護人 AI タブが表示されることを確認（リロードなし）
    // 「さんの返答を待っています」が表示される（参加完了の証拠）までは待つ
    await pageB.waitForSelector('text=さんの返答を待っています', { timeout: 10_000 });

    // 弁護人 AI タブが表示されていることを確認
    const defenseTab = pageB.locator('button:has-text("弁護人AI")');
    await expect(defenseTab).toBeVisible({ timeout: 5_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ────────────────────────────────────────────────────────────
// BUG-004-Guest: ゲスト参加直後の弁護人 AI タブ表示
// ────────────────────────────────────────────────────────────

test('BUG-004-Guest: ゲスト参加直後に弁護人 AI タブが表示される', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;

  const ctxA     = await browser.newContext();
  const ctxGuest = await browser.newContext();
  const pageA     = await ctxA.newPage();
  const pageGuest = await ctxGuest.newPage();

  try {
    // A（原告）がケースを作成
    await loginAs(pageA, emailA, passA);
    const caseUrl = await createCase(pageA, 'BUG-004: 弁護人 AI タブ直後表示テスト（ゲスト）');

    // ゲスト（被告）が参加
    await pageGuest.goto(caseUrl);
    await pageGuest.click('button:has-text("ゲストとして参加")');
    await pageGuest.fill('input[type="text"]', 'テスト被告');
    await pageGuest.click('button[type="submit"]');

    // 弁護人 AI タブが表示されることを確認（リロードなし）
    // 「さんの返答を待っています」が表示される（参加完了の証拠）までは待つ
    await pageGuest.waitForSelector('text=さんの返答を待っています', { timeout: 10_000 });

    // 弁護人 AI タブが表示されていることを確認
    const defenseTab = pageGuest.locator('button:has-text("弁護人AI")');
    await expect(defenseTab).toBeVisible({ timeout: 5_000 });
  } finally {
    await ctxA.close();
    await ctxGuest.close();
  }
});

// ────────────────────────────────────────────────────────────
// リグレッション: CRITICAL-M04 の再検証
// ────────────────────────────────────────────────────────────

test('BUG-004-Regression: ゲスト被告が Cookie トークンで発言できる', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;

  const ctxA     = await browser.newContext();
  const ctxGuest = await browser.newContext();
  const pageA     = await ctxA.newPage();
  const pageGuest = await ctxGuest.newPage();

  try {
    await loginAs(pageA, emailA, passA);
    const caseUrl = await createCase(pageA, 'BUG-004-Regression: ゲスト被告テスト');

    await pageGuest.goto(caseUrl);
    await pageGuest.click('button:has-text("ゲストとして参加")');
    await pageGuest.fill('input[type="text"]', 'ゲスト太郎');
    await pageGuest.click('button[type="submit"]');
    await pageGuest.waitForSelector('text=さんの返答を待っています', { timeout: 10_000 });

    // A が最初の発言
    await pageA.waitForSelector('textarea', { timeout: 10_000 });
    await pageA.fill('textarea', '原告からゲスト被告へ');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=原告からゲスト被告へ', { timeout: 10_000 });

    // ゲストのターンになったことを確認してから返答
    await pageGuest.reload();
    await pageGuest.waitForSelector('textarea', { timeout: 10_000 });
    await pageGuest.fill('textarea', 'ゲスト被告の返答');
    await pageGuest.click('button:has-text("送る")');
    await pageGuest.waitForSelector('text=ゲスト被告の返答', { timeout: 10_000 });

    // A 側にも反映される
    await pageA.reload();
    await expect(pageA.locator('text=ゲスト被告の返答')).toBeVisible();
  } finally {
    await ctxA.close();
    await ctxGuest.close();
  }
});
