# バックログ

オーディが監査で検出した未修正の指摘を蓄積するファイルです。
リードがセッション開始時・PR マージ後にダイチへ内容を共有します。
アーキは次の設計時にここを参照し、関連する指摘を設計に反映してください。

---

## 未対応

### [MEDIUM] ログアウト失敗時にユーザーへの通知がない

- **ファイル**: `app/actions/auth.ts`
- **内容**: `signOut()` が失敗してもユーザーは気づかずリダイレクトされる。サーバーセッションが残存しうる
- **修正案**: `useActionState` でエラーをクライアントに返す。ただしログアウトボタンを Client Component 化する必要があり、現設計（Server Action + `<form>`）との兼ね合いで要設計判断
- **由来**: PR #2 コパ指摘

### [LOW] layout.tsx の `<main>` が子ページと二重になりうる

- **ファイル**: `app/layout.tsx:33`
- **内容**: layout が `<main>` でラップしているため、子ページが `<main>` を持つと HTML 仕様違反になる
- **修正案**: layout のラッパーを `<div>` に変更するか、子ページは `<main>` を使わないと規約化する
- **由来**: audit_20260519_162635.md / LOW-002

### [MEDIUM-001] ケースAPIが内部ユーザーIDを認証なしに公開（app/api/cases/[id]/route.ts:38、同:107、app/api/cases/[id]/argument/route.ts:107） (由来: audit_20260520_083154.md)
 (由来: audit_20260520_083154.md)
- **内容**:   (由来: audit_20260520_083154.md)
  `GET /api/cases/[id]` は認証不要なエンドポイントである（要件定義 §画面一覧: ケースルームは「認証: 任意」）。今回のコミットで `buildCaseResponse` に `defendantId: c.defendant_id ?? null` が明示的に追加され（route.ts:38）、さらに `select("*")` + `...c` スプレッドにより `plaintiff_id` / `defendant_id` を含む全DBカラムもそのままレスポンスに含まれる状態が継続している。   (由来: audit_20260520_083154.md)
  結果として、ケース IDを知る者であれば誰でも原告・被告の Supabase User UUID を取得できる。UUID は直接的な個人情報ではないが、複数ケースIDが判明しているケースでは同一 UUID の突き合わせにより同一ユーザーの参加状況（話し合い履歴の断片）を推測できる。   (由来: audit_20260520_083154.md)
  クライアント側の被告ロール復元ロジック（app/case/[id]/page.tsx:51-64）が `defendantId` を必要としている点は理解できるが、現在のユーザーが被告かどうかの判定はサーバー側エンドポイント（例: `/api/cases/[id]/my-role`）で完結させ、UUID 自体をクライアントに渡さない設計が望ましい。 (由来: audit_20260520_083154.md)
 (由来: audit_20260520_083154.md)
-- (由来: audit_20260520_083154.md)
### [LOW-001] ゲスト名（defendantName）に最大長バリデーションなし（app/api/cases/[id]/route.ts:87-90） (由来: audit_20260520_083154.md)
 (由来: audit_20260520_083154.md)
- **内容**:   (由来: audit_20260520_083154.md)
  `PATCH /api/cases/[id]` のゲスト参加パスで `body.defendantName` の最大長を検証していない。今回のコミットは当該コードブロックに Cookie 発行処理を追加しているが、長さ検証は追加されていない。同一コミット内で `topic`（200文字）と `content`（500文字）の上限検証が追加されており（app/api/cases/route.ts:14-16、app/api/cases/[id]/argument/route.ts:51-53）、ゲスト名だけが非一貫な状態にある。   (由来: audit_20260520_083154.md)
  PostgreSQL の `text` 型は最大 1 GB を格納可能であり、悪意ある入力により異常なサイズの文字列が `cases.defendant_guest_name` に書き込まれる可能性がある。ゲスト名は UI で表示されるため、極端に長い入力はレイアウト破壊を引き起こしうる。 (由来: audit_20260520_083154.md)
 (由来: audit_20260520_083154.md)
- **修正案**:   (由来: audit_20260520_083154.md)

### [MEDIUM-001] GUEST_TOKEN_SECRET 未設定時のゲスト機能全停止（lib/guest-token.ts:4） (由来: audit_20260520_084404.md)
 (由来: audit_20260520_084404.md)
- **内容**: `createHmac("sha256", process.env.GUEST_TOKEN_SECRET!)` は非 null アサーション（`!`）を使用しており、起動時・呼び出し時のいずれでも環境変数の存在チェックを行わない。`GUEST_TOKEN_SECRET` が未設定の場合、`createHmac` に `undefined` が渡り TypeError が発生する。この例外はキャッチされないため、ゲスト参加（`PATCH /api/cases/[id]`）・ゲスト発言（`POST /api/cases/[id]/argument`）のリクエストがすべて 500 Internal Server Error になる。エラーレスポンスにスタックトレースが含まれる場合、内部パスが漏洩する恐れもある。ビルドエラーにならないため、CI が通っても本番で初めて顕在化する。 (由来: audit_20260520_084404.md)
- **修正案**: アプリ起動時（例: `lib/guest-token.ts` のモジュールトップレベル）で `if (!process.env.GUEST_TOKEN_SECRET) throw new Error("GUEST_TOKEN_SECRET is not set")` として起動失敗に昇格させる。もしくは `computeToken` 内で明示的にチェックして 500 の代わりに 503 を返す構造にする。`!` アサーションの除去も合わせて行うこと。 (由来: audit_20260520_084404.md)
 (由来: audit_20260520_084404.md)
--- (由来: audit_20260520_084404.md)
 (由来: audit_20260520_084404.md)
### [MEDIUM-002] HMAC トークンが決定論的で個別取り消し不可（lib/guest-token.ts:3–6） (由来: audit_20260520_084404.md)
 (由来: audit_20260520_084404.md)
- **内容**: `computeToken` の HMAC 入力は `"${caseId}:defendant"` のみであり、ランダム要素・タイムスタンプを含まない。これにより以下の性質を持つ。 (由来: audit_20260520_084404.md)
  1. **同一ケースの token は常に同じ値**: Cookie が何らかの経路（開発環境での非 HTTPS 通信、サーバーサイドアクセスログ等）でキャプチャされた場合、Max-Age の 7 日間は完全に再利用可能。 (由来: audit_20260520_084404.md)
  2. **個別セッションの取り消し不可**: 特定ゲストの Cookie を無効化するには `GUEST_TOKEN_SECRET` 全体をローテーションするしかなく、全ケース・全ゲストのセッションが同時に失効する。 (由来: audit_20260520_084404.md)
  3. **セッションの監査証跡なし**: 同じ token 値が複数リクエストで使われても区別できない。 (由来: audit_20260520_084404.md)
 (由来: audit_20260520_084404.md)
-- (由来: audit_20260520_084404.md)
### [LOW-001] validateApiKey がエラー種別を区別しない（lib/claude.ts:17） (由来: audit_20260520_084404.md)
 (由来: audit_20260520_084404.md)
- **内容**: `validateApiKey` は Anthropic API への実際のリクエストを送り、あらゆる例外を `catch {}` で握りつぶして `false` を返す（`lib/claude.ts:17`）。Anthropic 側の一時障害・ネットワークエラー・タイムアウトと、実際に無効なキーが同じ `false` として返るため、ユーザーには「APIキーが無効です」と表示されることになる。正常なキーを持つユーザーが Anthropic 障害時に登録できない問題が発生し、ユーザーがサポートに連絡する事態になりえる。セキュリティ上の直接的な脅威はないが、誤情報の表示はユーザー信頼に影響する。 (由来: audit_20260520_084404.md)
- **修正案**: Anthropic SDK の `AuthenticationError`（ステータス 401/403）のみキャッチして `false` を返し、それ以外の例外は上位に再 throw するか、エラー種別（`"invalid_key"` / `"api_error"`）を返す union 型に変更する。 (由来: audit_20260520_084404.md)
 (由来: audit_20260520_084404.md)
--- (由来: audit_20260520_084404.md)
 (由来: audit_20260520_084404.md)

### [MEDIUM-001] `verifyGuestToken` 呼び出しが try-catch で保護されていない（`app/api/cases/[id]/argument/route.ts:35`） (由来: audit_20260520_225539.md)
 (由来: audit_20260520_225539.md)
- **内容**:   (由来: audit_20260520_225539.md)
  `argument/route.ts` の POST ハンドラ（35 行目）で `verifyGuestToken(id, cookieToken)` を呼んでいるが、try-catch で囲んでいない。   (由来: audit_20260520_225539.md)
  `verifyGuestToken` は内部で `computeToken` を呼び、`GUEST_TOKEN_SECRET` 未設定時に `new Error("GUEST_TOKEN_SECRET is not set")` を投げる。   (由来: audit_20260520_225539.md)
  この例外は POST ハンドラ内でキャッチされないため、Next.js のフレームワーク層に伝播する。   (由来: audit_20260520_225539.md)
 (由来: audit_20260520_225539.md)

---

## 対応済み

### [MEDIUM] logout() で signOut() のエラーが握り潰される

- **ファイル**: `app/actions/auth.ts`
- **対応PR**: #2
- **由来**: audit_20260519_162635.md / MEDIUM-001

### [MEDIUM] Header の非同期処理に Suspense 境界がない

- **ファイル**: `app/layout.tsx`
- **対応PR**: #2
- **由来**: audit_20260519_162635.md / MEDIUM-002
