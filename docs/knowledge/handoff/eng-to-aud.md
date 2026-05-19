# ビルド → オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: HIGH-001 発言エンドポイント認可バイパスの修正  
**コミット**: a83e17b  
**日時**: 2026-05-20

---

## 実装上の判断・変更点

### 設計書通りに実装した点

- `lib/guest-token.ts` を新設。`generateGuestToken` / `verifyGuestToken` の 2 関数のみ。
- `verifyGuestToken` 内で `timingSafeEqual` 使用前に Buffer 長の一致を確認（`RangeError` 対策）。
- `PATCH /api/cases/[id]` のゲスト参加成功パスで `guest_defendant_{caseId}` Cookie を httpOnly・SameSite=Strict・`path: /api/cases/{caseId}` で発行。
- `POST /api/cases/[id]/argument` のフェーズ検証直後に身元確認ブロックを追加。`callerRole` を DB 照合で導出し、`body.role` は一切参照しない。
- `AddArgumentRequest` 型から `role` を削除。
- `app/case/[id]/page.tsx` の argument API 呼び出しから `role` フィールドを削除。

### 設計書から逸脱した点

なし。設計書・アーキ引き継ぎメモと完全に一致する実装を行った。

---

## オーディへの注意点

1. **`GUEST_TOKEN_SECRET` 環境変数の未設定リスク**  
   `lib/guest-token.ts` は `process.env.GUEST_TOKEN_SECRET!` を非 null アサーションで参照する。環境変数が未設定の場合、ゲスト参加・発言時にランタイムエラーになる（ビルドエラーにはならない）。`.env.local` および Vercel への設定がダイチによって完了しているか確認すること。

2. **既存ゲストセッション（Cookie 未発行）の互換性**  
   今回の変更以前にゲスト参加したセッションは Cookie を持たないため、発言時に 403 が返る。設計書で「本番デプロイ前の修正のため許容範囲内」と明記されているが、本番環境に既存ゲストセッションが存在する場合の影響を確認すること。

3. **Cookie の `path` スコープ**  
   Cookie の `path` は `/api/cases/{caseId}` に限定されている。`/api/cases/{caseId}/argument` はこのパスに含まれるため正常に動作する。

4. **認証済みユーザーがケースと無関係な場合**  
   ログイン済みでも当該ケースの `plaintiff_id` / `defendant_id` いずれにも一致しないユーザーは 403 になる（設計通り）。

5. **ゲスト被告が別ブラウザでアクセスした場合**  
   Cookie は httpOnly のため JS から読めず、別ブラウザ・シークレットモードでは Cookie が送信されないため 403 になる。現状はエラーメッセージ「このケースへの発言権限がありません」のみで、再参加 UI は未実装。フロント対応の必要性は次回以降の判断。

---

## 未実装・スコープ外にしたこと

- **MEDIUM・LOW 指摘全般**: task.md の指示に従い HIGH-001 のみを対象とした。
- **MEDIUM-003（verdicts テーブルへの UNIQUE 制約）**: ビルドの権限外。リードを通じてダイチが対応する。
- **ゲスト再参加フローの UI**: アーキ引き継ぎで「次のオーディ指摘次第で検討」とされており、本タスクのスコープ外。
- **`GUEST_TOKEN_SECRET` の実際の値設定**: コード実装のみを担当。値の生成（`openssl rand -hex 32`）と環境変数の設定はリードを通じてダイチが行う。
