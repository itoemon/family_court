import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// ────────────────────────────────────────────────────────────
// MON-001 PR-B: Stripe クレジット購入の E2E
// checkout セッション作成と webhook を分けて検証（bug005 / mon001-credits の
// admin fast-path + 専用 ephemeral ユーザーパターンを踏襲）。TEST_MODE は不要。
// ────────────────────────────────────────────────────────────

test.beforeEach(() => {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
  ];
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

function stripeClient() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

async function createEphemeralUser(admin: Admin, label: string) {
  const email = `e2e_mon001b_${label}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}@example.com`;
  const password = 'E2eMon001bTest123!';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data?.user) throw new Error(`ephemeral user 作成に失敗 (${label}): ${error?.message}`);
  return { email, password, id: data.user.id };
}

async function getCredits(admin: Admin, userId: string): Promise<number | null> {
  const { data, error } = await admin.from('profiles').select('credits').eq('id', userId).single();
  if (error) throw new Error(`credits SELECT 失敗: ${error.message}`);
  return data?.credits ?? null;
}

async function loginAs(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/auth/login');
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/', { timeout: 15_000 });
}

function buildCompletedEventPayload(p: {
  eventId: string;
  userId: string;
  credits: number;
  packageId: string;
  paymentStatus?: string;
}): string {
  const event = {
    id: p.eventId,
    object: 'event',
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_test_${Math.random().toString(16).slice(2, 12)}`,
        object: 'checkout.session',
        payment_status: p.paymentStatus ?? 'paid', // 付与ガード（webhook は paid のみ付与）
        metadata: { userId: p.userId, credits: String(p.credits), packageId: p.packageId },
      },
    },
  };
  return JSON.stringify(event);
}

// ── 1. checkout セッション作成 ─────────────────────────────
test('MON-001b: 認証ユーザーは checkout を作成でき、未知 packageId は 400', async ({ browser }) => {
  const admin = createAdminClient();
  const user = await createEphemeralUser(admin, 'checkout');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await loginAs(page, user.email, user.password);

    const ok = await page.request.post('/api/credits/checkout', { data: { packageId: 'credits_10' } });
    expect(ok.status()).toBe(200);
    const okBody = await ok.json();
    expect(typeof okBody.url).toBe('string');
    expect(okBody.url).toContain('stripe.com');

    const bad = await page.request.post('/api/credits/checkout', { data: { packageId: 'credits_9999' } });
    expect(bad.status()).toBe(400);
  } finally {
    await admin.auth.admin.deleteUser(user.id);
    await ctx.close();
  }
});

// ── 未認証は 401 ────────────────────────────────────────────
test('MON-001b: 未認証の checkout は 401', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    const res = await page.request.post('/api/credits/checkout', { data: { packageId: 'credits_10' } });
    expect(res.status()).toBe(401);
  } finally {
    await ctx.close();
  }
});

// ── 2. webhook 付与 ────────────────────────────────────────
test('MON-001b: 署名付き checkout.session.completed で credits が加算される', async ({ request }) => {
  const admin = createAdminClient();
  const stripe = stripeClient();
  const user = await createEphemeralUser(admin, 'grant');
  const eventId = `evt_test_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  try {
    expect(await getCredits(admin, user.id)).toBe(3);

    const payload = buildCompletedEventPayload({ eventId, userId: user.id, credits: 10, packageId: 'credits_10' });
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });

    const res = await request.post('/api/stripe/webhook', {
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
      data: payload,
    });
    expect(res.status()).toBe(200);
    expect(await getCredits(admin, user.id)).toBe(13);
  } finally {
    await admin.from('stripe_events').delete().eq('id', eventId);
    await admin.auth.admin.deleteUser(user.id);
  }
});

// ── 3. 冪等性 ──────────────────────────────────────────────
test('MON-001b: 同一 event.id を 2 回送っても付与は 1 回分のみ', async ({ request }) => {
  const admin = createAdminClient();
  const stripe = stripeClient();
  const user = await createEphemeralUser(admin, 'idem');
  const eventId = `evt_test_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  try {
    const payload = buildCompletedEventPayload({ eventId, userId: user.id, credits: 30, packageId: 'credits_30' });
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
    const headers = { 'stripe-signature': sig, 'content-type': 'application/json' };

    expect((await request.post('/api/stripe/webhook', { headers, data: payload })).status()).toBe(200);
    expect((await request.post('/api/stripe/webhook', { headers, data: payload })).status()).toBe(200);

    // 3(初期) + 30(1 回分) = 33。2 回分（60）にはならない。
    expect(await getCredits(admin, user.id)).toBe(33);
  } finally {
    await admin.from('stripe_events').delete().eq('id', eventId);
    await admin.auth.admin.deleteUser(user.id);
  }
});

// ── 4. 署名不正 ────────────────────────────────────────────
test('MON-001b: 署名が不正な webhook は 400 で付与されない', async ({ request }) => {
  const admin = createAdminClient();
  const user = await createEphemeralUser(admin, 'badsig');
  const eventId = `evt_test_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  try {
    const payload = buildCompletedEventPayload({ eventId, userId: user.id, credits: 100, packageId: 'credits_100' });

    const res = await request.post('/api/stripe/webhook', {
      headers: { 'stripe-signature': 't=1,v1=deadbeef', 'content-type': 'application/json' },
      data: payload,
    });
    expect(res.status()).toBe(400);
    expect(await getCredits(admin, user.id)).toBe(3);

    // dedup 記録も作られていない（署名検証は DB 操作前に走る）。
    const { data: evt } = await admin.from('stripe_events').select('id').eq('id', eventId).maybeSingle();
    expect(evt).toBeNull();
  } finally {
    await admin.from('stripe_events').delete().eq('id', eventId);
    await admin.auth.admin.deleteUser(user.id);
  }
});

// ── 5. 未払い（payment_status !== "paid"）は付与しない ────────
test('MON-001b: payment_status が paid でない completed イベントは付与しない', async ({ request }) => {
  const admin = createAdminClient();
  const stripe = stripeClient();
  const user = await createEphemeralUser(admin, 'unpaid');
  const eventId = `evt_test_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  try {
    const payload = buildCompletedEventPayload({
      eventId, userId: user.id, credits: 10, packageId: 'credits_10', paymentStatus: 'unpaid',
    });
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });

    const res = await request.post('/api/stripe/webhook', {
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
      data: payload,
    });
    expect(res.status()).toBe(200); // 200 で受理するが付与はしない（再送で無限ループさせない）
    expect(await getCredits(admin, user.id)).toBe(3); // 付与されていない
    // dedup 記録も作られていない（未払いは記録前に skip する）。
    const { data: evt } = await admin.from('stripe_events').select('id').eq('id', eventId).maybeSingle();
    expect(evt).toBeNull();
  } finally {
    await admin.from('stripe_events').delete().eq('id', eventId);
    await admin.auth.admin.deleteUser(user.id);
  }
});
