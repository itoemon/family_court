# BUG-001 設計書 — 新規登録時に確認メールが届かない

## 概要

サインアップ後に確認メールが届かない、または届いてもリンクをクリックしてもセッションが確立されないバグの修正設計書である。

原因は複数層にまたがっており、コード・Supabase ダッシュボード設定・SMTP 設定の三点すべてを修正する必要がある。

---

## 1. 修正方針

### 根本原因の整理

| 優先度 | 原因 | 影響 |
|--------|------|------|
| 高 | `signUp()` に `emailRedirectTo` 未指定 | コールバック URL が Supabase の Site URL 設定に依存し、環境差異で壊れる |
| 高 | Supabase デフォルト SMTP の送信制限 | 無料プラン：3通/時・50通/日。開発中に上限に達すると一切届かなくなる |
| 中 | Redirect URL 許可リストに URL が未登録 | Supabase がコールバック URL をブロックし、メールリンクが無効になる |

### 修正の全体像

```
[コード修正]
  app/auth/signup/page.tsx
    └─ signUp() に emailRedirectTo を追加

[Supabase ダッシュボード設定]
  Authentication > URL Configuration
    ├─ Site URL: 本番 URL を設定
    └─ Redirect URLs: /auth/callback を許可リストに追加

[SMTP 設定（Gmail SMTP）]
  Supabase Authentication > SMTP Settings
    └─ Gmail SMTP の認証情報を設定（送信元 Gmail + アプリパスワード）
```

---

## 2. コード変更仕様

### `app/auth/signup/page.tsx`

#### 変更箇所

`signUp()` の `options` に `emailRedirectTo` を追加する。

**変更前**

```tsx
const { error } = await supabase.auth.signUp({
  email,
  password,
  options: { data: { display_name: displayName } },
});
```

**変更後**

```tsx
const { error } = await supabase.auth.signUp({
  email,
  password,
  options: {
    data: { display_name: displayName },
    emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
  },
});
```

#### 追加する環境変数

`.env.local` および本番環境の環境変数に以下を追加する。

```env
# ローカル開発
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# 本番（Vercel 等では自動設定される場合あり。明示的に定義すること）
NEXT_PUBLIC_SITE_URL=https://your-production-domain.com
```

`NEXT_PUBLIC_` プレフィックスを付けることでブラウザ側（Client Component）からも参照可能になる。`app/auth/signup/page.tsx` がサーバーサイドのみで動作する場合も、将来の移植性を考慮して `NEXT_PUBLIC_` を用いる。

#### 注意事項

- `emailRedirectTo` は Supabase ダッシュボードの Redirect URLs 許可リストに登録済みの URL でなければならない（後述）
- 末尾スラッシュの有無は許可リストの設定と統一すること

---

## 3. Supabase ダッシュボード設定チェックリスト

### 3-1. Authentication > URL Configuration

Supabase ダッシュボード → Authentication → URL Configuration で以下を確認・設定する。

#### Site URL

```
https://your-production-domain.com
```

- 本番の正規 URL を設定する
- ローカル開発では `http://localhost:3000` でも動作するが、本番と差異が出るため CI/CD の確認フローで必ずテストすること

#### Redirect URLs

以下の URL をすべて許可リストに追加する。

```
http://localhost:3000/auth/callback
https://your-production-domain.com/auth/callback
```

- ワイルドカードは `https://*.your-production-domain.com/auth/callback` の形式で指定可能だが、過度に広い許可はセキュリティリスクになる
- Vercel Preview URL を使う場合は `https://*-your-org.vercel.app/auth/callback` を追加する

### 3-2. Authentication > SMTP Settings（Gmail SMTP を使ったカスタム SMTP）

#### Gmail アプリパスワードの発行手順

1. 送信元として使う Gmail アカウントで [2 段階認証プロセス](https://myaccount.google.com/security)を有効にする
2. [アプリパスワード](https://myaccount.google.com/apppasswords)を発行する
   - アプリ名: `supabase-smtp`（識別用）
   - 発行された 16 桁の英数字パスワードを控える（再表示は不可）

#### Gmail の SMTP 認証情報

```
Host:     smtp.gmail.com
Port:     587（STARTTLS）または 465（SSL）
Username: <送信元 Gmail アドレス>
Password: <発行したアプリパスワード>
Sender:   <送信元 Gmail アドレス>
```

#### Supabase への設定方法

1. Supabase ダッシュボード → Authentication → SMTP Settings を開く
2. 「Enable Custom SMTP」をオンにする
3. 上記の SMTP 認証情報を入力する
4. 「Save」後、「Send test email」で動作確認する

#### 送信制限と切り替え判断

Gmail SMTP の送信上限は **500 通／日**。本サービスがこれを超える規模に達した場合は、Google Workspace（有料）の利用、もしくは SendGrid・Resend・Mailgun などの送信専用 SMTP に切り替える。

#### 環境変数への追加（不要）

Supabase SMTP の設定はダッシュボード上で完結する。アプリケーションコードに SMTP 認証情報を持たせる必要はない。

---

## 4. テスト方針

### 4-1. ローカル環境でのテスト

| 手順 | 確認内容 |
|------|----------|
| `NEXT_PUBLIC_SITE_URL=http://localhost:3000` を設定して開発サーバーを起動 | 環境変数が読み込まれること |
| 新規アカウントでサインアップを実行 | エラーなく「確認メールを送信しました」の表示になること |
| Gmail の「送信済みメール」を確認 | 送信ログに該当メールが記録されていること |
| 受信したメールのリンクをクリック | `/auth/callback?code=...` へリダイレクトされること |
| コールバック処理後 | ログイン状態になり、ダッシュボード等へリダイレクトされること |

### 4-2. コールバックルートの動作確認

`app/auth/callback/route.ts` は現状のコードで問題ない。以下の点のみ確認する。

- `code` が URL に含まれていること（メールリンクから遷移した場合は必ず含まれる）
- `exchangeCodeForSession` が成功すること（Redirect URL 設定が正しければ成功する）
- エラー時は `/auth/login?error=認証に失敗しました` へリダイレクトされること（既存の挙動）

### 4-3. 本番環境でのテスト

| 確認項目 | 期待結果 |
|----------|----------|
| `NEXT_PUBLIC_SITE_URL` が本番 URL に設定されていること | デプロイ環境の環境変数を確認 |
| Supabase ダッシュボードの Redirect URLs に本番 URL が登録されていること | 許可リストを目視確認 |
| 本番環境で実際にサインアップを実行 | メールが届き、リンクをクリックしてセッションが確立されること |
| Gmail の「送信済みメール」 | 本番アカウントからの送信ログが記録されていること |

### 4-4. 回帰テスト

以下の既存フローが壊れていないことを確認する。

- ログイン（Email/Password）が正常に動作すること
- `/auth/callback` が既存セッションに影響しないこと

---

## 5. 変更ファイル一覧

| ファイル | 変更種別 | 担当 |
|----------|----------|------|
| `app/auth/signup/page.tsx` | コード修正（`emailRedirectTo` 追加） | ビルド |
| `.env.local` | 環境変数追加（`NEXT_PUBLIC_SITE_URL`） | ビルド／オペレーション |
| Supabase ダッシュボード（URL Configuration） | 設定変更 | オペレーション |
| Supabase ダッシュボード（SMTP Settings） | 設定変更（Gmail SMTP） | オペレーション |

---

## 6. 関連ドキュメント

- `docs/knowledge/environment.md` — 環境変数の管理方針
- [Supabase Auth: Email Redirect](https://supabase.com/docs/guides/auth/auth-email)
- [Supabase: Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Google: アプリパスワード](https://support.google.com/accounts/answer/185833)
