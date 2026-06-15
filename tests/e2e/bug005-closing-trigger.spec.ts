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
// Supabase 初期化
// ────────────────────────────────────────────────────────────

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SECRET_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

// ────────────────────────────────────────────────────────────
// ヘルパー関数
// ────────────────────────────────────────────────────────────

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/auth/login');
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/', { timeout: 15_000 });
}

async function createCase(page: Page, topic: string): Promise<string> {
  await page.goto('/');
  await page.fill('input[type="text"]', topic);
  await page.click('button:has-text("はじめる")');
  await page.waitForURL(/\/case\//, { timeout: 15_000 });
  return page.url().split('?')[0];
}

async function joinAsAccount(page: Page) {
  await page.click('button:has-text("アカウントでログインして参加")');
  await page.click('button:has-text("ログインして参加する")');
  await page.waitForSelector('text=さんの返答を待っています', { timeout: 10_000 });
}

// トピック URL から case ID を抽出
function extractCaseId(url: string): string {
  const match = url.match(/\/case\/([a-f0-9-]+)/);
  if (!match) throw new Error(`Invalid case URL: ${url}`);
  return match[1];
}

// ────────────────────────────────────────────────────────────
// BUG-005-1: ユーザーが最初の発言をして、データベースを検査
// argument フェーズ中は closing が生成されていないことを確認
// ────────────────────────────────────────────────────────────

test('BUG-005-1: argument フェーズ中は closing が生成されていない', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const emailB = process.env.E2E_TEST_EMAIL_B!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;
  const passB = process.env.E2E_TEST_PASSWORD_B!;

  const admin = createAdminClient();
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // ケース作成 & 被告参加
    await loginAs(pageA, emailA, passA);
    const caseUrl = await createCase(pageA, 'BUG-005-1: argument フェーズテスト');
    const caseId = extractCaseId(caseUrl);

    await loginAs(pageB, emailB, passB);
    await pageB.goto(caseUrl);
    await joinAsAccount(pageB);

    // opening フェーズ: A が発言
    await pageA.waitForSelector('textarea', { timeout: 10_000 });
    await pageA.fill('textarea', 'A: opening');
    await pageA.click('button:has-text("送る")');
    await pageA.waitForSelector('text=A: opening', { timeout: 10_000 });

    // B が返答（argument フェーズへ遷移）
    await pageB.reload();
    await pageB.waitForSelector('textarea', { timeout: 10_000 });
    await pageB.fill('textarea', 'B: response');
    await pageB.click('button:has-text("送る")');
    await pageB.waitForSelector('text=B: response', { timeout: 10_000 });

    // 検証: closing が挿入されていないことを確認（argument フェーズなので closing は出ない）
    await pageB.waitForTimeout(1_000);

    const { data: closingMessages, error } = await admin
      .from('judge_messages')
      .select('id, trigger_type')
      .eq('case_id', caseId)
      .eq('trigger_type', 'closing');

    if (error) {
      throw new Error(`Failed to query judge_messages: ${error.message}`);
    }

    expect(closingMessages).toEqual([]);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ────────────────────────────────────────────────────────────
// admin client で arguments を 3 ラウンド分注入し、cases.phase を
// extension_voting に強制遷移させる fast-path。UI でのターン制御
// (reload + waitForSelector ループ) を省略してタイムアウトを避ける。
// ────────────────────────────────────────────────────────────

async function fastSkipToExtensionVoting(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
  maxRounds: number
) {
  const rows: Array<{
    case_id: string;
    role: 'plaintiff' | 'defendant';
    phase: 'argument';
    round: number;
    content: string;
    is_greeting: false;
  }> = [];
  for (let r = 1; r <= maxRounds; r++) {
    rows.push({ case_id: caseId, role: 'plaintiff', phase: 'argument', round: r, content: `[fast] A r${r}`, is_greeting: false });
    rows.push({ case_id: caseId, role: 'defendant', phase: 'argument', round: r, content: `[fast] B r${r}`, is_greeting: false });
  }
  const { error: argErr } = await admin.from('arguments').insert(rows);
  if (argErr) throw new Error(`fastSkip arguments insert failed: ${argErr.message}`);

  const { error: caseErr } = await admin
    .from('cases')
    .update({
      phase: 'extension_voting',
      current_turn: 'plaintiff',
      end_proposed_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', caseId);
  if (caseErr) throw new Error(`fastSkip cases update failed: ${caseErr.message}`);
}

// admin で 1 ラウンド分の arguments を注入する。end-proposal は phase='argument' で
// 受理されるため、cases.phase の更新は不要。current_turn と end_proposed_by だけ
// 確実に既知状態にする。
async function fastSkipToArgumentR1(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string
) {
  const { error: argErr } = await admin.from('arguments').insert([
    { case_id: caseId, role: 'plaintiff', phase: 'argument', round: 1, content: '[fast] A r1', is_greeting: false },
    { case_id: caseId, role: 'defendant', phase: 'argument', round: 1, content: '[fast] B r1', is_greeting: false },
  ]);
  if (argErr) throw new Error(`fastSkip r1 arguments insert failed: ${argErr.message}`);

  const { error: caseErr } = await admin
    .from('cases')
    .update({ end_proposed_by: null, updated_at: new Date().toISOString() })
    .eq('id', caseId)
    .eq('phase', 'argument');
  if (caseErr) throw new Error(`fastSkip r1 cases update failed: ${caseErr.message}`);
}

// admin で judge_messages.trigger_type='closing' が 1 行 INSERT されるまで polling。
// AI 生成の完了待ち。タイムアウト時は最後の取得結果を返して上位で assert させる。
async function pollClosingJudgeMessage(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
  timeoutMs = 45_000
): Promise<Array<{ id: string; trigger_type: string; created_at: string }>> {
  const startedAt = Date.now();
  let last: Array<{ id: string; trigger_type: string; created_at: string }> = [];
  while (Date.now() - startedAt < timeoutMs) {
    const { data, error } = await admin
      .from('judge_messages')
      .select('id, trigger_type, created_at')
      .eq('case_id', caseId)
      .eq('trigger_type', 'closing');
    if (error) throw new Error(`pollClosingJudgeMessage failed: ${error.message}`);
    last = (data ?? []) as Array<{ id: string; trigger_type: string; created_at: string }>;
    if (last.length > 0) return last;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return last;
}

// ────────────────────────────────────────────────────────────
// BUG-005-2: 延長投票で両者 finish → phase=judging 遷移
// closing greeting (arguments 2 行) + AI 閉廷宣告 (judge_messages 1 行) が
// 順序通りに挿入されることを確認 (fast-path)
// ────────────────────────────────────────────────────────────

test('BUG-005-2: 延長投票で両者 finish → closing greeting + AI 閉廷宣告が順序通りに挿入される', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const emailB = process.env.E2E_TEST_EMAIL_B!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;
  const passB = process.env.E2E_TEST_PASSWORD_B!;

  const admin = createAdminClient();
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // UI: A がケース作成、B が参加 (両者のセッション cookie を得るためにここだけ UI を使う)
    await loginAs(pageA, emailA, passA);
    const caseUrl = await createCase(pageA, 'BUG-005-2: fast-path extension-vote finish');
    const caseId = extractCaseId(caseUrl);

    await loginAs(pageB, emailB, passB);
    await pageB.goto(caseUrl);
    await joinAsAccount(pageB);

    // admin で fast-skip: arguments に 3R 分 INSERT、cases.phase を extension_voting に更新
    const { data: caseRow, error: caseErr } = await admin
      .from('cases')
      .select('plaintiff_id, max_rounds')
      .eq('id', caseId)
      .single();
    if (caseErr || !caseRow) throw new Error(`cases SELECT failed: ${caseErr?.message}`);
    expect(caseRow.max_rounds).toBe(3);
    await fastSkipToExtensionVoting(admin, caseId, caseRow.max_rounds);

    // REST API: A が finish 投票 (vote=finish)
    const respA = await pageA.context().request.post(`/api/cases/${caseId}/extension-vote`, {
      data: { vote: 'finish' },
    });
    expect(respA.ok()).toBe(true);

    // REST API: B が finish 投票 → 両者 finish 一致で phase=judging 遷移
    const respB = await pageB.context().request.post(`/api/cases/${caseId}/extension-vote`, {
      data: { vote: 'finish' },
    });
    expect(respB.ok()).toBe(true);

    // 遷移確認: cases.phase が judging になっている
    const { data: judgingCase } = await admin
      .from('cases')
      .select('phase')
      .eq('id', caseId)
      .single();
    expect(judgingCase?.phase).toBe('judging');

    // 検証: closing greeting (arguments) は必ず 2 行 (FEAT-006 既存挙動)
    const { data: closingGreetings, error: argErr } = await admin
      .from('arguments')
      .select('id, role, phase, is_greeting, created_at')
      .eq('case_id', caseId)
      .eq('phase', 'closing')
      .eq('is_greeting', true);
    if (argErr) throw new Error(`closing greeting SELECT failed: ${argErr.message}`);
    expect(closingGreetings).toHaveLength(2);
    const roles = (closingGreetings ?? []).map((g) => g.role).sort();
    expect(roles).toEqual(['defendant', 'plaintiff']);

    // 原告の API キー有無で AI 閉廷宣告の期待値が分岐する。
    // - api_key_encrypted SET: insertClosingJudgeMessage が AI 生成 → judge_messages へ 1 行 INSERT
    // - api_key_encrypted NULL: 早期 return (lib/case-closing.ts:24-29)、judge_messages 0 行
    // 現状 E2E ユーザー A は API キー未登録のため 0 行経路を踏む想定だが、両ケースを動的に判定する。
    const { data: profA } = await admin
      .from('profiles')
      .select('api_key_encrypted')
      .eq('id', caseRow.plaintiff_id)
      .single();
    const apiKeySet = profA?.api_key_encrypted != null;

    if (apiKeySet) {
      // ケース 1: AI 生成成功 → 1 行 INSERT、greeting → AI の順序
      const closingJudgeMessages = await pollClosingJudgeMessage(admin, caseId);
      expect(closingJudgeMessages).toHaveLength(1);
      const greetingMaxCreatedAt = Math.max(
        ...(closingGreetings ?? []).map((g) => new Date(g.created_at!).getTime())
      );
      const judgementCreatedAt = new Date(closingJudgeMessages[0].created_at).getTime();
      expect(greetingMaxCreatedAt).toBeLessThanOrEqual(judgementCreatedAt);
    } else {
      // ケース 2: 早期 return → judge_messages へ closing が挿入されないこと
      // polling せずに即時で確認する（早期 return は同期的に走るため、cases UPDATE 完了時点で
      // closing の有無が確定している）。
      const { data: closingJudgeMessages } = await admin
        .from('judge_messages')
        .select('id, trigger_type')
        .eq('case_id', caseId)
        .eq('trigger_type', 'closing');
      expect(closingJudgeMessages ?? []).toHaveLength(0);
    }
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// ────────────────────────────────────────────────────────────
// BUG-005-3: 早期終了 (end-proposal) 両者合意 → phase=judging 遷移
// closing greeting + AI 閉廷宣告が順序通りに挿入されることを確認 (fast-path)
// ────────────────────────────────────────────────────────────

test('BUG-005-3: 早期終了 (end-proposal) 両者合意 → closing greeting + AI 閉廷宣告が順序通りに挿入される', async ({ browser }) => {
  const emailA = process.env.E2E_TEST_EMAIL_A!;
  const emailB = process.env.E2E_TEST_EMAIL_B!;
  const passA = process.env.E2E_TEST_PASSWORD_A!;
  const passB = process.env.E2E_TEST_PASSWORD_B!;

  const admin = createAdminClient();
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // UI: A がケース作成、B が参加 (両者のセッション cookie 取得)
    await loginAs(pageA, emailA, passA);
    const caseUrl = await createCase(pageA, 'BUG-005-3: fast-path end-proposal');
    const caseId = extractCaseId(caseUrl);

    await loginAs(pageB, emailB, passB);
    await pageB.goto(caseUrl);
    await joinAsAccount(pageB);

    // admin で fast-skip: arguments に 1R 分 INSERT、phase=argument のまま
    await fastSkipToArgumentR1(admin, caseId);

    // REST API: A が end-proposal POST (提案)
    const respA = await pageA.context().request.post(`/api/cases/${caseId}/end-proposal`, {
      data: {},
    });
    expect(respA.ok()).toBe(true);

    // 中間確認: end_proposed_by = 'plaintiff' に変わっている
    const { data: midCase } = await admin
      .from('cases')
      .select('end_proposed_by, phase')
      .eq('id', caseId)
      .single();
    expect(midCase?.end_proposed_by).toBe('plaintiff');
    expect(midCase?.phase).toBe('argument');

    // REST API: B が end-proposal POST (同意 → phase=judging 遷移)
    const respB = await pageB.context().request.post(`/api/cases/${caseId}/end-proposal`, {
      data: {},
    });
    expect(respB.ok()).toBe(true);

    // 遷移確認
    const { data: judgingCase } = await admin
      .from('cases')
      .select('phase, end_proposed_by, plaintiff_id')
      .eq('id', caseId)
      .single();
    expect(judgingCase?.phase).toBe('judging');
    expect(judgingCase?.end_proposed_by).toBeNull();

    // 検証: closing greeting (arguments) は必ず 2 行
    const { data: closingGreetings, error: argErr } = await admin
      .from('arguments')
      .select('id, role, phase, is_greeting, created_at')
      .eq('case_id', caseId)
      .eq('phase', 'closing')
      .eq('is_greeting', true);
    if (argErr) throw new Error(`closing greeting SELECT failed: ${argErr.message}`);
    expect(closingGreetings).toHaveLength(2);
    const roles = (closingGreetings ?? []).map((g) => g.role).sort();
    expect(roles).toEqual(['defendant', 'plaintiff']);

    // API キー有無による AI 閉廷宣告の期待値分岐 (BUG-005-2 と同じロジック)
    const { data: profA } = await admin
      .from('profiles')
      .select('api_key_encrypted')
      .eq('id', judgingCase!.plaintiff_id)
      .single();
    const apiKeySet = profA?.api_key_encrypted != null;

    if (apiKeySet) {
      const closingJudgeMessages = await pollClosingJudgeMessage(admin, caseId);
      expect(closingJudgeMessages).toHaveLength(1);
      const greetingMaxCreatedAt = Math.max(
        ...(closingGreetings ?? []).map((g) => new Date(g.created_at!).getTime())
      );
      const judgementCreatedAt = new Date(closingJudgeMessages[0].created_at).getTime();
      expect(greetingMaxCreatedAt).toBeLessThanOrEqual(judgementCreatedAt);
    } else {
      const { data: closingJudgeMessages } = await admin
        .from('judge_messages')
        .select('id, trigger_type')
        .eq('case_id', caseId)
        .eq('trigger_type', 'closing');
      expect(closingJudgeMessages ?? []).toHaveLength(0);
    }
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
