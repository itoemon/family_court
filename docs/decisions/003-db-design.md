---
status: accepted
date: 2026-05-19
---

# ADR-003: データベース設計

## 決定内容

Supabase（PostgreSQL）を使用する。スキーマは `supabase/schema.sql` に定義。

```
profiles      ← auth.users と 1対1（APIキー暗号化保存）
cases         ← 話し合いのケース（提案者ID必須、反対者はID or ゲスト名）
arguments     ← 各ターンの発言
verdicts      ← AI 裁判官の判決
```

## 理由

- データ構造が明確にリレーショナルなため SQL が適切（NoSQL を選ぶ理由がない）
- Supabase は PostgreSQL ベースで、リアルタイム購読・Auth・RLS が標準搭載
- 現状のポーリング方式を将来的に Supabase Realtime に置き換えられる
- pgvector による意味検索（過去の裁判を参考に判決など）への拡張も可能

## セキュリティ設計

- Row Level Security（RLS）を全テーブルで有効化
- cases・arguments・verdicts は「誰でも読める」（共有リンク方式のため）
- profiles は本人のみ読み書き可能
- API Routes はサービスロールキーで RLS をバイパスし、信頼済み操作を行う

## APIキー暗号化

ユーザーの AI API キーは AES-256-GCM で暗号化して `profiles.api_key_encrypted` に保存。
暗号化キーは `ENCRYPTION_KEY` 環境変数（Vercel に登録）。
