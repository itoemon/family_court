import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createCipheriv, randomBytes } from 'crypto';

// ────────────────────────────────────────────────────────────
// MON-001 PR-A: クレジット基盤の E2E
//
// bug005-closing-trigger.spec.ts の「admin client fast-path + 専用 ephemeral ユーザー」
// パターンを踏襲する。UI に依存せず、専用ユーザーをセッション付き REST 呼び出し
// (page.request) で駆動し、DB を admin で検査する。TEST_MODE=1 のモック生成で実
// Anthropic を回避する（クレジット消費・uses_service_key の DB 挙動が検証対象）。
//
// 検証:
//   1. BYOK ユーザー          → 消費なし (credits 不変) / uses_service_key=false
//   2. 非 BYOK かつ残高あり   → 1 消費 (3→2) / uses_service_key=true
//   3. 非 BYOK かつ残高 0     → 402 / ケース未作成 / 残高 0 のまま
//   4. 新規ユーザー           → credits=3 (カラム default による無料付与)
// ────────────────────────────────────────────────────────────

test.beforeEach(() => {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    // BYOK ケースで api_key_encrypted を暗号化して seed するために必要。
    'ENCRYPTION_KEY',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    test.skip(true, `必須環境変数が未設定: ${missing.join(', ')}`);
  }
});

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SECRET_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// lib/crypto.ts:encryptApiKey と同一形式 (aes-256-gcm, `iv:authTag:encrypted` hex)。
// spec は @/ alias を使わない方針のためインライン実装する。
function encryptApiKeyForTest(apiKey: string): string {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) throw new Error('ENCRYPTION_KEY が未設定です');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('ENCRYPTION_KEY は 32 バイト hex (64 桁) である必要があります');
  }
  const key = Buffer.from(hex, 'hex');
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

type Admin = ReturnType<typeof createAdminClient>;

// 専用 ephemeral ユーザーを作成し、そのメール/パスワード/ID を返す。
// handle_new_user トリガが profile を自動生成する（credits は default 3）。
async function createEphemeralUser(admin: Admin, label: string) {
  const email = `e2e_mon001_${label}_${Date.now()}_${randomBytes(4).toString('hex')}@example.com`;
  const password = 'E2eMon001Test123!';
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data?.user) {
    throw new Error(`ephemeral user 作成に失敗 (${label}): ${error?.message}`);
  }
  return { email, password, id: data.user.id };
}

async function getCredits(admin: Admin, userId: string): Promise<number | null> {
  const { data, error } = await admin
    .from('profiles')
    .select('credits')
    .eq('id', userId)
    .single();
  if (error) throw new Error(`credits SELECT 失敗: ${error.message}`);
  return data?.credits ?? null;
}

// UI ログインヘルパー（セッション cookie を得るため）。page.request がその cookie を使う。
async function loginAs(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/auth/login');
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/', { timeout: 15_000 });
}

// ────────────────────────────────────────────────────────────
// 1. 新規ユーザーの credits=3（カラム default による無料付与）
// ────────────────────────────────────────────────────────────
test('MON-001: 新規ユーザーの credits が 3（無料付与）', async () => {
  const admin = createAdminClient();
  const user = await createEphemeralUser(admin, 'freegrant');
  try {
    const credits = await getCredits(admin, user.id);
    expect(credits).toBe(3);
  } finally {
    await admin.auth.admin.deleteUser(user.id);
  }
});

// ────────────────────────────────────────────────────────────
// 2. BYOK ユーザー: ケース作成で消費なし / uses_service_key=false
// ────────────────────────────────────────────────────────────
test('MON-001: BYOK ユーザーはケース作成で消費されず uses_service_key=false', async ({ browser }) => {
  const admin = createAdminClient();
  const user = await createEphemeralUser(admin, 'byok');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let caseId: string | undefined;
  try {
    // api_key_encrypted を SET（BYOK）。
    const { error: keyErr } = await admin
      .from('profiles')
      .update({ api_key_encrypted: encryptApiKeyForTest('sk-ant-e2e-dummy') })
      .eq('id', user.id);
    if (keyErr) throw new Error(`api_key SET 失敗: ${keyErr.message}`);

    const before = await getCredits(admin, user.id);
    expect(before).toBe(3);

    await loginAs(page, user.email, user.password);
    const resp = await page.request.post('/api/cases', {
      data: { topic: 'MON-001 BYOK 消費なし' },
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();
    caseId = created.id;

    // 消費されていない
    const after = await getCredits(admin, user.id);
    expect(after).toBe(3);

    // uses_service_key=false
    const { data: caseRow } = await admin
      .from('cases')
      .select('uses_service_key')
      .eq('id', caseId!)
      .single();
    expect(caseRow?.uses_service_key).toBe(false);
  } finally {
    if (caseId) await admin.from('cases').delete().eq('id', caseId);
    await admin.auth.admin.deleteUser(user.id);
    await ctx.close();
  }
});

// ────────────────────────────────────────────────────────────
// 3. 非 BYOK かつ残高あり: 1 消費 / uses_service_key=true
// ────────────────────────────────────────────────────────────
test('MON-001: 非 BYOK・残高ありはケース作成で 1 消費し uses_service_key=true', async ({ browser }) => {
  const admin = createAdminClient();
  const user = await createEphemeralUser(admin, 'consume');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let caseId: string | undefined;
  try {
    // api_key は未登録のまま（default credits=3）。
    const before = await getCredits(admin, user.id);
    expect(before).toBe(3);

    await loginAs(page, user.email, user.password);
    const resp = await page.request.post('/api/cases', {
      data: { topic: 'MON-001 非 BYOK 消費あり' },
    });
    expect(resp.status()).toBe(201);
    const created = await resp.json();
    caseId = created.id;

    // 3 → 2 に減っている
    const after = await getCredits(admin, user.id);
    expect(after).toBe(2);

    // uses_service_key=true
    const { data: caseRow } = await admin
      .from('cases')
      .select('uses_service_key')
      .eq('id', caseId!)
      .single();
    expect(caseRow?.uses_service_key).toBe(true);
  } finally {
    if (caseId) await admin.from('cases').delete().eq('id', caseId);
    await admin.auth.admin.deleteUser(user.id);
    await ctx.close();
  }
});

// ────────────────────────────────────────────────────────────
// 4. 非 BYOK かつ残高 0: 402 / ケース未作成 / 残高 0 のまま
// ────────────────────────────────────────────────────────────
test('MON-001: 非 BYOK・残高 0 は 402 でブロックされケースは作られない', async ({ browser }) => {
  const admin = createAdminClient();
  const user = await createEphemeralUser(admin, 'zero');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    // credits を 0 に落とす（admin 直更新）。
    const { error: zeroErr } = await admin
      .from('profiles')
      .update({ credits: 0 })
      .eq('id', user.id);
    if (zeroErr) throw new Error(`credits=0 更新失敗: ${zeroErr.message}`);

    await loginAs(page, user.email, user.password);
    const resp = await page.request.post('/api/cases', {
      data: { topic: 'MON-001 残高 0 ブロック' },
    });
    expect(resp.status()).toBe(402);

    // 残高は 0 のまま（誤消費していない）
    const after = await getCredits(admin, user.id);
    expect(after).toBe(0);

    // ケースが作られていない
    const { data: cases } = await admin
      .from('cases')
      .select('id')
      .eq('plaintiff_id', user.id);
    expect(cases ?? []).toHaveLength(0);
  } finally {
    // 念のため（作られていない想定だが）このユーザーのケースを掃除してから user 削除。
    await admin.from('cases').delete().eq('plaintiff_id', user.id);
    await admin.auth.admin.deleteUser(user.id);
    await ctx.close();
  }
});
