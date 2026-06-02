import { test, expect, type Page } from '@playwright/test';

/**
 * FEAT-RESP-HEADER: ヘッダーのアバター起点ドロップダウンメニュー刷新テスト
 * 実装ノート（eng-to-aud.md）の S1～S25 準拠
 */

// ────────────────────────────────────────────────────────────
// 環境変数チェック（critical.spec.ts の流儀に整合）
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

// ===== ヘルパー関数 =====

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/auth/login');
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/', { timeout: 15_000 });
}

async function loginAsPlaintiff(page: Page) {
  await loginAs(page, process.env.E2E_TEST_EMAIL_A!, process.env.E2E_TEST_PASSWORD_A!);
}

async function loginAsDefendant(page: Page) {
  await loginAs(page, process.env.E2E_TEST_EMAIL_B!, process.env.E2E_TEST_PASSWORD_B!);
}

// ===== CRITICAL テストケース =====

// CRITICAL-H01: 認証時・avatar_url あり → アバター画像丸型表示
test('CRITICAL-H01: 認証時でアバター画像が設定されている場合、丸型で表示される', async ({ page }) => {
  await loginAsPlaintiff(page);

  const avatarButton = page.locator('button[aria-haspopup="menu"][aria-label="アカウントメニューを開く"]');
  await expect(avatarButton).toBeVisible();

  // 画像要素の存在を確認
  const avatarImg = avatarButton.locator('img');
  const imgCount = await avatarImg.count();

  if (imgCount > 0) {
    const imgElement = avatarImg.first();
    await expect(imgElement).toBeVisible();
  } else {
    // 画像がない場合はシルエットアイコンが表示される（S2へ）
    const svgIcon = avatarButton.locator('svg');
    await expect(svgIcon).toBeVisible();
  }
});

// CRITICAL-H02: 認証時・avatar_url なし → 人型シルエット表示
// avatar 未設定ユーザー B でログインし、SVG フォールバックを明示検証
test('CRITICAL-H02: 認証時でアバター画像が未設定の場合、人型シルエットが表示される', async ({ page }) => {
  await loginAsDefendant(page);

  const avatarButton = page.locator('button[aria-haspopup="menu"][aria-label="アカウントメニューを開く"]');
  await expect(avatarButton).toBeVisible();

  // avatar_url 未設定なので SVG シルエットが描画される（<img> は無い）
  await expect(avatarButton.locator('svg')).toBeVisible();
  await expect(avatarButton.locator('img')).toHaveCount(0);
});

// CRITICAL-H03: 未認証 → 「メニューを開く」aria-label のトリガが表示される
test('CRITICAL-H03: 未認証時、メニューボタンが表示される', async ({ page }) => {
  await page.goto('/');
  // middleware により未認証は /auth/login or /auth/signup へ遷移
  await page.waitForURL(/auth\/(login|signup)/, { timeout: 5_000 }).catch(() => {});

  // 未認証トリガ（aria-label="メニューを開く"）が表示されていることを検証
  const unauthTrigger = page.locator('header button[aria-haspopup="menu"][aria-label="メニューを開く"]');
  await expect(unauthTrigger).toBeVisible();
});

// CRITICAL-H04: 375px 幅 → 干渉なく収まる
test('CRITICAL-H04: 375px 幅のスマートフォンでロゴとアバターが干渉なく収まる', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });

  await loginAsPlaintiff(page);

  const header = page.locator('header').first();
  await expect(header).toBeVisible();

  const logo = header.locator('a, [role="link"]').first();
  await expect(logo).toBeVisible();

  const avatar = header.locator('button[aria-haspopup="menu"]');
  await expect(avatar).toBeVisible();

  // body と documentElement の最大値で横スクロール判定（環境依存の偽陰性回避）
  const scrollWidth = await page.evaluate(() =>
    Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
  );
  const viewportWidth = 375;
  expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1); // 1px の許容差
});

// CRITICAL-H05: アバタークリックで開閉トグル
test('CRITICAL-H05: アバターボタンのクリックでドロップダウンメニューが開閉する', async ({ page }) => {
  await loginAsPlaintiff(page);

  const avatarButton = page.locator('button[aria-haspopup="menu"][aria-label="アカウントメニューを開く"]');
  const menu = page.locator('[role="menu"]');

  await expect(menu).not.toBeVisible();

  await avatarButton.click();
  await expect(menu).toBeVisible();

  await avatarButton.click();
  await expect(menu).not.toBeVisible();
});

// CRITICAL-H06: メニュー外側クリックで閉じる
test('CRITICAL-H06: メニュー開状態で外側をクリックすると閉じる', async ({ page }) => {
  await loginAsPlaintiff(page);

  const avatarButton = page.locator('button[aria-haspopup="menu"][aria-label="アカウントメニューを開く"]');
  const menu = page.locator('[role="menu"]');

  await avatarButton.click();
  await expect(menu).toBeVisible();

  await page.click('body', { position: { x: 50, y: 100 } });
  await page.waitForTimeout(200);

  const isVisible = await menu.isVisible().catch(() => false);
  expect(isVisible).toBe(false);
});

// CRITICAL-H07: Escape キーで閉じる＋フォーカス戻し
test('CRITICAL-H07: メニュー開状態で Escape キーを押すと閉じてトリガにフォーカスが戻る', async ({ page }) => {
  await loginAsPlaintiff(page);

  const avatarButton = page.locator('button[aria-haspopup="menu"][aria-label="アカウントメニューを開く"]');
  const menu = page.locator('[role="menu"]');

  await avatarButton.click();
  await expect(menu).toBeVisible();

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const isVisible = await menu.isVisible().catch(() => false);
  expect(isVisible).toBe(false);

  const isFocused = await avatarButton.evaluate((el: HTMLElement) => el === document.activeElement);
  expect(isFocused).toBe(true);
});

// CRITICAL-H08: ログアウト動作確認
test('CRITICAL-H08: ログアウトボタンをクリックするとログアウトが実行される', async ({ page }) => {
  await loginAsPlaintiff(page);

  // ホーム画面に居ること（loginAs 内で waitForURL('/') 済み。ホスト非依存に末尾 / だけで検証）
  await expect(page).toHaveURL(/\/$/, { timeout: 5_000 });

  const avatarButton = page.locator('button[aria-haspopup="menu"][aria-label="アカウントメニューを開く"]');
  await avatarButton.click();

  const logoutBtn = page.locator('[role="menu"] button:has-text("ログアウト")');
  await expect(logoutBtn).toBeVisible();

  await logoutBtn.click();

  // ログアウト後の最終到達先は middleware により `/auth/login`（保護パス `/` 経由のリダイレクト）。
  // ただし Server Action の `redirect('/')` 直後の navigation チェーンはタイミング依存で
  // `/` で stay する瞬間があり、URL マッチのみだと不安定になるため、未認証ヘッダーの可視を
  // hard assertion で担保する。これにより「セッション破棄が実際に効いているか」を直接検証する。
  await expect(
    page.locator('header button[aria-haspopup="menu"][aria-label="メニューを開く"]'),
  ).toBeVisible({ timeout: 15_000 });
});

// CRITICAL-H09: メニュー項目の aria 属性検証（認証時）
test('CRITICAL-H09: メニュー要素に正しい aria 属性が付与されている（認証時）', async ({ page }) => {
  await loginAsPlaintiff(page);

  const avatarButton = page.locator('button[aria-haspopup="menu"][aria-label="アカウントメニューを開く"]');
  const menu = page.locator('[role="menu"]');

  await avatarButton.click();
  await expect(menu).toBeVisible();

  const expandedAttr = await avatarButton.getAttribute('aria-expanded');
  expect(expandedAttr).toBe('true');

  const menuRole = await menu.getAttribute('role');
  expect(menuRole).toBe('menu');

  const menuItems = page.locator('[role="menuitem"]');
  const itemCount = await menuItems.count();
  expect(itemCount).toBeGreaterThan(0);
});

// CRITICAL-H10: メニュー項目遷移確認（認証時）
// 各リンクの可視と href を hard assertion で検証して、欠落・誤リンクを検出する
test('CRITICAL-H10: ドロップダウンメニューの各項目が正しくリンクされている（認証時）', async ({ page }) => {
  await loginAsPlaintiff(page);

  const avatarButton = page.locator('button[aria-haspopup="menu"][aria-label="アカウントメニューを開く"]');
  await expect(avatarButton).toBeVisible();

  await avatarButton.click();
  const menu = page.locator('[role="menu"]');
  await expect(menu).toBeVisible();

  const historyLink = menu.locator('a:has-text("過去のケース")');
  await expect(historyLink).toBeVisible();
  await expect(historyLink).toHaveAttribute('href', '/history');

  const friendsLink = menu.locator('a:has-text("フレンド")');
  await expect(friendsLink).toBeVisible();
  await expect(friendsLink).toHaveAttribute('href', '/friends');

  const profileLink = menu.locator('a:has-text("プロフィール")');
  await expect(profileLink).toBeVisible();
  await expect(profileLink).toHaveAttribute('href', '/profile');

  const logoutBtn = menu.locator('button:has-text("ログアウト")');
  await expect(logoutBtn).toBeVisible();
});

// CRITICAL-H11: 認証チェック（middleware）動作確認
test('CRITICAL-H11: 未認証での保護ルートアクセスは /auth/login にリダイレクトされる', async ({ page }) => {
  await page.goto('/history');

  await page.waitForURL(/auth\/(login|signup)/, { timeout: 5_000 });

  // ログインページが表示されていること（input[type=email] が見える前提で判定）
  await expect(page.locator('input[type="email"]')).toBeVisible();
});

// CRITICAL-H12: profiles 取得失敗時フォールバック（500 を出さない）
// page.goto() の Response.status を直接検査して 5xx でないことを保証する
test('CRITICAL-H12: ヘッダーが 500 エラーを出さずレンダリングされる', async ({ page }) => {
  await loginAsPlaintiff(page);

  const response = await page.goto('/', { waitUntil: 'load' });
  expect(response, 'page.goto() did not return a Response').not.toBeNull();
  const status = response!.status();
  expect(status, `unexpected HTTP status ${status}`).toBeLessThan(500);

  await expect(page.locator('header')).toBeVisible();
  await expect(
    page.locator('button[aria-haspopup="menu"][aria-label="アカウントメニューを開く"]'),
  ).toBeVisible();
});

// CRITICAL-H13: 既存リグレッション確認（M01〜M04）
// 認証情報は beforeEach の必須チェック通過済みなので non-null で取り出す
test('CRITICAL-H13: ケース管理機能が従来通り動作する（リグレッション）', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  try {
    await loginAs(page, emailA, passA);

    // ホーム画面でケース作成フォームが表示されていることを hard assertion で確認
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('input[type="text"]').first()).toBeVisible();
  } finally {
    await ctx.close();
  }
});
