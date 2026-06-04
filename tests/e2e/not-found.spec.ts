import { test, expect } from '@playwright/test';

// ────────────────────────────────────────────────────────────
// app/not-found.tsx の回帰防止
// 認証・DB に依存しない純粋な URL ルーティング検査のため env チェック不要
// ────────────────────────────────────────────────────────────

test('NOT-FOUND-001: 存在しない URL でカスタム not-found UI が表示される', async ({ page }) => {
  await page.goto('/this-route-does-not-exist');

  // ブランドトーンの 404 見出し（Next デフォルトの "404" 表記ではない）
  await expect(page.locator('h1:has-text("ページが見つかりません")')).toBeVisible();

  // ホームへの導線
  await expect(page.locator('a[href="/"]:has-text("ホームに戻る")')).toBeVisible();
});

test('NOT-FOUND-002: 不正な UUID 形式のケース ID で not-found UI が表示される', async ({ page }) => {
  // /case/[id] の isUuid ガードで notFound() が呼ばれる経路
  await page.goto('/case/not-a-uuid');

  await expect(page.locator('h1:has-text("ページが見つかりません")')).toBeVisible();
});
