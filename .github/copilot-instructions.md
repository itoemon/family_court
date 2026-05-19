# コパへのレビュー指示

このリポジトリは「家庭裁判所」— 恋人・夫婦・家族が裁判形式で話し合いを行い、AI が判決を下す Web アプリです。

## テックスタック

- **フロントエンド/バックエンド**: Next.js 14 App Router + TypeScript + Tailwind CSS
- **DB / Auth**: Supabase（PostgreSQL + RLS + Auth）
- **デプロイ**: Vercel

## レビュー観点

以下の点を重点的に確認してください。

### 必須チェック
- **要件との整合**: PR 説明文に記載された要件を実装が満たしているか
- **デグレード**: 既存機能（認証フロー・ケース作成・発言・判決）が壊れていないか
- **セキュリティ**: XSS・SQLi・認証バイパス・秘密情報のハードコード

### 設計ルール
- Server Component / Client Component の使い分けが正しいか（不要な `'use client'` がないか）
- Supabase クライアントの使い分け:
  - `createSessionClient()` → ユーザーセッションが必要な操作（RLS 適用）
  - `createAdminClient()` → 信頼済みサーバー操作（RLS バイパス）
- ログアウトは Server Action + `<form>` で実装（Client Component 化しない）
- セッション取得は `auth.getUser()` を使う（`getSession()` はキャッシュ値のため不使用）

### デザイン原則
- このアプリは対立・緊張感を煽らない「温かみのある UI」が要件
- 赤・強調色・攻撃的な表現が混入していないか

## 判定
- 明確なバグ・セキュリティ問題・要件不整合があれば `REQUEST CHANGES`
- 軽微な改善提案のみであれば `COMMENT`（承認は人間が行う）
