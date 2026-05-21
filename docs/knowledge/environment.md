# 環境定義書

## 技術スタック

| カテゴリ | 技術 | バージョン |
|----------|------|-----------|
| フレームワーク | Next.js (App Router) | 16.2.6 |
| UI ライブラリ | React | 19.2.4 |
| 言語 | TypeScript | 5.x |
| スタイリング | Tailwind CSS | 4.x |
| BaaS | Supabase (@supabase/ssr, @supabase/supabase-js) | 0.10.3 / 2.105.4 |
| AI SDK | @anthropic-ai/sdk | 0.96.0 |
| デプロイ | Vercel | — |

---

## ディレクトリ構成（実装コード）

```
app/          # ページ・API Routes (Next.js App Router)
lib/          # 共有ロジック・ユーティリティ
  supabase/
    server.ts   # サーバー側 Supabase クライアント
    client.ts   # ブラウザ側 Supabase クライアント
  types.ts      # 共通型定義
  crypto.ts     # API キー暗号化ユーティリティ
  claude.ts     # Claude API 呼び出し
supabase/
  schema.sql    # DB スキーマ定義
middleware.ts   # セッション更新・認証リダイレクト
```

---

## Supabase クライアントの使い分け

| クライアント | 関数 | 用途 | RLS |
|---|---|---|---|
| セッションクライアント | `createSessionClient()` | 認証済みユーザーの操作 | 適用される |
| 管理者クライアント | `createAdminClient()` | API Routes の信頼済み書き込み操作 | バイパス |
| ブラウザクライアント | `createClient()` | Client Component からの読み取り | 適用される |

**規則**: API Routes での書き込みは必ず `createAdminClient()` を使い、サーバー側コードで本人確認を行う。RLS に認可を委ねない。

---

## 認証方式

- **認証基盤**: Supabase Auth（メール/パスワード）
- **セッション管理**: `@supabase/ssr` による httpOnly cookie（`middleware.ts` でセッションを常時更新）
- **ルーティング保護**: `middleware.ts` が未ログインユーザーを `/auth/login` にリダイレクト
- **対象外パス**: `/auth/**`、`/api/**`、静的ファイルは middleware をスキップ

### ゲスト（被告）の扱い

被告はアカウント不要でゲスト参加が可能。Supabase セッションを持たないため、RLS での識別は不可。サーバー側で別途本人確認が必要（現在は HMAC トークンを httpOnly cookie で管理する方針で設計中）。

---

## DB スキーマ概要

| テーブル | 主な役割 |
|---|---|
| `profiles` | auth.users と 1 対 1。display_name・暗号化済み API キーを保持 |
| `cases` | 話し合いケース。原告 (plaintiff_id) と被告（認証済み defendant_id または guest_name）を持つ |
| `arguments` | 各ターンの発言。case_id・role・phase・round を持つ |
| `verdicts` | AI 裁判官の判決。case_id に UNIQUE 制約（1 ケース 1 判決） |

**RLS 方針**: 全テーブルで RLS 有効。読み取りは全て公開（共有リンクアクセスのため）。書き込みは API Routes 経由で管理者クライアントが行う。

---

## AI 連携

- **API キー**: アプリが持つのではなく、ユーザーが自分のキーを登録する方式
- **保存**: AES-256-GCM で暗号化して `profiles.api_key_encrypted` に保存
- **キー検証**: 保存時に `claude-haiku-4-5-20251001` で 1 トークンのテストリクエストを送信
- **判決生成**: `claude-sonnet-4-6` を使用

---

## 環境変数

| 変数名 | 必須 | 用途 |
|--------|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase プロジェクト URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅ | Supabase anon キー（公開可） |
| `SUPABASE_SECRET_KEY` | ✅ | Supabase service role キー（サーバー専用） |
| `ENCRYPTION_KEY` | ✅ | AES-256-GCM キー（64 桁 hex）。`openssl rand -hex 32` で生成 |
| `GUEST_TOKEN_SECRET` | ✅ | ゲスト HMAC トークン署名キー。`openssl rand -hex 32` で生成（HIGH-001 対応後に追加） |

`NEXT_PUBLIC_` 接頭辞の変数はブラウザに公開される。秘密情報を持たせないこと。
