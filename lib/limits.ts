import type { Duration } from "@upstash/ratelimit";

// SEC-002: レート制限・生成上限の閾値を一元集約するモジュール。
//
// 価格定義（lib/credit-packages.ts）と同様、閾値は本ファイル 1 箇所に集約し
// 「コード変更のみで調整可能」とする。将来のキー種別／プラン別の閾値切替（MON の
// 拡張）に備え、定数は「用途名 → 閾値」の形で保持し、後から関数化できる余地を残す
// （本 PR では固定値で足りる）。

export interface RateLimitConfig {
  // 窓あたりの許可リクエスト数。
  requests: number;
  // スライディングウィンドウ幅（Upstash の Duration 表記。例: "1 m"）。
  window: Duration;
}

// 第 1 層（濫用抑止）: 全 AI ルート横断のレート制限。20 リクエスト/分/識別子。
export const AI_RATE_LIMIT: RateLimitConfig = { requests: 20, window: "1 m" };

// 既存 users/search の挙動を不変に保つためのレート制限。30 リクエスト/分/user.id。
export const SEARCH_RATE_LIMIT: RateLimitConfig = { requests: 30, window: "1 m" };

// 第 2 層（課金上限・money-critical）: uses_service_key=true のケースあたり、
// サービスキーで実行する AI 生成の累積回数上限。BYOK には課さない。
export const SERVICE_AI_CALL_CAP = 30;
