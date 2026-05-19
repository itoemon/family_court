---
status: accepted
date: 2026-05-19
---

# ADR-001: テックスタック選定

## 決定内容

Next.js 14（App Router）+ TypeScript + Tailwind CSS をフロントエンド・バックエンド一体で使用する。

## 理由

- Next.js の API Routes により、フロントとバックを単一リポジトリで管理できる
- App Router により Server Components / Client Components を使い分けられる
- TypeScript により型安全性を確保し、エージェント（ビルド）がコードを書きやすい
- Tailwind CSS により UI の一貫性を保ちやすい

## 代替案

- React + FastAPI（Python）: AI 連携を Python で書きやすいが、フロントとバックの分離によりリポジトリ管理が複雑になる
- Vue / Nuxt: チームの習熟度や資料の豊富さで Next.js を選択

## 結果

Vercel との親和性が高く、デプロイが簡単になった。
