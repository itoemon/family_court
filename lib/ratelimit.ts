import "server-only";
import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import {
  AI_RATE_LIMIT,
  SEARCH_RATE_LIMIT,
  SERVICE_AI_CALL_CAP,
  type RateLimitConfig,
} from "@/lib/limits";

// SEC-002: Upstash レート制限の共通ヘルパー。
//
// 従来 app/api/users/search/route.ts に直書きされていた Upstash 実装を切り出し、
// 用途別の名前付き limiter（aiRouteLimiter / searchLimiter）として一元管理する。
// 責務は (1) 識別子・窓・上限を受けて { success, limit, remaining, reset } を返すこと、
// (2) 429 レスポンスを整形して返すこと（X-RateLimit-* / Retry-After）の二つである。

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  // 窓リセット時刻（epoch ミリ秒）。
  reset: number;
}

interface RateLimiter {
  limit(identifier: string): Promise<RateLimitResult>;
}

// Upstash env（URL / TOKEN）の有無をモジュールロード時に一度だけ判定する。
// 未設定なら Redis.fromEnv() が例外を投げて全 AI ルートが 500 に倒れるため、
// limiter を生成せず「常に success:true で通す」スタブに切り替える（確定判断 1）。
// フォールバックで素通しになるのは第 1 層（濫用抑止）のみで、money を守る第 2 層は
// DB（consume_service_ai_call）で担保されるため、Upstash 未設定でも課金は垂れ流されない。
// 本番は Upstash env を必須設定とし第 1 層を実効化する（フォールバックは開発／テスト用）。
const upstashConfigured =
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN;

function createLimiter(config: RateLimitConfig): RateLimiter {
  if (!upstashConfigured) {
    return {
      // スタブ: 常に通す。remaining は上限値でダミー整形し、正常系（success:true）では
      // ヘッダを付けないルート実装と整合する。
      async limit(): Promise<RateLimitResult> {
        return {
          success: true,
          limit: config.requests,
          remaining: config.requests,
          reset: Date.now(),
        };
      },
    };
  }

  const ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(config.requests, config.window),
    analytics: false,
  });

  return {
    async limit(identifier: string): Promise<RateLimitResult> {
      const { success, limit, remaining, reset } =
        await ratelimit.limit(identifier);
      return { success, limit, remaining, reset };
    },
  };
}

// 第 1 層（全 AI ルート横断・20/分）。
export const aiRouteLimiter = createLimiter(AI_RATE_LIMIT);
// users/search 専用（挙動不変・30/分）。
export const searchLimiter = createLimiter(SEARCH_RATE_LIMIT);

// 429 レスポンスの整形。既存 users/search の実装を厳密に踏襲する
// （resetSec = ceil(reset/1000)、retryAfter = max(0, resetSec - now)、4 ヘッダ）。
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const resetSec = Math.ceil(result.reset / 1000);
  const retryAfter = Math.max(0, resetSec - Math.floor(Date.now() / 1000));
  return NextResponse.json(
    { error: "Too Many Requests" },
    {
      status: 429,
      headers: {
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(resetSec),
        "Retry-After": String(retryAfter),
      },
    }
  );
}

// SEC-002 第 2 層: ケース単位の生成上限（consume_service_ai_call が NULL を返した）到達時の
// 429 レスポンス。レート系と統一して 429 を用いる（402/403 は課金・認可の含意が強く紛らわしい
// ため採らない）。窓のリセットは無意味なので Retry-After は付けず、意味のあるヘッダのみ付す。
export function serviceAiCapResponse(): NextResponse {
  return NextResponse.json(
    { error: "このケースのAI生成回数の上限に達しました" },
    {
      status: 429,
      headers: {
        "X-RateLimit-Limit": String(SERVICE_AI_CALL_CAP),
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}
