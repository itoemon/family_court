import { NextRequest, NextResponse } from "next/server";
import { requestVerdict } from "@/lib/claude";
import { resolveCaseAiKey } from "@/lib/case-ai-key";
import { resolveCaseAuth } from "@/lib/case-auth";
import { Case } from "@/lib/types";
import { isUuid } from "@/lib/text-utils";
import { aiRouteLimiter, rateLimitResponse } from "@/lib/ratelimit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "不正な ID 形式です" }, { status: 400 });
  }

  // SEC-001: 参加者認可（未ログイン/第三者は 401/403）。Claude 呼び出しより必ず前に置く。
  const auth = await resolveCaseAuth(req, id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { userId, c, admin } = auth;

  // SEC-002 第 1 層: 認可の直後・TOCTOU 奪取より前にレート制限を適用し、フラッドを早期に弾く。
  // verdict は SEC-001 の原子的フェーズ奪取で 1 ケース 1 回に確定済みのため第 2 層は対象外。
  const rateKey = userId ?? `guest:${id}`;
  const rl = await aiRouteLimiter.limit(rateKey);
  if (!rl.success) {
    return rateLimitResponse(rl);
  }

  if (c.phase !== "judging") {
    return NextResponse.json({ error: "まだ判決を下せるフェーズではありません" }, { status: 409 });
  }

  // SEC-001 TOCTOU: 判決フェーズを原子的に奪取する。judging のときだけ verdict へ更新し、
  // 更新できた 1 リクエストのみが以降（Claude 呼び出し）へ進む。同時/連続の 2 回目は
  // 更新行 0 で 409 を返し、二重生成＝二重課金を防ぐ。Claude 呼び出しより前に行うのが肝。
  const { data: claimed, error: claimError } = await admin
    .from("cases")
    .update({ phase: "verdict", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("phase", "judging")
    .select("id");
  if (claimError) {
    return NextResponse.json({ error: "判決処理に失敗しました" }, { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    // 別リクエストが既にフェーズを奪取済み（判決生成中 or 済み）。
    return NextResponse.json({ error: "判決は既に処理されています" }, { status: 409 });
  }

  // 以降で失敗したらフェーズを judging へ戻し、再生成を可能にする（フェーズだけ進んで
  // 判決が無い"詰み"状態を防ぐ）。次リクエストが再度奪取できる。
  async function revertPhase() {
    // 自分が奪取した verdict フェーズだけを judging へ戻す（`.eq("phase","verdict")` で
    // 想定外フェーズの上書きを防ぐ）。revert の DB 書き込み失敗は判決なしで verdict に
    // 詰む信頼性エッジなので、握り潰さずログに残して検知可能にする（SEC-001 監査 LOW-001）。
    const { error } = await admin
      .from("cases")
      .update({ phase: "judging", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("phase", "verdict");
    if (error) console.error("[verdict] revertPhase failed:", error);
  }

  // 原告 profile を取得し、ケースの課金モードに応じて AI 実行キーを解決。
  const { data: profile } = await admin
    .from("profiles")
    .select("display_name, api_key_encrypted")
    .eq("id", c.plaintiff_id)
    .single();

  const keyResult = resolveCaseAiKey(c, profile);
  if (!keyResult.ok) {
    await revertPhase();
    return NextResponse.json({ error: keyResult.error }, { status: keyResult.status });
  }
  const apiKey = keyResult.apiKey;

  const { data: args } = await admin.from("arguments").select("*").eq("case_id", id).order("created_at");

  let defendant = null;
  if (c.defendant_id) {
    const { data: d } = await admin.from("profiles").select("display_name").eq("id", c.defendant_id).single();
    defendant = { name: d?.display_name ?? "反対者", joinedAt: c.updated_at };
  } else if (c.defendant_guest_name) {
    defendant = { name: c.defendant_guest_name, joinedAt: c.updated_at };
  }

  const caseForClaude: Case = {
    id: c.id,
    topic: c.topic,
    plaintiff: { name: profile?.display_name ?? "提案者", joinedAt: c.created_at },
    defendant,
    arguments: (args ?? []).map((a) => ({
      id: a.id,
      role: a.role,
      phase: a.phase,
      round: a.round,
      content: a.content,
      isGreeting: a.is_greeting ?? false,
      createdAt: a.created_at,
    })),
    judgeMessages: [],
    contradictionWarnings: [],
    phase: c.phase,
    currentTurn: c.current_turn,
    round: c.round,
    maxRounds: c.max_rounds,
    endProposedBy: c.end_proposed_by ?? null,
    extensionVotePlaintiff: c.extension_vote_plaintiff ?? null,
    extensionVoteDefendant: c.extension_vote_defendant ?? null,
    usesServiceKey: c.uses_service_key ?? false,
    verdict: null,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };

  // SEC-003: requestVerdict の未処理例外を 500 に整形（出力検証は requestVerdict 側でも実施）。
  let verdict;
  try {
    verdict = await requestVerdict(caseForClaude, apiKey);
  } catch (err) {
    console.error("[verdict] requestVerdict failed:", err);
    await revertPhase();
    return NextResponse.json({ error: "判決の生成に失敗しました" }, { status: 500 });
  }

  const { error: insertError } = await admin.from("verdicts").insert({
    case_id: id,
    winner: verdict.winner,
    summary: verdict.summary,
    reasoning: verdict.reasoning,
    plaintiff_score: verdict.plaintiffScore,
    defendant_score: verdict.defendantScore,
  });
  if (insertError) {
    console.error("[verdict] verdicts insert failed:", insertError);
    await revertPhase();
    return NextResponse.json({ error: "判決の保存に失敗しました" }, { status: 500 });
  }

  // phase は既に verdict へ奪取済みなので追加更新は不要。
  return NextResponse.json({ phase: "verdict", verdict });
}
