import { decryptApiKey } from "@/lib/crypto";

// MON-001: このケースの AI 実行にどの API キー（平文）を使うかを一元決定する唯一の場所。
// サーバ専用モジュール。lib/crypto.ts（node:crypto 依存）を import しており、かつ
// SERVICE_ANTHROPIC_API_KEY（NEXT_PUBLIC_ 無し）を読むため、クライアントバンドルに載せない
// こと。API Route（サーバ）からのみ import する。
//
// - uses_service_key === true : サービス側 API キー（SERVICE_ANTHROPIC_API_KEY）。
//     未設定なら { ok:false, status:500 }（サーバ設定不備）。
// - uses_service_key === false: 原告の BYOK（api_key_encrypted）を復号。
//     NULL/空なら { ok:false, status:400 }（従来の 400 と互換）。
//
// 判別可能な結果オブジェクトを返し、各ルートが HTTP ステータスへ明示的にマップできるようにする。

export type CaseAiKeyResult =
  | { ok: true; apiKey: string }
  | { ok: false; status: number; error: string };

interface CaseRowForKey {
  uses_service_key: boolean;
}

interface PlaintiffProfileForKey {
  api_key_encrypted: string | null;
}

export function resolveCaseAiKey(
  caseRow: CaseRowForKey,
  plaintiffProfile: PlaintiffProfileForKey | null | undefined
): CaseAiKeyResult {
  if (caseRow.uses_service_key === true) {
    const serviceKey = process.env.SERVICE_ANTHROPIC_API_KEY;
    if (!serviceKey) {
      return { ok: false, status: 500, error: "サービス用 API キーが未設定です" };
    }
    return { ok: true, apiKey: serviceKey };
  }

  // BYOK ケース
  const encrypted = plaintiffProfile?.api_key_encrypted;
  if (!encrypted) {
    return {
      ok: false,
      status: 400,
      error: "APIキーが登録されていません。プロフィールから登録してください。",
    };
  }

  try {
    return { ok: true, apiKey: decryptApiKey(encrypted) };
  } catch (err) {
    console.error("[case-ai-key] api key decryption failed:", err);
    return { ok: false, status: 500, error: "APIキーの復号に失敗しました" };
  }
}
