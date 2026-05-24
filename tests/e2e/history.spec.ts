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

async function createCase(page: any, topic: string): Promise<string> {
  await page.goto('/');
  await page.fill('input[type="text"]', topic);
  await page.click('button:has-text("はじめる")');
  await page.waitForURL(/\/case\//, { timeout: 15_000 });
  return page.url().split('?')[0];
}

async function joinAsAccount(page: any) {
  await page.click('button:has-text("アカウントでログインして参加")');
  await page.click('button:has-text("ログインして参加する")');
  await page.waitForSelector('text=さんの返答を待っています', { timeout: 10_000 });
}

async function waitForVerdict(page: any) {
  await page.waitForURL(/\/case\/.*\/verdict/, { timeout: 60_000 });
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
// CRITICAL-H02: 過去ケース一覧表示（verdict フェーズのみ表示）
// ────────────────────────────────────────────────────────────

test('CRITICAL-H02: /history には verdict フェーズのケースのみ表示される', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const emailB = process.env.E2E_TEST_EMAIL_B!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;
  const passB  = process.env.E2E_TEST_PASSWORD_B!;

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // A がログイン、2つのケースを作成
    await loginAs(pageA, emailA, passA);

    // ケース1: 進行中のまま（opening フェーズ）
    const ongoingCaseUrl = await createCase(pageA, `H02-ongoing-${Date.now()}`);
    await pageA.waitForSelector('textarea', { timeout: 10_000 });

    // ケース2: B に参加させて、複数ターンで verdict まで進める
    const completedCaseUrl = await createCase(pageA, `H02-completed-${Date.now()}`);

    // B がログインしてケース2に参加
    await loginAs(pageB, emailB, passB);
    await pageB.goto(completedCaseUrl);
    await joinAsAccount(pageB);

    // opening フェーズ: A → B（各 1 ターン）
    await pageA.fill('textarea', 'A opening statement');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=A opening statement', { timeout: 10_000 });

    await pageB.reload();
    await pageB.waitForSelector('textarea', { timeout: 10_000 });
    await pageB.fill('textarea', 'B opening statement');
    await pageB.click('button:has-text("送る")');
    await pageB.waitForSelector('text=B opening statement', { timeout: 10_000 });

    // argument フェーズ: 1ラウンド（A → B）で十分に進める
    await pageA.reload();
    await pageA.waitForSelector('textarea', { timeout: 10_000 });
    await pageA.fill('textarea', 'A argument 1');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=A argument 1', { timeout: 10_000 });

    await pageB.reload();
    await pageB.waitForSelector('textarea', { timeout: 10_000 });
    await pageB.fill('textarea', 'B argument 1');
    await pageB.click('button:has-text("送る")');
    await pageB.waitForSelector('text=B argument 1', { timeout: 10_000 });

    // closing フェーズ: A → B
    await pageA.reload();
    await pageA.waitForSelector('textarea', { timeout: 10_000 });
    await pageA.fill('textarea', 'A closing statement');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=A closing statement', { timeout: 10_000 });

    await pageB.reload();
    await pageB.waitForSelector('textarea', { timeout: 10_000 });
    await pageB.fill('textarea', 'B closing statement');
    await pageB.click('button:has-text("送る")');
    await pageB.waitForSelector('text=B closing statement', { timeout: 10_000 });

    // verdict フェーズに移行するまで待つ
    await waitForVerdict(pageA);

    // A が /history にアクセス
    await pageA.goto('/history');
    await expect(pageA.locator('text=過去のケース')).toBeVisible({ timeout: 10_000 });

    // ケース2（completed）は表示されるはず
    const completedCaseId = completedCaseUrl.split('/').pop()!;
    const historyLinks = await pageA.locator('a').all();
    let foundCompleted = false;
    for (const link of historyLinks) {
      const href = await link.getAttribute('href');
      if (href && href.includes(completedCaseId)) {
        foundCompleted = true;
        break;
      }
    }
    expect(foundCompleted).toBe(true);

    // ケース1（ongoing）は表示されないはず
    const ongoingCaseId = ongoingCaseUrl.split('/').pop()!;
    let foundOngoing = false;
    for (const link of historyLinks) {
      const href = await link.getAttribute('href');
      if (href && href.includes(ongoingCaseId)) {
        foundOngoing = true;
        break;
      }
    }
    expect(foundOngoing).toBe(false);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ────────────────────────────────────────────────────────────
// CRITICAL-H03: 相手の名前表示（原告視点・被告視点）
// ────────────────────────────────────────────────────────────

test('CRITICAL-H03: /history では相手の表示名が正しく表示される', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const emailB = process.env.E2E_TEST_EMAIL_B!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;
  const passB  = process.env.E2E_TEST_PASSWORD_B!;

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // ケースを作成し verdictまで進める（H02 と同じロジック）
    await loginAs(pageA, emailA, passA);
    const caseUrl = await createCase(pageA, `H03-opponent-name-${Date.now()}`);

    await loginAs(pageB, emailB, passB);
    await pageB.goto(caseUrl);
    await joinAsAccount(pageB);

    // opening フェーズ
    await pageA.waitForSelector('textarea', { timeout: 10_000 });
    await pageA.fill('textarea', 'A opening');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=A opening', { timeout: 10_000 });

    await pageB.reload();
    await pageB.waitForSelector('textarea', { timeout: 10_000 });
    await pageB.fill('textarea', 'B opening');
    await pageB.click('button:has-text("送る")');
    await pageB.waitForSelector('text=B opening', { timeout: 10_000 });

    // argument: 1ラウンド
    await pageA.reload();
    await pageA.waitForSelector('textarea', { timeout: 10_000 });
    await pageA.fill('textarea', 'A argument');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=A argument', { timeout: 10_000 });

    await pageB.reload();
    await pageB.waitForSelector('textarea', { timeout: 10_000 });
    await pageB.fill('textarea', 'B argument');
    await pageB.click('button:has-text("送る")');
    await pageB.waitForSelector('text=B argument', { timeout: 10_000 });

    // closing
    await pageA.reload();
    await pageA.waitForSelector('textarea', { timeout: 10_000 });
    await pageA.fill('textarea', 'A closing');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=A closing', { timeout: 10_000 });

    await pageB.reload();
    await pageB.waitForSelector('textarea', { timeout: 10_000 });
    await pageB.fill('textarea', 'B closing');
    await pageB.click('button:has-text("送る")');
    await pageB.waitForSelector('text=B closing', { timeout: 10_000 });

    // verdict フェーズに移行するまで待つ
    await waitForVerdict(pageA);

    // A が /history で「相手:」行が表示されることを確認
    await pageA.goto('/history');
    await expect(pageA.locator('text=過去のケース')).toBeVisible({ timeout: 10_000 });
    await expect(pageA.locator('text=相手:').first()).toBeVisible({ timeout: 10_000 });

    // B が /history で「相手:」行が表示されることを確認
    await pageB.goto('/history');
    await expect(pageB.locator('text=過去のケース')).toBeVisible({ timeout: 10_000 });
    await expect(pageB.locator('text=相手:').first()).toBeVisible({ timeout: 10_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ────────────────────────────────────────────────────────────
// CRITICAL-H04: ゲストケースの除外（defendant_id IS NULL のケースは表示されない）
// ────────────────────────────────────────────────────────────

test('CRITICAL-H04: /history ではゲスト被告のケースが表示されない', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;

  const ctxA     = await browser.newContext();
  const ctxGuest = await browser.newContext();
  const pageA     = await ctxA.newPage();
  const pageGuest = await ctxGuest.newPage();

  try {
    // A がログイン、ゲスト被告ケースを作成
    await loginAs(pageA, emailA, passA);
    const caseUrl = await createCase(pageA, `H04-guest-case-${Date.now()}`);

    // ゲストが参加
    await pageGuest.goto(caseUrl);
    await pageGuest.click('button:has-text("ゲストとして参加")');
    await pageGuest.fill('input[type="text"]', 'ゲスト太郎');
    await pageGuest.click('button[type="submit"]');
    await pageGuest.waitForSelector('text=さんの返答を待っています', { timeout: 10_000 });

    // opening フェーズで A → ゲスト の発言
    await pageA.waitForSelector('textarea', { timeout: 10_000 });
    await pageA.fill('textarea', 'A opening to guest');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=A opening to guest', { timeout: 10_000 });

    await pageGuest.reload();
    await pageGuest.waitForSelector('textarea', { timeout: 10_000 });
    await pageGuest.fill('textarea', 'Guest opening response');
    await pageGuest.click('button:has-text("送る")');
    await pageGuest.waitForSelector('text=Guest opening response', { timeout: 10_000 });

    // argument: 1ラウンド
    await pageA.reload();
    await pageA.waitForSelector('textarea', { timeout: 10_000 });
    await pageA.fill('textarea', 'A argument to guest');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=A argument to guest', { timeout: 10_000 });

    await pageGuest.reload();
    await pageGuest.waitForSelector('textarea', { timeout: 10_000 });
    await pageGuest.fill('textarea', 'Guest argument response');
    await pageGuest.click('button:has-text("送る")');
    await pageGuest.waitForSelector('text=Guest argument response', { timeout: 10_000 });

    // closing
    await pageA.reload();
    await pageA.waitForSelector('textarea', { timeout: 10_000 });
    await pageA.fill('textarea', 'A closing to guest');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=A closing to guest', { timeout: 10_000 });

    await pageGuest.reload();
    await pageGuest.waitForSelector('textarea', { timeout: 10_000 });
    await pageGuest.fill('textarea', 'Guest closing response');
    await pageGuest.click('button:has-text("送る")');
    await pageGuest.waitForSelector('text=Guest closing response', { timeout: 10_000 });

    // verdict フェーズに移行するまで待つ
    await waitForVerdict(pageA);

    // A が /history にアクセス
    await pageA.goto('/history');
    await expect(pageA.locator('text=過去のケース')).toBeVisible({ timeout: 10_000 });

    // ゲスト被告のケース（defendant_id IS NULL）は表示されないはず
    const caseId = caseUrl.split('/').pop()!;
    const historyLinks = await pageA.locator('a').all();
    let foundGuestCase = false;
    for (const link of historyLinks) {
      const href = await link.getAttribute('href');
      if (href && href.includes(caseId)) {
        foundGuestCase = true;
        break;
      }
    }
    expect(foundGuestCase).toBe(false);
  } finally {
    await ctxA.close();
    await ctxGuest.close();
  }
});

// ────────────────────────────────────────────────────────────
// CRITICAL-H05: 詳細ページへのナビゲーション（/history → /case/[id] → /case/[id]/verdict）
// ────────────────────────────────────────────────────────────

test('CRITICAL-H05: /history からケース詳細へ遷移すると verdict ページが表示される', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const emailB = process.env.E2E_TEST_EMAIL_B!;
  const passA  = process.env.E2E_TEST_PASSWORD_A!;
  const passB  = process.env.E2E_TEST_PASSWORD_B!;

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // ケースを作成し verdict まで進める
    await loginAs(pageA, emailA, passA);
    const caseUrl = await createCase(pageA, `H05-verdict-link-${Date.now()}`);

    await loginAs(pageB, emailB, passB);
    await pageB.goto(caseUrl);
    await joinAsAccount(pageB);

    // opening
    await pageA.waitForSelector('textarea', { timeout: 10_000 });
    await pageA.fill('textarea', 'A opening');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=A opening', { timeout: 10_000 });

    await pageB.reload();
    await pageB.waitForSelector('textarea', { timeout: 10_000 });
    await pageB.fill('textarea', 'B opening');
    await pageB.click('button:has-text("送る")');
    await pageB.waitForSelector('text=B opening', { timeout: 10_000 });

    // argument: 1ラウンド
    await pageA.reload();
    await pageA.waitForSelector('textarea', { timeout: 10_000 });
    await pageA.fill('textarea', 'A argument');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=A argument', { timeout: 10_000 });

    await pageB.reload();
    await pageB.waitForSelector('textarea', { timeout: 10_000 });
    await pageB.fill('textarea', 'B argument');
    await pageB.click('button:has-text("送る")');
    await pageB.waitForSelector('text=B argument', { timeout: 10_000 });

    // closing
    await pageA.reload();
    await pageA.waitForSelector('textarea', { timeout: 10_000 });
    await pageA.fill('textarea', 'A closing');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=A closing', { timeout: 10_000 });

    await pageB.reload();
    await pageB.waitForSelector('textarea', { timeout: 10_000 });
    await pageB.fill('textarea', 'B closing');
    await pageB.click('button:has-text("送る")');
    await pageB.waitForSelector('text=B closing', { timeout: 10_000 });

    // verdict フェーズに移行するまで待つ
    await waitForVerdict(pageA);

    // A が /history にアクセスしてリンクをクリック
    await pageA.goto('/history');
    await expect(pageA.locator('text=過去のケース')).toBeVisible({ timeout: 10_000 });

    await pageA.click('a[href*="/case/"]');
    await pageA.waitForURL(/\/case\/.*\/verdict/, { timeout: 10_000 });

    // verdict ページの固定テキストが表示されること
    await expect(pageA.locator('text=AI の所見')).toBeVisible({ timeout: 10_000 });

    // 発言フォームが表示されないことを確認（observer モード）
    await expect(pageA.locator('textarea')).not.toBeVisible();
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
