import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createCipheriv, randomBytes } from 'crypto';

// ────────────────────────────────────────────────────────────
// SEC-002: AI ルートのレート制限（第 1 層）とサービスキーケースの生成上限（第 2 層）。
// - 第 1 層: 全 AI ルート横断 20 req/分/識別子（超過 429）。
// - 第 2 層: uses_service_key=true のケースに累積 30 生成/ケースの原子的上限（超過 429・Claude 呼ばない）。
// generateDefenseResponse は TEST_MODE=1 でモックされるため実 Anthropic は叩かない。
// admin fast-path + 専用 ephemeral ユーザー（sec001/mon001 と同方針）。
//
// テスト設計の要点: 第 1 層(20/分) は第 2 層(30/ケース) より先に効くため、cap の検証は
// admin で cases.service_ai_calls を境界値に seed して行う（30 回リクエストを撃つと第 1 層に
// 先に当たるため）。並行テストも同様に cap-1 へ seed してから並行発射する。
// ────────────────────────────────────────────────────────────

test.beforeEach(() => {
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'ENCRYPTION_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) test.skip(true, `必須環境変数が未設定: ${missing.join(', ')}`);
  // defense POST は TEST_MODE でモックしないと実 Anthropic を叩く（コスト/不安定化）。
  if (process.env.TEST_MODE !== '1') test.skip(true, 'TEST_MODE=1 が未設定（実 Anthropic 回避のため skip）');
});

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  );
}
type Admin = ReturnType<typeof createAdminClient>;

// lib/crypto.ts:encryptApiKey と同一形式 (aes-256-gcm, `iv:authTag:encrypted` hex)。
function encryptApiKeyForTest(apiKey: string): string {
  const hex = process.env.ENCRYPTION_KEY!;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('ENCRYPTION_KEY は 32 バイト hex (64 桁) である必要があります');
  const key = Buffer.from(hex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

async function createEphemeralUser(admin: Admin, label: string) {
  const email = `e2e_sec002_${label}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}@example.com`;
  const password = 'E2eSec002Test123!';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data?.user) throw new Error(`ephemeral user 作成に失敗 (${label}): ${error?.message}`);
  return { email, password, id: data.user.id };
}

// AI 実行が可能なケースを admin で作る。usesServiceKey=true でサービスキー経路、
// false（BYOK）なら原告に有効な暗号化キーを SET する。serviceAiCalls を境界値に seed できる。
async function createCase(
  admin: Admin,
  plaintiffId: string,
  defendantId: string,
  opts: { usesServiceKey: boolean; serviceAiCalls?: number }
) {
  if (!opts.usesServiceKey) {
    const { error: keyErr } = await admin
      .from('profiles')
      .update({ api_key_encrypted: encryptApiKeyForTest('sk-ant-e2e-dummy') })
      .eq('id', plaintiffId);
    if (keyErr) throw new Error(`BYOK キー SET に失敗: ${keyErr.message}`);
  }
  const { data, error } = await admin
    .from('cases')
    .insert({
      topic: 'SEC-002 レート制限テスト',
      plaintiff_id: plaintiffId,
      defendant_id: defendantId,
      phase: 'argument',
      uses_service_key: opts.usesServiceKey,
      service_ai_calls: opts.serviceAiCalls ?? 0,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`ケース作成に失敗: ${error?.message}`);
  return data.id as string;
}

async function getServiceAiCalls(admin: Admin, caseId: string): Promise<number> {
  const { data } = await admin.from('cases').select('service_ai_calls').eq('id', caseId).single();
  return (data?.service_ai_calls as number) ?? -1;
}

async function countAssistantMessages(admin: Admin, caseId: string): Promise<number> {
  const { count } = await admin
    .from('defense_messages')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId)
    .eq('role', 'assistant');
  return count ?? 0;
}

async function loginAs(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/auth/login');
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/', { timeout: 15_000 });
}

async function cleanup(admin: Admin, caseId: string | null, userIds: string[]) {
  if (caseId) await admin.from('cases').delete().eq('id', caseId); // 子テーブルは ON DELETE CASCADE
  for (const uid of userIds) await admin.auth.admin.deleteUser(uid).catch(() => {});
}

function postDefense(page: import('@playwright/test').Page, caseId: string, content: string) {
  return page.request.post(`/api/cases/${caseId}/defense`, { data: { content } });
}

// ── 1. 第 1 層: 20/分 を超えると 429（Too Many Requests）──────────────────────
// 第 1 層は Upstash が実効な環境でのみ検証できる。テスト env は UPSTASH_* が未設定
// （＝設計上フォールバックでスキップ素通し）のため、その場合は本テストを skip する。
// money を守る第 2 層は DB（consume_service_ai_call）で担保され Upstash に依存しない（Test 2-4 で検証）。
test('SEC-002: AI ルートは 20 req/分/識別子を超えると 429（第 1 層レート制限）', async ({ browser }) => {
  const upstashConfigured = !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;
  test.skip(!upstashConfigured, 'UPSTASH_* 未設定（第 1 層はフォールバックで無効）のため skip');
  const admin = createAdminClient();
  const plaintiff = await createEphemeralUser(admin, 'rl_p');
  const defendant = await createEphemeralUser(admin, 'rl_d');
  // service-key ケース（cap=30 に対し 21 リクエストは第 2 層に当たらず、第 1 層 20/分で先に弾かれる）。
  const caseId = await createCase(admin, plaintiff.id, defendant.id, { usesServiceKey: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await loginAs(page, plaintiff.email, plaintiff.password);
    let firstStatus = 0;
    let blocked: Awaited<ReturnType<typeof postDefense>> | null = null;
    for (let i = 0; i < 21; i++) {
      const res = await postDefense(page, caseId, `主張 ${i}`);
      if (i === 0) firstStatus = res.status();
      if (res.status() === 429) { blocked = res; break; }
    }
    expect(firstStatus).toBe(200); // 1 回目は通る
    expect(blocked, '21 回以内に第 1 層 429 で弾かれるはず').not.toBeNull();
    expect(blocked!.status()).toBe(429);
    const body = await blocked!.json();
    expect(body.error).toBe('Too Many Requests'); // 第 1 層（第 2 層は別メッセージ）
    expect(blocked!.headers()['retry-after']).toBeTruthy();
  } finally {
    await ctx.close();
    await cleanup(admin, caseId, [plaintiff.id, defendant.id]);
  }
});

// ── 2. 第 2 層: service-key ケースは 30 生成で頭打ち、31 回目は 429・Claude 呼ばない ──
test('SEC-002: service-key ケースは cap(30) 到達で 429・生成されない（第 2 層）', async ({ browser }) => {
  const admin = createAdminClient();
  const plaintiff = await createEphemeralUser(admin, 'cap_p');
  const defendant = await createEphemeralUser(admin, 'cap_d');
  // 第 1 層(20/分)を避けるため cap 直前(29)へ seed。POST 2 回で境界(30→31)を検証。
  const caseId = await createCase(admin, plaintiff.id, defendant.id, { usesServiceKey: true, serviceAiCalls: 29 });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await loginAs(page, plaintiff.email, plaintiff.password);
    const ok = await postDefense(page, caseId, '30 回目の生成');
    expect(ok.status()).toBe(200);
    expect(await getServiceAiCalls(admin, caseId)).toBe(30); // 29→30

    const assistantsBefore = await countAssistantMessages(admin, caseId);
    const over = await postDefense(page, caseId, '31 回目（上限超）');
    expect(over.status()).toBe(429);
    expect((await over.json()).error).toBe('このケースのAI生成回数の上限に達しました'); // 第 2 層
    expect(await getServiceAiCalls(admin, caseId)).toBe(30); // 30 で頭打ち（31 にならない）
    expect(await countAssistantMessages(admin, caseId)).toBe(assistantsBefore); // Claude 呼ばれず assistant 増えない
  } finally {
    await ctx.close();
    await cleanup(admin, caseId, [plaintiff.id, defendant.id]);
  }
});

// ── 3. 原子性: cap 直前へ並行発射しても cap を超えない ──────────────────────
test('SEC-002: cap 直前への並行 POST でも service_ai_calls は cap を超えない（原子性）', async ({ browser }) => {
  const admin = createAdminClient();
  const plaintiff = await createEphemeralUser(admin, 'atom_p');
  const defendant = await createEphemeralUser(admin, 'atom_d');
  // cap-1(29) へ seed → 並行 5 発射。原子的 consume なら 1 発だけ成功(30)、残り 4 は 429。
  const caseId = await createCase(admin, plaintiff.id, defendant.id, { usesServiceKey: true, serviceAiCalls: 29 });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await loginAs(page, plaintiff.email, plaintiff.password);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => postDefense(page, caseId, `並行 ${i}`))
    );
    const statuses = results.map((r) => r.status());
    const ok = statuses.filter((s) => s === 200).length;
    const capped = statuses.filter((s) => s === 429).length;
    expect(ok).toBe(1); // 原子的 consume で 1 発だけが 29→30 を奪取
    expect(capped).toBe(4); // 残りは cap 到達で 429
    expect(await getServiceAiCalls(admin, caseId)).toBe(30); // cap を超えない（34 にならない）
  } finally {
    await ctx.close();
    await cleanup(admin, caseId, [plaintiff.id, defendant.id]);
  }
});

// ── 4. BYOK は第 2 層の対象外（consume されない）──────────────────────────
test('SEC-002: BYOK ケースは service_ai_calls を消費しない（第 2 層は service-key のみ）', async ({ browser }) => {
  const admin = createAdminClient();
  const plaintiff = await createEphemeralUser(admin, 'byok_p');
  const defendant = await createEphemeralUser(admin, 'byok_d');
  const caseId = await createCase(admin, plaintiff.id, defendant.id, { usesServiceKey: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await loginAs(page, plaintiff.email, plaintiff.password);
    for (let i = 0; i < 3; i++) {
      const res = await postDefense(page, caseId, `BYOK ${i}`);
      expect(res.status()).toBe(200);
    }
    // consume は uses_service_key=true のみ。BYOK では一切カウントされない。
    expect(await getServiceAiCalls(admin, caseId)).toBe(0);
  } finally {
    await ctx.close();
    await cleanup(admin, caseId, [plaintiff.id, defendant.id]);
  }
});
