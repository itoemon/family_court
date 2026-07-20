import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { verifyGuestToken } from "@/lib/guest-token";
import { AddArgumentRequest, Role } from "@/lib/types";
import { buildCaseResponse } from "@/lib/case-response";
import { generateJudgeMessage } from "@/lib/judge";
import { resolveCaseAiKey } from "@/lib/case-ai-key";
import { checkContradiction } from "@/lib/contradiction";
import { isUuid } from "@/lib/text-utils";
import { aiRouteLimiter, rateLimitResponse } from "@/lib/ratelimit";
import { SERVICE_AI_CALL_CAP } from "@/lib/limits";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "不正な ID 形式です" }, { status: 400 });
  }
  const admin = createAdminClient();

  const { data: c } = await admin.from("cases").select("*").eq("id", id).single();
  if (!c) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });
  // FEAT-006 補正: opening / closing は cases.phase に乗せない設計に変わったため、
  // 仮にレガシーケースで残っていても発言は受け付けない。
  if (["waiting", "opening", "closing", "extension_voting", "judging", "verdict"].includes(c.phase)) {
    return NextResponse.json({ error: "現在は発言できないフェーズです" }, { status: 409 });
  }

  // 呼び出し者の身元確認とロール導出
  let callerRole: Role | null = null;
  let authenticatedUserId: string | null = null;
  try {
    const supabase = await createSessionClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      authenticatedUserId = user.id;
      if (user.id === c.plaintiff_id) {
        callerRole = "plaintiff";
      } else if (c.defendant_id && user.id === c.defendant_id) {
        callerRole = "defendant";
      }
    }

    if (!callerRole && c.defendant_guest_name) {
      const cookieToken = req.cookies.get(`guest_defendant_${id}`)?.value;
      if (cookieToken && await verifyGuestToken(id, cookieToken)) {
        callerRole = "defendant";
      }
    }
  } catch (err) {
    console.error("callerRole determination failed:", err);
    return NextResponse.json({ error: "サーバー設定エラーが発生しました。管理者に連絡してください。" }, { status: 500 });
  }

  if (!callerRole) {
    return NextResponse.json({ error: "このケースへの発言権限がありません" }, { status: 403 });
  }

  // SEC-002 第 1 層: 身元確定後に横断レート制限を適用する。認証ユーザーは user.id、
  // ゲスト被告は case 単位の guest:{caseId}（確定判断 3）。ターン進行を守るため第 2 層は
  // 後段（判事メッセージ生成の直前）で扱う。
  const rateKey = authenticatedUserId ?? `guest:${id}`;
  const rl = await aiRouteLimiter.limit(rateKey);
  if (!rl.success) {
    return rateLimitResponse(rl);
  }

  const body: AddArgumentRequest = await req.json();
  if (callerRole !== c.current_turn) {
    return NextResponse.json({ error: "あなたのターンではありません" }, { status: 409 });
  }
  if (!body.content?.trim()) {
    return NextResponse.json({ error: "発言内容は必須です" }, { status: 400 });
  }
  if (body.content.trim().length > 500) {
    return NextResponse.json({ error: "発言は500文字以内で入力してください" }, { status: 400 });
  }

  const { data: insertedArg, error: insertError } = await admin
    .from("arguments")
    .insert({
      case_id: id,
      role: callerRole,
      phase: c.phase,
      round: c.round,
      content: body.content.trim(),
    })
    .select("id")
    .single();
  if (insertError) {
    console.error("[argument] insert failed:", insertError);
    return NextResponse.json({ error: "発言の保存に失敗しました" }, { status: 500 });
  }

  // ターン交代・フェーズ進行
  let nextTurn = c.current_turn;
  let nextPhase = c.phase;
  let nextRound = c.round;

  if (c.current_turn === "plaintiff") {
    nextTurn = "defendant";
  } else {
    nextTurn = "plaintiff";
    nextRound += 1;

    // FEAT-006 補正: 挨拶はシステム自動投入で cases.phase=argument から会話開始。
    // max_rounds 到達後は closing を経由せず延長投票へ直行する。
    if (c.phase === "argument" && nextRound > c.max_rounds) {
      nextPhase = "extension_voting";
    }
  }

  // フェーズが argument を離れるタイミングで end_proposed_by をクリアする。
  // argument 中に出ていた終了提案を closing / extension_voting に持ち越すと、
  // それらフェーズでは /api/cases/[id]/end-proposal が 409 を返すため
  // 撤回も同意もできず提案状態が詰みになる（コパ #3 指摘）。
  const updatePayload: Record<string, unknown> = {
    current_turn: nextTurn,
    phase: nextPhase,
    round: nextRound,
    updated_at: new Date().toISOString(),
  };
  if (nextPhase !== "argument") {
    updatePayload.end_proposed_by = null;
  }
  await admin.from("cases").update(updatePayload).eq("id", id);

  // profiles は judge・矛盾チェック両方で使うため先に1回取得
  const { data: plaintiffProfile } = await admin
    .from("profiles")
    .select("display_name, api_key_encrypted")
    .eq("id", c.plaintiff_id)
    .single();
  // MON-001: ケースの課金モードに応じて AI 実行キーを解決。judge / 矛盾チェックは
  // 失敗しても本処理を止めない付随処理のため、キー解決に失敗したら null 扱いで skip する
  // （サービスキー未設定・BYOK NULL のいずれも従来どおり警告してスキップ）。
  const keyResult = resolveCaseAiKey(c, plaintiffProfile);
  const plaintiffApiKey = keyResult.ok ? keyResult.apiKey : null;

  // SEC-002 第 2 層（money-critical）: argument の判事メッセージ・矛盾チェックは付随の
  // best-effort AI 生成である。サービスキーケースでは 1 ターンあたり 1 回だけ生成回数を
  // 消費し、上限到達（NULL）なら AI 生成のみ skip して**ターン進行は成功のまま返す**
  // （defense/draft と異なり 429 にはしない＝正当なターン操作を壊さない・確定判断）。
  // 判事メッセージ生成の直前に置く。消費は AI を実際に回し得る場合（キーあり、かつ
  // 判事メッセージ or 矛盾チェックのいずれかの外側ガードが真）に限り、無駄な消費を避ける。
  const usesServiceKey = c.uses_service_key === true;
  const willAttemptAi =
    !!plaintiffApiKey &&
    (nextPhase === "argument" || (authenticatedUserId !== null && !!insertedArg?.id));
  let serviceCapReached = false;
  let serviceConsumed = false;
  let aiActuallyCalled = false; // 実際に Claude を呼んだか（SEC-002 監査 LOW-001）。
  if (usesServiceKey && willAttemptAi) {
    const { data: calls, error: consumeError } = await admin.rpc("consume_service_ai_call", {
      p_case_id: id,
      p_cap: SERVICE_AI_CALL_CAP,
    });
    if (consumeError || calls === null) {
      // 消費失敗（インフラ障害）は安全側で AI を回さない。NULL は上限到達。いずれも AI skip。
      if (consumeError) console.error("[argument] consume_service_ai_call failed:", consumeError);
      serviceCapReached = true;
    } else {
      serviceConsumed = true;
    }
  }

  // consume 済みで判事メッセージ生成が失敗した際にカウントを 1 戻す補償（確定判断 2）。
  async function refundServiceCall() {
    if (!serviceConsumed) return;
    serviceConsumed = false; // 二重 refund 防止。
    const { error } = await admin.rpc("refund_service_ai_call", { p_case_id: id });
    if (error) console.error("[argument] refund_service_ai_call failed:", error);
  }

  // BUG-005: argument フェーズを離れる場合 (extension_voting 遷移) は judge_message を一切生成しない。
  // 旧設計では trigger='closing' を出していたが、AI 閉廷宣告は phase=judging 遷移時に
  // end-proposal / extension-vote 側で生成する設計に変更した。turn メッセージも extension_voting 中は不要。
  if (nextPhase === "argument" && !serviceCapReached) {
    try {
      if (!plaintiffApiKey) {
        console.warn(`[judge] turn: plaintiff ${c.plaintiff_id} has no api_key_encrypted`);
      } else {
        let defendantName = "反対者";
        if (c.defendant_id) {
          const { data: defProfile } = await admin
            .from("profiles")
            .select("display_name")
            .eq("id", c.defendant_id)
            .single();
          defendantName = defProfile?.display_name ?? "反対者";
        } else if (c.defendant_guest_name) {
          defendantName = c.defendant_guest_name;
        }
        aiActuallyCalled = true; // 実 Claude 呼び出し（consume を実消費に対応させる・LOW-001）。
        const content = await generateJudgeMessage({
          trigger: "turn",
          topic: c.topic,
          plaintiffName: plaintiffProfile?.display_name ?? "提案者",
          defendantName,
          lastSpeakerRole: callerRole,
        }, plaintiffApiKey);
        if (content) {
          await admin.from("judge_messages").insert({ case_id: id, content, trigger_type: "turn" });
        }
      }
    } catch (err) {
      console.error("[judge] turn generation failed:", err);
      // consume 済みで判事メッセージ生成が失敗 → refund（矛盾チェックはこの後 skip される）。
      await refundServiceCall();
      serviceCapReached = true; // refund 済みのため以降の AI（矛盾チェック）は回さない。
    }
  }

  // 矛盾チェック（認証済みユーザーのみ、失敗しても無視）
  // SEC-002: 上限到達 or 判事メッセージ生成失敗で refund 済みの場合はこのターンの AI を
  // 打ち止めにする（1 ターン 1 consume の原則を保ち、追加消費を発生させない）。
  if (authenticatedUserId && insertedArg?.id && !serviceCapReached) {
    try {
      if (plaintiffApiKey) {
        const apiKey = plaintiffApiKey;
        const { data: pastCases } = await admin
          .from("cases")
          .select("id")
          .or(`plaintiff_id.eq.${authenticatedUserId},defendant_id.eq.${authenticatedUserId}`)
          .eq("phase", "verdict")
          .neq("id", id)
          .order("created_at", { ascending: false })
          .limit(3);
        if (pastCases && pastCases.length > 0) {
          const { data: pastArgs } = await admin
            .from("arguments")
            .select("content")
            .in("case_id", pastCases.map((pc) => pc.id))
            .eq("role", callerRole)
            .order("created_at", { ascending: false })
            .limit(15);
          if (pastArgs && pastArgs.length > 0) {
            aiActuallyCalled = true; // 実 Claude 呼び出し（LOW-001）。
            const warning = await checkContradiction(
              {
                currentContent: body.content.trim(),
                topic: c.topic,
                pastArguments: pastArgs.map((a) => a.content),
              },
              apiKey
            );
            if (warning) {
              await admin.from("contradiction_warnings").insert({
                case_id: id,
                argument_id: insertedArg.id,
                user_id: authenticatedUserId,
                message: warning,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error("[contradiction] check failed:", err);
    }
  }

  // SEC-002 監査 LOW-001: consume したが実際には Claude を 1 回も呼ばなかった経路
  // （最終ターンで judge を skip、かつ過去ケース無し等で矛盾チェックが実呼び出しに至らない）
  // では、過大カウントでユーザーが購入回数を不当に失わないよう refund する。
  if (serviceConsumed && !aiActuallyCalled) {
    await refundServiceCall();
  }

  const caseData = await buildCaseResponse(admin, id, authenticatedUserId ?? undefined);
  return NextResponse.json(caseData);
}
