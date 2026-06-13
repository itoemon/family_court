import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { verifyGuestToken } from "@/lib/guest-token";
import { buildCaseResponse } from "@/lib/case-response";
import { isUuid } from "@/lib/text-utils";
import { insertClosingGreetingsForCase } from "@/lib/greetings";

type Actor = "plaintiff" | "defendant" | "guest";

async function determineActor(
  req: NextRequest,
  caseId: string,
  plaintiffId: string,
  defendantId: string | null,
  defendantGuestName: string | null
): Promise<Actor | null> {
  try {
    const supabase = await createSessionClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      if (user.id === plaintiffId) return "plaintiff";
      if (defendantId && user.id === defendantId) return "defendant";
    }
  } catch (err) {
    console.error("[extension-vote] createSessionClient failed:", err);
  }

  if (defendantGuestName) {
    const cookieToken = req.cookies.get(`guest_defendant_${caseId}`)?.value;
    if (cookieToken && (await verifyGuestToken(caseId, cookieToken))) {
      return "guest";
    }
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "不正な ID 形式です" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const vote = body?.vote;
  if (vote !== "continue" && vote !== "finish") {
    return NextResponse.json({ error: "投票内容が不正です" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: c } = await admin
    .from("cases")
    .select("*")
    .eq("id", id)
    .single();
  if (!c) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });

  if (c.phase !== "extension_voting") {
    return NextResponse.json(
      { error: "現在は延長投票のフェーズではありません" },
      { status: 409 }
    );
  }

  const actor = await determineActor(
    req,
    id,
    c.plaintiff_id,
    c.defendant_id,
    c.defendant_guest_name
  );
  if (!actor) {
    return NextResponse.json({ error: "このケースを操作する権限がありません" }, { status: 403 });
  }
  // 投票者は plaintiff か defendant/guest のいずれか。プロパティ名を決める。
  const side: "plaintiff" | "defendant" = actor === "plaintiff" ? "plaintiff" : "defendant";
  const column = side === "plaintiff" ? "extension_vote_plaintiff" : "extension_vote_defendant";

  // 既に自分側が投票済みなら 409（取り消し不可）
  const myCurrentVote = side === "plaintiff" ? c.extension_vote_plaintiff : c.extension_vote_defendant;
  if (myCurrentVote !== null) {
    return NextResponse.json(
      { error: "既に投票済みです。投票後の変更はできません" },
      { status: 409 }
    );
  }

  // 楽観的更新（WHERE 自分側 IS NULL）
  const { error: updateError } = await admin
    .from("cases")
    .update({ [column]: vote, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is(column, null);
  if (updateError) {
    return NextResponse.json({ error: "投票の保存に失敗しました" }, { status: 500 });
  }

  // 更新後の cases を再取得して両者の票を集計
  const { data: refreshed } = await admin
    .from("cases")
    .select("*")
    .eq("id", id)
    .single();
  if (!refreshed) {
    return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });
  }

  const myVote = side === "plaintiff" ? refreshed.extension_vote_plaintiff : refreshed.extension_vote_defendant;
  const opponentVote = side === "plaintiff" ? refreshed.extension_vote_defendant : refreshed.extension_vote_plaintiff;

  if (myVote && opponentVote) {
    // 両者揃った
    const eitherContinue = myVote === "continue" || opponentVote === "continue";
    if (eitherContinue) {
      // どちらかが continue → +3 ラウンド延長、argument に戻す。
      // 両者投票揃った直後に双方リクエストが並行すると確定処理が二重に走り得るため、
      // phase=extension_voting と現在の票を WHERE に含めた楽観ロックで 1 回に絞る（コパ #6 指摘）。
      const newMaxRounds = refreshed.max_rounds + 3;
      const { data: extendUpdated, error: extendError } = await admin
        .from("cases")
        .update({
          max_rounds: newMaxRounds,
          extension_vote_plaintiff: null,
          extension_vote_defendant: null,
          end_proposed_by: null,
          phase: "argument",
          round: refreshed.max_rounds + 1,
          current_turn: "plaintiff",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("phase", "extension_voting")
        .eq("extension_vote_plaintiff", myVote)
        .eq("extension_vote_defendant", opponentVote)
        .select("id");
      if (extendError) {
        return NextResponse.json({ error: "延長処理に失敗しました" }, { status: 500 });
      }
      // 楽観ロック失敗（更新 0 件）は別経路で先に確定済みを意味するため、最新状態をそのまま返す。
      if (!extendUpdated || extendUpdated.length === 0) {
        console.info("[extension-vote] continue 確定は他経路で実行済み");
      }
    } else {
      // 両者 finish → judging へ遷移してから終了挨拶を INSERT。
      // 楽観ロックで UPDATE 成功した 1 リクエストだけが挨拶 INSERT を実行する（コパ #7 指摘）。
      const { data: judgingUpdated, error: judgingError } = await admin
        .from("cases")
        .update({
          phase: "judging",
          extension_vote_plaintiff: null,
          extension_vote_defendant: null,
          end_proposed_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("phase", "extension_voting")
        .eq("extension_vote_plaintiff", myVote)
        .eq("extension_vote_defendant", opponentVote)
        .select("id");
      if (judgingError) {
        return NextResponse.json({ error: "判決フェーズへの遷移に失敗しました" }, { status: 500 });
      }
      // 楽観ロック成功時のみ挨拶 INSERT。失敗時（他経路で先に確定）はスキップ。
      if (judgingUpdated && judgingUpdated.length > 0) {
        const { error: greetingError } = await insertClosingGreetingsForCase(admin, {
          caseId: id,
          plaintiffId: refreshed.plaintiff_id,
          defendantId: refreshed.defendant_id,
        });
        if (greetingError) {
          console.error("[extension-vote] closing greeting insert failed:", greetingError);
          return NextResponse.json({ error: "終了挨拶の保存に失敗しました" }, { status: 500 });
        }
      } else {
        console.info("[extension-vote] finish 確定は他経路で実行済み");
      }
    }
  }

  const caseData = await buildCaseResponse(admin, id);
  return NextResponse.json(caseData);
}
