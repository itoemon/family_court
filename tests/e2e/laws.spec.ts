import { test, expect } from '@playwright/test';

// ログインヘルパー
async function loginAs(page: any, email: string, password: string) {
  await page.goto('/auth/login');
  const emailInput = page.locator('input[type="email"]');
  const passInput = page.locator('input[type="password"]');
  await emailInput.fill(email);
  await passInput.fill(password);
  await page.click('button:has-text("ログイン")');
  await page.waitForURL('/', { timeout: 10_000 });
}

// 法律作成ヘルパー
async function createLaw(page: any, name: string, article: string): Promise<string> {
  await page.goto('/laws/new');
  const nameInput = page.locator('form input[type="text"]').first();
  const articleInput = page.locator('form textarea').first();
  await nameInput.fill(name);
  await articleInput.fill(article);
  await page.click('button:has-text("法律を作る")');
  await page.waitForURL(/\/laws\/[a-f0-9-]{36}/, { timeout: 15_000 });
  return page.url().split('?')[0];
}

// CRITICAL-L01: 法律を作成できる（ログイン済みユーザーがオーナーになる）
test('CRITICAL-L01: 法律を作成できる', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A ?? '';
  const passA = process.env.E2E_TEST_PASSWORD_A ?? '';

  await loginAs(page, emailA, passA);
  const lawUrl = await createLaw(page, 'テスト法律1', 'これはテスト条文です。');

  // 作成直後は自分がオーナーとして表示される
  await expect(page.locator('h1, h2').filter({ hasText: 'テスト法律1' })).toBeVisible();
});

// CRITICAL-L02: オーナーがフレンドを招待でき、招待対象が/lawsページで承認できる（FIX-1修正対応）
test('CRITICAL-L02: フレンド招待と承認', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A ?? '';
  const emailB = process.env.E2E_TEST_EMAIL_B ?? '';
  const passA = process.env.E2E_TEST_PASSWORD_A ?? '';
  const passB = process.env.E2E_TEST_PASSWORD_B ?? '';

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // ユーザー A がフレンド法律を作成
    await loginAs(pageA, emailA, passA);
    const lawUrl = await createLaw(pageA, 'フレンド法律', 'フレンド間のルール');

    // ユーザー A がユーザー B を招待（/api/friends ベースのフィルタ）
    await pageA.waitForSelector('input[placeholder="表示名で絞り込む"]', { timeout: 5_000 });
    const searchInput = pageA.locator('input[placeholder="表示名で絞り込む"]');
    // フィルタなし（全フレンド表示）で招待ボタンを探す
    await searchInput.fill('');
    await pageA.waitForTimeout(500);
    const inviteBtn = pageA.locator('button:has-text("招待")').first();
    await expect(inviteBtn).toBeVisible({ timeout: 5_000 });
    await inviteBtn.click();
    await pageA.waitForSelector('text=招待しました', { timeout: 5_000 });

    // ユーザー B がログインして /laws ページにアクセス（FIX-1: 招待受信UIは/lawsページに表示）
    await loginAs(pageB, emailB, passB);
    await pageB.goto('/laws');

    // pending招待セクションで「承認」ボタンを確認・クリック
    const acceptBtn = pageB.locator('button').filter({ hasText: '承認' }).first();
    await expect(acceptBtn).toBeVisible({ timeout: 5_000 });
    await acceptBtn.click();
    await pageB.waitForTimeout(1_000);

    // A 側でリロードしてメンバー表示を確認
    await pageA.reload();
    const memberCount = pageA.locator('text=/メンバー\\s+\\d+人/');
    await expect(memberCount).toBeVisible({ timeout: 5_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// CRITICAL-L03: メンバーが改定案を提出でき、全メンバーが承認すると成立する
test('CRITICAL-L03: 改定案の提出と全員合意', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A ?? '';
  const emailB = process.env.E2E_TEST_EMAIL_B ?? '';
  const passA = process.env.E2E_TEST_PASSWORD_A ?? '';
  const passB = process.env.E2E_TEST_PASSWORD_B ?? '';

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // セットアップ: A が法律を作成して B を招待・承認させる
    await loginAs(pageA, emailA, passA);
    const lawUrl = await createLaw(pageA, '改定テスト法律', '初期条文');

    // A が B を招待
    const searchInput = pageA.locator('input[placeholder="表示名で絞り込む"]');
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.fill('');
    await pageA.waitForTimeout(500);
    const inviteBtn = pageA.locator('button:has-text("招待")').first();
    await expect(inviteBtn).toBeVisible({ timeout: 5_000 });
    await inviteBtn.click();
    await pageA.waitForTimeout(500);

    // B がログインして法律詳細ページから直接承認（当該法律の招待を確実に処理するため）
    await loginAs(pageB, emailB, passB);
    await pageB.goto(lawUrl);
    const acceptBtn = pageB.locator('button').filter({ hasText: '承認' }).first();
    await expect(acceptBtn).toBeVisible({ timeout: 5_000 });
    await acceptBtn.click();
    // 招待承認後に router.refresh() でページ再描画 → メンバーとして表示される
    await expect(pageB.locator('text=この法律に招待されています')).not.toBeVisible({ timeout: 8_000 });

    // A が改定案を提出
    await pageA.reload();
    const proposalBtn = pageA.locator('button').filter({ hasText: '改定案を提出する' }).first();
    await expect(proposalBtn).toBeVisible({ timeout: 5_000 });
    await proposalBtn.click();
    const proposalInput = pageA.locator('textarea').first();
    await expect(proposalInput).toBeVisible({ timeout: 3_000 });
    await proposalInput.fill('改定後の新条文');
    const submitBtn = pageA.locator('button').filter({ hasText: '改定案を提出' }).first();
    await submitBtn.click();
    await pageA.waitForTimeout(500);

    // B が投票（賛成）
    await pageB.reload();  // 法律詳細ページに自動遷移していない場合に対応
    await pageB.goto(lawUrl);
    const voteBtn = pageB.locator('button').filter({ hasText: '賛成する' }).first();
    await expect(voteBtn).toBeVisible({ timeout: 5_000 });
    await voteBtn.click();

    // 条文が更新されたことを確認
    await pageA.reload();
    await pageA.waitForTimeout(1_000);
    await expect(pageA.locator('text=改定後の新条文')).toBeVisible({ timeout: 5_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// CRITICAL-L04: オーナーが他メンバーにオーナー権を移譲できる（FIX-1修正対応）
test('CRITICAL-L04: オーナー権の移譲', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A ?? '';
  const emailB = process.env.E2E_TEST_EMAIL_B ?? '';
  const passA = process.env.E2E_TEST_PASSWORD_A ?? '';
  const passB = process.env.E2E_TEST_PASSWORD_B ?? '';

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // セットアップ
    await loginAs(pageA, emailA, passA);
    const lawUrl = await createLaw(pageA, 'オーナー移譲テスト', '初期条文');

    // A が B を招待
    const searchInput = pageA.locator('input[placeholder="表示名で絞り込む"]');
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.fill('');
    await pageA.waitForTimeout(500);
    const inviteBtn = pageA.locator('button:has-text("招待")').first();
    await expect(inviteBtn).toBeVisible({ timeout: 5_000 });
    await inviteBtn.click();
    await pageA.waitForSelector('text=招待しました', { timeout: 5_000 });

    // B がログインして法律詳細ページから直接承認（当該法律の招待を確実に処理するため）
    await loginAs(pageB, emailB, passB);
    await pageB.goto(lawUrl);
    const acceptBtn = pageB.locator('button').filter({ hasText: '承認' }).first();
    await expect(acceptBtn).toBeVisible({ timeout: 5_000 });
    await acceptBtn.click();
    // 招待承認後に router.refresh() でページ再描画 → メンバーとして表示される
    await expect(pageB.locator('text=この法律に招待されています')).not.toBeVisible({ timeout: 8_000 });

    // A がオーナー権を B に移譲
    await pageA.reload();
    const transferBtn = pageA.locator('button').filter({ hasText: '権限を移譲' }).first();
    await expect(transferBtn).toBeVisible({ timeout: 5_000 });
    await transferBtn.click();
    // モーダルで B を選択
    const radioBtn = pageA.locator('input[type="radio"]').first();
    await expect(radioBtn).toBeVisible({ timeout: 3_000 });
    await radioBtn.click();
    // 移譲ボタンをクリック
    const submitBtn = pageA.locator('button').filter({ hasText: '移譲する' }).last();
    await expect(submitBtn).toBeEnabled({ timeout: 3_000 });
    await submitBtn.click();
    await pageA.waitForTimeout(1_000);

    // B 側でオーナーになったことを確認（オーナーバッジが表示される）
    await pageB.goto(lawUrl);
    const ownerBadge = pageB.locator('span').filter({ hasText: 'オーナー' }).first();
    await expect(ownerBadge).toBeVisible({ timeout: 5_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
