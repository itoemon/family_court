import type { createAdminClient } from "@/lib/supabase/server";
import type { PostgrestError } from "@supabase/supabase-js";

type AdminClient = ReturnType<typeof createAdminClient>;

export const DEFAULT_OPENING_GREETING = "よろしくお願いします";
export const DEFAULT_CLOSING_GREETING = "ありがとうございました。";

export const MAX_GREETING_LENGTH = 125;

export function resolveOpeningGreeting(profileValue: string | null | undefined): string {
  return profileValue ?? DEFAULT_OPENING_GREETING;
}

export function resolveClosingGreeting(profileValue: string | null | undefined): string {
  return profileValue ?? DEFAULT_CLOSING_GREETING;
}

interface InsertGreetingsArgs {
  caseId: string;
  plaintiffId: string;
  defendantId: string | null; // null = ゲスト被告（サーバ既定文を使用）
}

async function fetchSingleGreeting(
  admin: AdminClient,
  userId: string,
  kind: "opening" | "closing",
  defaultText: string
): Promise<string> {
  // 動的キーを `select(column)` に渡すと Supabase 型推論が union を返して
  // インデックスアクセスでエラーになるため、kind で明示的に分岐する。
  if (kind === "opening") {
    const { data } = await admin
      .from("profiles")
      .select("opening_greeting")
      .eq("id", userId)
      .single();
    return data?.opening_greeting ?? defaultText;
  }
  const { data } = await admin
    .from("profiles")
    .select("closing_greeting")
    .eq("id", userId)
    .single();
  return data?.closing_greeting ?? defaultText;
}

async function resolvePairForCase(
  admin: AdminClient,
  args: InsertGreetingsArgs,
  kind: "opening" | "closing",
  defaultText: string
): Promise<{ plaintiff: string; defendant: string }> {
  const plaintiff = await fetchSingleGreeting(admin, args.plaintiffId, kind, defaultText);
  const defendant = args.defendantId
    ? await fetchSingleGreeting(admin, args.defendantId, kind, defaultText)
    : defaultText;
  return { plaintiff, defendant };
}

// opening phase 進入時に両者の開始挨拶を arguments に INSERT する。
// 戻り値の error が null でなければ呼び出し側でエラー応答すること。
export async function insertOpeningGreetingsForCase(
  admin: AdminClient,
  args: InsertGreetingsArgs
): Promise<{ error: PostgrestError | null }> {
  const { plaintiff, defendant } = await resolvePairForCase(
    admin,
    args,
    "opening",
    DEFAULT_OPENING_GREETING
  );
  const { error } = await admin.from("arguments").insert([
    { case_id: args.caseId, role: "plaintiff", phase: "opening", round: 0, content: plaintiff, is_greeting: true },
    { case_id: args.caseId, role: "defendant", phase: "opening", round: 0, content: defendant, is_greeting: true },
  ]);
  return { error };
}

// closing 確定時に両者の終了挨拶を arguments に INSERT する。
// 呼び出し側は UPDATE 成功確認後にのみ本関数を呼ぶ責務がある（早期 INSERT は重複の元）。
export async function insertClosingGreetingsForCase(
  admin: AdminClient,
  args: InsertGreetingsArgs
): Promise<{ error: PostgrestError | null }> {
  const { plaintiff, defendant } = await resolvePairForCase(
    admin,
    args,
    "closing",
    DEFAULT_CLOSING_GREETING
  );
  const { error } = await admin.from("arguments").insert([
    { case_id: args.caseId, role: "plaintiff", phase: "closing", round: 0, content: plaintiff, is_greeting: true },
    { case_id: args.caseId, role: "defendant", phase: "closing", round: 0, content: defendant, is_greeting: true },
  ]);
  return { error };
}

export type GreetingValidationResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export function validateGreeting(raw: unknown, fieldLabel: string): GreetingValidationResult {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") {
    return { ok: false, error: `${fieldLabel}の値が不正です` };
  }
  if (raw.length === 0) {
    return { ok: false, error: `${fieldLabel}は空欄では保存できません` };
  }
  if (raw.length > MAX_GREETING_LENGTH) {
    return { ok: false, error: `${fieldLabel}は${MAX_GREETING_LENGTH}文字以内で入力してください` };
  }
  if (/\n.*\n/.test(raw)) {
    return { ok: false, error: `${fieldLabel}は改行を 1 つまでしか使えません` };
  }
  return { ok: true, value: raw };
}
