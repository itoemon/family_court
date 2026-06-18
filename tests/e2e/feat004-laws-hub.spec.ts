import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// ────────────────────────────────────────────────────────────
// 環境変数チェック
// ────────────────────────────────────────────────────────────

test.beforeEach(() => {
  const required = [
    'E2E_TEST_EMAIL_A',
    'E2E_TEST_EMAIL_B',
    'E2E_TEST_PASSWORD_A',
    'E2E_TEST_PASSWORD_B',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    test.skip(true, `必須環境変数が未設定: ${missing.join(', ')}`);
  }
});

// ────────────────────────────────────────────────────────────
// Supabase 管理クライアント（DB 状態の直接検証用）
// ────────────────────────────────────────────────────────────

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  );
}

// ────────────────────────────────────────────────────────────
// ヘルパー
// ────────────────────────────────────────────────────────────

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/auth/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("ログイン")');
  await page.waitForURL('/', { timeout: 10_000 });
}

async function createLaw(page: Page, name: string, article: string): Promise<string> {
  await page.goto('/laws/new');
  await page.locator('form input[type="text"]').first().fill(name);
  await page.locator('form textarea').first().fill(article);
  await page.click('button:has-text("法律を作る")');
  await page.waitForURL(/\/laws\/[a-f0-9-]{36}/, { timeout: 15_000 });
  const url = page.url().split('?')[0];
  const id = url.split('/laws/')[1];
  return id;
}

// /laws/[id] のオーナー分岐で Hub 公開トグルを ON にする
async function publishLaw(page: Page, lawId: string) {
  await page.goto(`/laws/${lawId}`);
  const toggleBtn = page.locator('button:has-text("Hub に公開する")');
  await expect(toggleBtn).toBeVisible({ timeout: 5_000 });
  await toggleBtn.click();
  // router.refresh() 後に「公開中」バッジが出る
  await expect(page.locator('text=公開中')).toBeVisible({ timeout: 5_000 });
}

const uniq = () => Date.now().toString(36);

// ────────────────────────────────────────────────────────────
// FEAT-004-E01: 公開トグル → Hub 出現 → インポート → 元法律不変
// ────────────────────────────────────────────────────────────

test('FEAT-004-E01: 公開・Hub出現・インポート・元法律不変', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const emailB = process.env.E2E_TEST_EMAIL_B!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;
  const passB = process.env.E2E_TEST_PASSWORD_B!;

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const db = admin();

  const lawName = `Hub公開テスト_${uniq()}`;
  const article = 'これは公開される条文です。';

  try {
    // A が法律を作成して公開
    await loginAs(pageA, emailA, passA);
    const lawId = await createLaw(pageA, lawName, article);
    await publishLaw(pageA, lawId);

    // DB で is_public=true を確認
    const { data: published } = await db
      .from('laws')
      .select('id, name, article, owner_id, is_public')
      .eq('id', lawId)
      .single();
    expect(published?.is_public).toBe(true);
    const ownerA = published!.owner_id;

    // B がログインして Hub で公開法律を確認
    await loginAs(pageB, emailB, passB);
    await pageB.goto('/laws/hub');
    await expect(pageB.locator(`text=${lawName}`)).toBeVisible({ timeout: 10_000 });

    // B が Hub からインポート → 新規法律詳細へ遷移
    const card = pageB.locator('li', { hasText: lawName }).first();
    await card.locator('button:has-text("インポート")').click();
    await pageB.waitForURL(/\/laws\/[a-f0-9-]{36}/, { timeout: 15_000 });
    const newId = pageB.url().split('?')[0].split('/laws/')[1];
    expect(newId).not.toBe(lawId);

    // 新規法律: name/article 一致・owner=B（≠A）・is_public=false
    const { data: cloned } = await db
      .from('laws')
      .select('id, name, article, owner_id, is_public')
      .eq('id', newId)
      .single();
    expect(cloned?.name).toBe(lawName);
    expect(cloned?.article).toBe(article);
    expect(cloned?.is_public).toBe(false);
    expect(cloned?.owner_id).not.toBe(ownerA);

    // インポーターがメンバーとして登録されている
    const { data: newMembers } = await db
      .from('law_members')
      .select('user_id')
      .eq('law_id', newId);
    expect((newMembers ?? []).some(m => m.user_id === cloned!.owner_id)).toBe(true);

    // 元法律は不変（owner・name・article・is_public が変わらず、行は 1 つ）
    const { data: original } = await db
      .from('laws')
      .select('id, name, article, owner_id, is_public')
      .eq('id', lawId)
      .single();
    expect(original).toEqual(published);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ────────────────────────────────────────────────────────────
// FEAT-004-E02: 非公開は Hub 非出現 / 非公開化で消える
// ────────────────────────────────────────────────────────────

test('FEAT-004-E02: 非公開は非出現・非公開化で消える', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const emailB = process.env.E2E_TEST_EMAIL_B!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;
  const passB = process.env.E2E_TEST_PASSWORD_B!;

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const privateName = `非公開テスト_${uniq()}`;
  const togglingName = `公開撤回テスト_${uniq()}`;

  try {
    await loginAs(pageA, emailA, passA);
    // 非公開のまま放置する法律
    await createLaw(pageA, privateName, '非公開条文');
    // いったん公開してから非公開に戻す法律
    const togglingId = await createLaw(pageA, togglingName, '撤回される条文');
    await publishLaw(pageA, togglingId);

    // B の Hub: 非公開法律は出ない、公開法律は出る
    await loginAs(pageB, emailB, passB);
    await pageB.goto('/laws/hub');
    await expect(pageB.locator(`text=${togglingName}`)).toBeVisible({ timeout: 10_000 });
    await expect(pageB.locator(`text=${privateName}`)).toHaveCount(0);

    // A が公開を撤回
    await pageA.goto(`/laws/${togglingId}`);
    const unpublishBtn = pageA.locator('button:has-text("非公開にする")');
    await expect(unpublishBtn).toBeVisible({ timeout: 5_000 });
    await unpublishBtn.click();
    await expect(pageA.locator('text=非公開')).toBeVisible({ timeout: 5_000 });

    // B の Hub から消える
    await pageB.goto('/laws/hub');
    await expect(pageB.locator(`text=${togglingName}`)).toHaveCount(0);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ────────────────────────────────────────────────────────────
// FEAT-004-E03: 認可（非オーナーの visibility PATCH=403 / 非公開 import=403）
// ────────────────────────────────────────────────────────────

test('FEAT-004-E03: 認可境界', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const emailB = process.env.E2E_TEST_EMAIL_B!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;
  const passB = process.env.E2E_TEST_PASSWORD_B!;

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const privateName = `認可テスト非公開_${uniq()}`;

  try {
    // A が非公開法律を作成
    await loginAs(pageA, emailA, passA);
    const lawId = await createLaw(pageA, privateName, '認可テスト条文');

    // B（非オーナー）はログイン
    await loginAs(pageB, emailB, passB);

    // 非オーナーが visibility を変更 → 403
    const patchRes = await pageB.request.patch(`/api/laws/${lawId}/visibility`, {
      data: { is_public: true },
    });
    expect(patchRes.status()).toBe(403);

    // 非公開法律を import → 403
    const importRes = await pageB.request.post(`/api/laws/${lawId}/import`);
    expect(importRes.status()).toBe(403);

    // 念のため元法律が非公開のままであることを確認
    const { data: law } = await admin()
      .from('laws')
      .select('is_public')
      .eq('id', lawId)
      .single();
    expect(law?.is_public).toBe(false);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
