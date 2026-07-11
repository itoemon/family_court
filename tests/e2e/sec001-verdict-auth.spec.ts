import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// ────────────────────────────────────────────────────────────
// SEC-001 / SEC-003: 判決ルート（/api/cases/[id]/verdict）の認可と二重生成防止。
// 未認証/第三者は弾く・参加者のみ生成・TOCTOU で二重生成しないことを検証。
// requestVerdict は TEST_MODE=1 でモックされるため実 Claude は叩かない。
// admin fast-path + 専用 ephemeral ユーザー（bug005/mon001b と同方針）。
// ────────────────────────────────────────────────────────────

test.beforeEach(() => {
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) test.skip(true, `必須環境変数が未設定: ${missing.join(', ')}`);
});

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  );
}
type Admin = ReturnType<typeof createAdminClient>;

async function createEphemeralUser(admin: Admin, label: string) {
  const email = `e2e_sec001_${label}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}@example.com`;
  const password = 'E2eSec001Test123!';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data?.user) throw new Error(`ephemeral user 作成に失敗 (${label}): ${error?.message}`);
  return { email, password, id: data.user.id };
}

// phase=judging のケースを admin で作る。uses_service_key=true にして
// resolveCaseAiKey がサービスキー（.env.test の SERVICE_ANTHROPIC_API_KEY）で解決するようにする。
async function createJudgingCase(admin: Admin, plaintiffId: string, defendantId: string) {
  const { data, error } = await admin
    .from('cases')
    .insert({
      topic: 'SEC-001 判決認可テスト',
      plaintiff_id: plaintiffId,
      defendant_id: defendantId,
      phase: 'judging',
      uses_service_key: true,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`judging ケース作成に失敗: ${error?.message}`);
  const caseId = data.id as string;
  await admin.from('arguments').insert([
    { case_id: caseId, role: 'plaintiff', phase: 'argument', round: 1, content: '原告の主張', is_greeting: false },
    { case_id: caseId, role: 'defendant', phase: 'argument', round: 1, content: '被告の主張', is_greeting: false },
  ]);
  return caseId;
}

async function getPhase(admin: Admin, caseId: string): Promise<string> {
  const { data } = await admin.from('cases').select('phase').eq('id', caseId).single();
  return (data?.phase as string) ?? '';
}
async function countVerdicts(admin: Admin, caseId: string): Promise<number> {
  const { count } = await admin.from('verdicts').select('id', { count: 'exact', head: true }).eq('case_id', caseId);
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

async function cleanup(admin: Admin, caseId: string, userIds: string[]) {
  await admin.from('cases').delete().eq('id', caseId); // arguments/verdicts は ON DELETE CASCADE
  for (const uid of userIds) await admin.auth.admin.deleteUser(uid).catch(() => {});
}

// ── 1. 未認証は弾かれ、判決は生成されない ──────────────────
test('SEC-001: 未認証の verdict POST は 401 で判決が生成されない', async ({ request }) => {
  const admin = createAdminClient();
  const plaintiff = await createEphemeralUser(admin, 'p1');
  const defendant = await createEphemeralUser(admin, 'd1');
  const caseId = await createJudgingCase(admin, plaintiff.id, defendant.id);
  try {
    const res = await request.post(`/api/cases/${caseId}/verdict`);
    expect(res.status()).toBe(401);
    expect(await countVerdicts(admin, caseId)).toBe(0);
    expect(await getPhase(admin, caseId)).toBe('judging');
  } finally {
    await cleanup(admin, caseId, [plaintiff.id, defendant.id]);
  }
});

// ── 2. 第三者（非参加者）は 403 ─────────────────────────────
test('SEC-001: 非参加者の認証ユーザーは 403 で判決が生成されない', async ({ browser }) => {
  const admin = createAdminClient();
  const plaintiff = await createEphemeralUser(admin, 'p2');
  const defendant = await createEphemeralUser(admin, 'd2');
  const stranger = await createEphemeralUser(admin, 'x2');
  const caseId = await createJudgingCase(admin, plaintiff.id, defendant.id);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await loginAs(page, stranger.email, stranger.password);
    const res = await page.request.post(`/api/cases/${caseId}/verdict`);
    expect(res.status()).toBe(403);
    expect(await countVerdicts(admin, caseId)).toBe(0);
    expect(await getPhase(admin, caseId)).toBe('judging');
  } finally {
    await ctx.close();
    await cleanup(admin, caseId, [plaintiff.id, defendant.id, stranger.id]);
  }
});

// ── 3. 参加者（原告）は成功し判決が生成される ──────────────
test('SEC-001: 参加者（原告）の verdict POST は 200 で判決が生成され phase=verdict', async ({ browser }) => {
  const admin = createAdminClient();
  const plaintiff = await createEphemeralUser(admin, 'p3');
  const defendant = await createEphemeralUser(admin, 'd3');
  const caseId = await createJudgingCase(admin, plaintiff.id, defendant.id);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await loginAs(page, plaintiff.email, plaintiff.password);
    const res = await page.request.post(`/api/cases/${caseId}/verdict`);
    expect(res.status()).toBe(200);
    expect(await countVerdicts(admin, caseId)).toBe(1);
    expect(await getPhase(admin, caseId)).toBe('verdict');
  } finally {
    await ctx.close();
    await cleanup(admin, caseId, [plaintiff.id, defendant.id]);
  }
});

// ── 4. 二重生成防止（TOCTOU）: 2 回目は 409、判決は 1 つだけ ──
test('SEC-001: 同一ケースへの連続 verdict POST は 1 回のみ生成され 2 回目は 409', async ({ browser }) => {
  const admin = createAdminClient();
  const plaintiff = await createEphemeralUser(admin, 'p4');
  const defendant = await createEphemeralUser(admin, 'd4');
  const caseId = await createJudgingCase(admin, plaintiff.id, defendant.id);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await loginAs(page, plaintiff.email, plaintiff.password);
    const first = await page.request.post(`/api/cases/${caseId}/verdict`);
    const second = await page.request.post(`/api/cases/${caseId}/verdict`);
    expect(first.status()).toBe(200);
    expect(second.status()).toBe(409); // フェーズ奪取済み
    expect(await countVerdicts(admin, caseId)).toBe(1); // 二重生成なし
  } finally {
    await ctx.close();
    await cleanup(admin, caseId, [plaintiff.id, defendant.id]);
  }
});

// ── 5. 二重生成防止（TOCTOU・並行）: 同時 2 リクエストでも片方だけが奪取し判決は 1 つ ──
// 逐次版（テスト4）は 2 回目が早期ガード phase!=="judging" で 409 になり原子的条件付き更新の
// 並行経路を踏まない。ここでは Promise.all で同時発射し、条件付き更新（judging→verdict）の
// 競合を実際に踏ませて「片方 200・片方 409・判決 1 つ」を実証する（SEC-001 監査 LOW-002）。
test('SEC-001: 同時 2 リクエストの verdict POST は片方のみ生成され他方は 409', async ({ browser }) => {
  const admin = createAdminClient();
  const plaintiff = await createEphemeralUser(admin, 'p5');
  const defendant = await createEphemeralUser(admin, 'd5');
  const caseId = await createJudgingCase(admin, plaintiff.id, defendant.id);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await loginAs(page, plaintiff.email, plaintiff.password);
    const [a, b] = await Promise.all([
      page.request.post(`/api/cases/${caseId}/verdict`),
      page.request.post(`/api/cases/${caseId}/verdict`),
    ]);
    const statuses = [a.status(), b.status()].sort();
    expect(statuses).toEqual([200, 409]); // 片方だけが奪取
    expect(await countVerdicts(admin, caseId)).toBe(1); // 二重生成なし
    expect(await getPhase(admin, caseId)).toBe('verdict');
  } finally {
    await ctx.close();
    await cleanup(admin, caseId, [plaintiff.id, defendant.id]);
  }
});
