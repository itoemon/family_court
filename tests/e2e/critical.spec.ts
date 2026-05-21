import { test, expect } from '@playwright/test';

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

async function loginAs(page: any, email: string, password: string) {
  await page.goto('/auth/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/', { timeout: 10_000 });
}

// 原告がログイン済みの状態で呼び出す。/case/:id（クエリなし）を返す。
async function createCase(page: any, topic: string): Promise<string> {
  await page.goto('/');
  await page.fill('input[type="text"]', topic);
  await page.click('button:has-text("はじめる")');
  await page.waitForURL(/\/case\//, { timeout: 15_000 });
  return page.url().split('?')[0];
}

// 認証済みユーザーとして被告参加する（2ステップ）。
// 1. 「アカウントでログインして参加」→ joinMode が "login" に切り替わる
// 2. 「ログインして参加する」→ PATCH /api/cases/:id が実行される
// 参加完了後は opening フェーズ・原告のターンのため、被告側の textarea は出ない。
// 代わりに「{opponentName} さんの返答を待っています」が表示されることを確認する（部分一致: `text=さんの返答を待っています`）。
async function joinAsAccount(page: any) {
  await page.click('button:has-text("アカウントでログインして参加")');
  await page.click('button:has-text("ログインして参加する")');
  await page.waitForSelector('text=さんの返答を待っています', { timeout: 10_000 });
}

// ────────────────────────────────────────────────────────────
// CRITICAL-M01: 2ユーザー間の会話フロー（両者認証済み）
// ────────────────────────────────────────────────────────────

test('CRITICAL-M01: 2ユーザー間でターン交代の会話ができる（両者認証済み）', async ({ browser }) => {
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
    const caseUrl = await createCase(pageA, 'M01: E2Eテスト用トピック');

    await loginAs(pageB, emailB, passB);
    await pageB.goto(caseUrl);
    await joinAsAccount(pageB);

    // A が最初の発言（opening フェーズ・原告ターン）
    await pageA.waitForSelector('textarea', { timeout: 10_000 });
    await pageA.fill('textarea', '原告の最初の発言');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=原告の最初の発言', { timeout: 10_000 });

    // B のターンになったことを確認してから返答
    await pageB.reload();
    await pageB.waitForSelector('textarea', { timeout: 10_000 });
    await pageB.fill('textarea', '被告の返答');
    await pageB.click('button:has-text("送る")');
    await pageB.waitForSelector('text=被告の返答', { timeout: 10_000 });

    // A 側にも被告の返答が反映される
    await pageA.reload();
    await expect(pageA.locator('text=被告の返答')).toBeVisible();
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ────────────────────────────────────────────────────────────
// CRITICAL-M02: セッション復元
// ────────────────────────────────────────────────────────────

test('CRITICAL-M02: ページリロード後もセッションが維持される', async ({ browser }) => {
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
    const caseUrl = await createCase(pageA, 'M02: セッション復元テスト');

    await loginAs(pageB, emailB, passB);
    await pageB.goto(caseUrl);
    await joinAsAccount(pageB);

    // 原告: リロード後も発言フォームが表示される
    await pageA.reload();
    await pageA.waitForURL(new RegExp(caseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: 10_000 });
    await expect(pageA.locator('textarea').first()).toBeVisible();

    // 被告: 原告が発言してターンを渡した後にリロードしてもフォームが表示される
    await pageA.fill('textarea', '原告の発言（セッション確認用）');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=原告の発言（セッション確認用）', { timeout: 10_000 });

    await pageB.reload();
    await pageB.waitForURL(new RegExp(caseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: 10_000 });
    await expect(pageB.locator('textarea').first()).toBeVisible();
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ────────────────────────────────────────────────────────────
// CRITICAL-M03: 第三者の割り込み拒否
// ────────────────────────────────────────────────────────────

test('CRITICAL-M03: 第三者認証ユーザーが被告として発言できない', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const emailB = process.env.E2E_TEST_EMAIL_B!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;
  const passB  = process.env.E2E_TEST_PASSWORD_B!;

  const ctxA     = await browser.newContext();
  const ctxGuest = await browser.newContext();
  const ctxB     = await browser.newContext();
  const pageA     = await ctxA.newPage();
  const pageGuest = await ctxGuest.newPage();
  const pageB     = await ctxB.newPage();

  try {
    await loginAs(pageA, emailA, passA);
    const caseUrl = await createCase(pageA, 'M03: 第三者割り込みテスト');

    // ゲストが被告として参加
    await pageGuest.goto(caseUrl);
    await pageGuest.click('button:has-text("ゲストとして参加")');
    await pageGuest.fill('input[type="text"]', 'ゲスト被告');
    await pageGuest.click('button[type="submit"]');
    await pageGuest.waitForSelector('text=さんの返答を待っています', { timeout: 10_000 });

    // B（第三者）がケースを開く
    await loginAs(pageB, emailB, passB);
    await pageB.goto(caseUrl);
    // topic ヘッダーが出たら描画完了（ポーリング反映済み）
    await expect(pageB.locator('text=M03: 第三者割り込みテスト')).toBeVisible({ timeout: 10_000 });
    // 発言フォームは表示されない（observer 扱い）
    await expect(pageB.locator('textarea')).not.toBeVisible();
  } finally {
    await ctxA.close();
    await ctxGuest.close();
    await ctxB.close();
  }
});

// ────────────────────────────────────────────────────────────
// CRITICAL-M04: ゲスト被告フロー
// ────────────────────────────────────────────────────────────

test('CRITICAL-M04: ゲスト被告が Cookie トークンで発言できる', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;

  const ctxA     = await browser.newContext();
  const ctxGuest = await browser.newContext();
  const pageA     = await ctxA.newPage();
  const pageGuest = await ctxGuest.newPage();

  try {
    await loginAs(pageA, emailA, passA);
    const caseUrl = await createCase(pageA, 'M04: ゲスト被告テスト');

    // ゲストが名前を入力して参加（Cookie トークンが発行される）
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
