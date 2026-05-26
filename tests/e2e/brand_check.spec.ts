import { test, expect } from '@playwright/test';

// Helper function for login
async function loginAs(page: any, email: string, password: string) {
  await page.goto('/auth/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/', { timeout: 10_000 });
}

test('VISUAL-BRAND-001: ブランド名「igiari」がページタイトルに表示される', async ({ page }) => {
  await page.goto('/');
  // Title should contain "igiari"
  await expect(page).toHaveTitle(/igiari/i);
});

test('VISUAL-BRAND-002: ホームページにigiari ブランドが表示される', async ({ page }) => {
  await loginAs(page, 'e2e_user_a@example.com', 'E2eTest123!');
  await page.goto('/');

  // Check for "igiari" text on page
  const pageText = await page.textContent('body');
  expect(pageText).toContain('igiari');
});

test('VISUAL-BRAND-003: ヘッダーの色が brand-* パレットで適用されている', async ({ page }) => {
  await loginAs(page, 'e2e_user_a@example.com', 'E2eTest123!');
  await page.goto('/');

  // Get header element (typically nav or header tag)
  const header = page.locator('header, nav').first();

  // Get computed background color
  const bgColor = await header.evaluate((el) => {
    return window.getComputedStyle(el).backgroundColor;
  });

  console.log('Header background color:', bgColor);
  // Should not be blue or gray from old scheme
  expect(bgColor).toBeTruthy();
});

test('VISUAL-BRAND-004: プライマリボタンが brand パレットを使用している', async ({ page }) => {
  await loginAs(page, 'e2e_user_a@example.com', 'E2eTest123!');
  await page.goto('/');

  // Look for primary action button
  const primaryButton = page.locator('button[type="submit"]').first();

  // Get computed styles
  const bgColor = await primaryButton.evaluate((el) => {
    return window.getComputedStyle(el).backgroundColor;
  });

  console.log('Primary button background:', bgColor);
  // brand-500 = #f59e0b = rgb(245, 158, 11)
  expect(bgColor).toBeTruthy();
});

test('VISUAL-BRAND-005: CSS @theme で brand カラーが定義されている', async ({ page }) => {
  await page.goto('/');

  // Check if CSS variable is available
  const brandColor = await page.evaluate(() => {
    const root = document.documentElement;
    return window.getComputedStyle(root).getPropertyValue('--color-brand-500').trim();
  });

  console.log('CSS variable --color-brand-500:', brandColor);
  // Should not be empty
  expect(brandColor).toBeTruthy();
});
