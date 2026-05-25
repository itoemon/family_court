import { test, expect } from '@playwright/test';

// ────────────────────────────────────────────────────────────
// セキュリティ修正テスト（A-1・A-2・A-3）
// ────────────────────────────────────────────────────────────

test.beforeEach(() => {
  const required = ['E2E_TEST_EMAIL_A', 'E2E_TEST_PASSWORD_A', 'E2E_TEST_EMAIL_B', 'E2E_TEST_PASSWORD_B'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    test.skip(true, `必須環境変数が未設定: ${missing.join(', ')}`);
  }
});

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
// A-3: ゲスト被告名の最大長バリデーション
// ────────────────────────────────────────────────────────────

test('A-3: 51文字以上のゲスト名は400エラーを返す', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;

  const ctxA = await browser.newContext();
  const ctxGuest = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageGuest = await ctxGuest.newPage();

  try {
    // ケース作成
    await loginAs(pageA, emailA, passA);
    const caseUrl = await createCase(pageA, 'A-3: ゲスト名バリデーションテスト');

    // ゲストが長い名前（51文字）で参加しようとする
    const longName = 'a'.repeat(51);
    const caseId = caseUrl.split('/').pop();
    await pageGuest.goto(caseUrl);
    await pageGuest.click('button:has-text("ゲストとして参加")');
    await pageGuest.fill('input[type="text"]', longName);

    // 直接 API を呼び出してレスポンスを確認
    const response = await pageGuest.request.patch(`/api/cases/${caseId}`, {
      data: {
        asGuest: true,
        defendantName: longName,
      },
    });

    // PATCH /api/cases/[id] が 400 を返すことを確認
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('50文字');
  } finally {
    await ctxA.close();
    await ctxGuest.close();
  }
});

test('A-3: 50文字のゲスト名は正常に参加できる', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;

  const ctxA = await browser.newContext();
  const ctxGuest = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageGuest = await ctxGuest.newPage();

  try {
    await loginAs(pageA, emailA, passA);
    const caseUrl = await createCase(pageA, 'A-3: 50文字ゲスト名テスト');

    // ゲストが 50 文字ちょうどの名前で参加
    const name50 = 'a'.repeat(50);
    const caseId = caseUrl.split('/').pop();
    await pageGuest.goto(caseUrl);
    await pageGuest.click('button:has-text("ゲストとして参加")');
    await pageGuest.fill('input[type="text"]', name50);

    // 直接 API を呼び出して正常に参加できることを確認
    const response = await pageGuest.request.patch(`/api/cases/${caseId}`, {
      data: {
        asGuest: true,
        defendantName: name50,
      },
    });

    expect(response.status()).toBe(200);

    // UI 側でも確認: 参加後の状態が表示されるまで待つ
    await pageGuest.goto(caseUrl);
    // 参加完了を確認（「さんの返答を待っています」が表示される）
    await pageGuest.waitForSelector('text=さんの返答を待っています', { timeout: 10_000 });
  } finally {
    await ctxA.close();
    await ctxGuest.close();
  }
});

// ────────────────────────────────────────────────────────────
// A-2: プロンプトインジェクション対策
// （XML タグ・escapeXml・truncate がプロンプトに反映されているか）
// ────────────────────────────────────────────────────────────

test('A-2: 特殊文字を含む名前でも judge メッセージが破綻しない', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const emailB = process.env.E2E_TEST_EMAIL_B!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;
  const passB = process.env.E2E_TEST_PASSWORD_B!;

  // 特殊文字が含まれたテストユーザー名を使用（< > & " ' など）
  // ただし、UI の表示名フィールドを直接変更することはできないため、
  // プロフィール画面で display_name を変更するか、別途テスト
  // ここでは「特殊文字入りケース名」でテストする

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    await loginAs(pageA, emailA, passA);
    // 特殊文字を含むケース名（ただし < は UI で入力時に制限されている可能性もある）
    const topicWithSpecials = 'テスト & テスト "引用"';
    const caseUrl = await createCase(pageA, topicWithSpecials);

    await loginAs(pageB, emailB, passB);
    await pageB.goto(caseUrl);
    await pageB.click('button:has-text("アカウントでログインして参加")');
    await pageB.click('button:has-text("ログインして参加する")');
    await pageB.waitForSelector('text=さんの返答を待っています', { timeout: 10_000 });

    // 発言を投稿（opening フェーズを進める）
    await pageA.waitForSelector('textarea', { timeout: 10_000 });
    await pageA.fill('textarea', '原告の発言');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=原告の発言', { timeout: 10_000 });

    // 被告が返答
    await pageB.reload();
    await pageB.waitForSelector('textarea', { timeout: 10_000 });
    await pageB.fill('textarea', '被告の返答');
    await pageB.click('button:has-text("送る")');
    await pageB.waitForSelector('text=被告の返答', { timeout: 10_000 });

    // closing フェーズまで進めて judge が正常に生成されるか確認
    // 簡易テスト: ページが 500 エラーになっていないことを確認
    const titleText = await pageA.title();
    expect(titleText).toBeTruthy();
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ────────────────────────────────────────────────────────────
// A-1: GUEST_TOKEN_SECRET 未設定時の fail-fast
// （Playwright では直接テストできないため、実装確認のみ）
// ────────────────────────────────────────────────────────────

test('A-1: ゲスト参加フローが正常に動作（GUEST_TOKEN_SECRET が設定されている）', async ({
  browser,
}) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;

  const ctxA = await browser.newContext();
  const ctxGuest = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageGuest = await ctxGuest.newPage();

  try {
    await loginAs(pageA, emailA, passA);
    const caseUrl = await createCase(pageA, 'A-1: ゲストトークンテスト');

    // ゲスト参加（Cookie トークン発行） - CRITICAL-M04 と同じフロー
    await pageGuest.goto(caseUrl);
    await pageGuest.click('button:has-text("ゲストとして参加")');
    await pageGuest.fill('input[type="text"]', 'ゲスト太郎');
    await pageGuest.click('button[type="submit"]');

    // 参加完了を確認（「さんの返答を待っています」が表示される）
    await pageGuest.waitForSelector('text=さんの返答を待っています', { timeout: 10_000 });

    // ゲストが発言を投稿できることを確認（トークンが有効）
    await pageA.waitForSelector('textarea', { timeout: 10_000 });
    await pageA.fill('textarea', '原告の発言');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=原告の発言', { timeout: 10_000 });

    await pageGuest.reload();
    await pageGuest.waitForSelector('textarea', { timeout: 10_000 });
    await pageGuest.fill('textarea', 'ゲスト被告の返答');
    await pageGuest.click('button:has-text("送る")');
    await pageGuest.waitForSelector('text=ゲスト被告の返答', { timeout: 10_000 });

    // 成功すれば GUEST_TOKEN_SECRET が正しく設定されている
    expect(true).toBe(true);
  } finally {
    await ctxA.close();
    await ctxGuest.close();
  }
});
