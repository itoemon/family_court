---
status: accepted
date: 2026-05-19
---

# ADR-005: デプロイ環境

## 決定内容

Vercel を本番・プレビュー環境として使用する。

## 理由

- Next.js との親和性が最も高く、ゼロ設定でデプロイできる
- PR ごとに Preview URL が自動生成されるため、QA 環境として機能する（pipeline.md の QA ステップを Vercel Preview で代替）
- Supabase との組み合わせで、インフラを自前管理せずフルスタックアプリを運用できる
- 無料枠でプロトタイプ〜小規模運用が可能

## 環境構成

| 環境 | URL | トリガー |
|------|-----|---------|
| Production | family-court.vercel.app | main ブランチへのマージ |
| Preview | *.vercel.app (PR ごと) | PR 作成・更新 |

## 環境変数

Vercel のダッシュボードで管理（`.env.local` は開発用のみ）。
`NEXT_PUBLIC_*` はビルド時に埋め込まれ、それ以外はサーバーサイド専用。

## 代替案

- **Render / Railway**: Next.js との統合が Vercel より手動設定が多い
- **AWS / GCP**: インフラ管理コストが高く、現段階では過剰
