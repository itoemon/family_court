import { test, expect } from '@playwright/test';

/**
 * FEAT-MIDDLEWARE-NEXT: middleware の保護パス → /auth/login リダイレクトに ?next= 付与
 * 2026-06-15 実装テスト
 *
 * 修正内容：
 * 1. middleware.ts:37-39 の redirect を変更
 * 2. pathname + request.nextUrl.search を next パラメータに格納
 * 3. searchParams.set() による自動URLエンコード
 */

test.beforeEach(() => {
  const required = ['E2E_TEST_EMAIL_A', 'E2E_TEST_PASSWORD_A'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    test.skip(true, `必須環境変数が未設定: ${missing.join(', ')}`);
  }
});

// ===== テストケース =====

// FEAT-MIDDLEWARE-NEXT-1: 基本動作 - 未認証で /history にアクセス → /auth/login?next=... に変わる
test('FEAT-MIDDLEWARE-NEXT-1: 未認証で保護パスにアクセス → middleware が /auth/login?next=... にリダイレクト', async ({ page }) => {
  // ログイン状態ではない状態で保護パス /history にアクセス
  await page.goto('/history', { waitUntil: 'networkidle' });

  // middleware により /auth/login にリダイレクトされることを確認
  const url = page.url();
  expect(url).toMatch(/\/auth\/login\?next=/);

  // next パラメータに /history が含まれていることを確認（%エンコード済みでも OK）
  expect(url).toMatch(/%2Fhistory|\/history/);
});

// FEAT-MIDDLEWARE-NEXT-2: クエリ保持 - 未認証で /history?filter=verdict にアクセス → next に元クエリも含まれる
test('FEAT-MIDDLEWARE-NEXT-2: 未認証で保護パス＋クエリにアクセス → next パラメータに元クエリも保持', async ({ page }) => {
  // ログイン状態ではない状態で保護パス＋クエリでアクセス
  await page.goto('/history?filter=verdict', { waitUntil: 'networkidle' });

  // middleware により /auth/login にリダイレクトされることを確認
  const url = page.url();
  expect(url).toMatch(/\/auth\/login\?next=/);

  // next パラメータに /history?filter=verdict が含まれていることを確認
  // URLエンコードされた形式でも確認可能（%3D = "=" にエンコード）
  const match = url.match(/next=([^&]*)/);
  expect(match).toBeTruthy();
  const nextValue = match![1];
  // URLエンコードを復号化
  const decodedNext = decodeURIComponent(nextValue);
  expect(decodedNext).toMatch(/\/history\?filter=verdict/);
});

// FEAT-MIDDLEWARE-NEXT-3: ログイン後復帰 - ログイン後に元の保護パスに戻る
test('FEAT-MIDDLEWARE-NEXT-3: ログイン後に元の保護パスに正しく戻る', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;

  // ログイン状態ではない状態で保護パスにアクセス → /auth/login?next=/history にリダイレクト
  await page.goto('/history', { waitUntil: 'networkidle' });
  const initialUrl = page.url();
  expect(initialUrl).toMatch(/\/auth\/login\?next=/);

  // ログイン実行
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
  await page.fill('input[type="email"]', emailA);
  await page.fill('input[type="password"]', passA);
  await page.click('button[type="submit"]');

  // /history に遷移することを確認
  await page.waitForURL(/\/history/, { timeout: 15_000 });
  const finalUrl = page.url();
  expect(finalUrl).toMatch(/\/history/);
  // ?next= がクエリパラメータとして含まれていないことを確認（デコード済み）
  expect(finalUrl).not.toMatch(/next=/);
});

// FEAT-MIDDLEWARE-NEXT-4: クエリ保持でのログイン後復帰
test('FEAT-MIDDLEWARE-NEXT-4: クエリ付きパスでログイン後、元のクエリも保持して復帰する', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;

  // ログイン状態ではない状態で保護パス＋クエリでアクセス
  await page.goto('/history?filter=verdict', { waitUntil: 'networkidle' });

  // ログイン実行
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
  await page.fill('input[type="email"]', emailA);
  await page.fill('input[type="password"]', passA);
  await page.click('button[type="submit"]');

  // /history?filter=verdict に遷移することを確認
  await page.waitForURL(/\/history/, { timeout: 15_000 });
  const finalUrl = page.url();
  expect(finalUrl).toMatch(/\/history\?filter=verdict/);
});

// FEAT-MIDDLEWARE-NEXT-5: リグレッション - BUG-007-1 確認（直接ログイン → / 遷移）
test('FEAT-MIDDLEWARE-NEXT-5: リグレッション - /auth/login を直接開いてログイン時は / に遷移', async ({ page }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;

  // middleware を経由せず /auth/login を直接開く（next パラメータなし）
  await page.goto('/auth/login');
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });

  // ログイン
  await page.fill('input[type="email"]', emailA);
  await page.fill('input[type="password"]', passA);
  await page.click('button[type="submit"]');

  // ホームページ / に遷移することを確認（BUG-007-1 の動作が引き続き有効）
  await page.waitForURL('/', { timeout: 15_000 });
  const url = page.url();
  expect(url).toMatch(/^http:\/\/localhost:3000\/(\?.*)?$/);
});
