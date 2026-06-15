import type { createAdminClient } from "@/lib/supabase/server";
import { generateJudgeMessage } from "@/lib/judge";
import type { Role } from "@/lib/types";

type AdminClient = ReturnType<typeof createAdminClient>;

interface InsertClosingJudgeMessageArgs {
  caseId: string;
  topic: string;
  plaintiffName: string;
  defendantName: string;
  lastSpeakerRole: Role;
}

// phase=judging 遷移成功後に呼び出される前提。
// 失敗してもログのみで例外は伝播させない（呼び出し側は判決生成フローへ進む）。
// 責務: judge_messages テーブルへの closing INSERT のみ。
// 責務外: arguments テーブル / 固定挨拶文字列 / cases UPDATE / 認可判定。
export async function insertClosingJudgeMessage(
  admin: AdminClient,
  plaintiffApiKey: string | null,
  args: InsertClosingJudgeMessageArgs
): Promise<void> {
  if (!plaintiffApiKey) {
    console.warn(
      `[judge] closing: plaintiff has no api_key_encrypted (case=${args.caseId})`
    );
    return;
  }

  let content = "";
  try {
    content = await generateJudgeMessage(
      {
        trigger: "closing",
        topic: args.topic,
        plaintiffName: args.plaintiffName,
        defendantName: args.defendantName,
        lastSpeakerRole: args.lastSpeakerRole,
      },
      plaintiffApiKey
    );
  } catch (err) {
    console.error("[judge] closing generation failed:", err);
    return;
  }

  if (!content) {
    return;
  }

  try {
    const { error } = await admin
      .from("judge_messages")
      .insert({ case_id: args.caseId, content, trigger_type: "closing" });
    if (error) {
      console.error("[judge] closing insert failed:", error);
    }
  } catch (err) {
    console.error("[judge] closing insert threw:", err);
  }
}
