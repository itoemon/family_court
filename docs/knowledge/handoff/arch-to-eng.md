# アーキ → ビルド 引き継ぎメモ

## タスク概要

FEAT-002 Phase 1。`profiles` テーブルへのカラム追加・Supabase Storage バケット新設・プロフィール画面 UI 拡張・弁護人AI連携改修の 4 分野にまたがる変更。API・DB・UI・AI ロジック全部に手が入るが、ページ新設はなくスコープは明確。

---

## 実装順序

1. **DB migration**: `profiles` に `avatar_url`・`defense_custom_instruction` カラムを追加する migration ファイルを作成
2. **Storage**: `avatars` バケット作成 + RLS ポリシー設定（migration または Supabase ダッシュボード）
3. **lib/types.ts**: `Profile` 型に `avatar_url` / `defense_custom_instruction` を追加
4. **lib/defense.ts**: `generateDraft` とヒアリング関数に `customInstruction?: string | null` 引数を追加し、システムプロンプト末尾への付加ロジックを実装
5. **app/api/defense/route.ts・app/api/defense/draft/route.ts**: 既存の `profiles` クエリに `defense_custom_instruction` を追加し、手順 4 の関数に渡す
6. **app/api/profile/avatar/route.ts**: アバターアップロード API Route を新規作成
7. **app/api/profile/route.ts**: カスタム指示保存の PATCH エンドポイントを追加（既存があれば拡張、なければ新規）
8. **app/profile/page.tsx**: アバター UI ブロック + カスタム指示 UI ブロックを追加

**順序の根拠**: 型定義（3）が最初に安定しないと下流の実装で型エラーが連鎖する。AI ロジック（4・5）はプロフィール UI（8）より先に固めることで、UI 側は「保存できる→AIに効く」の動線を一気に確認できる。Storage（2）はアバター API（6）より先に作成しないとテストできない。

---

## 判断根拠

### なぜアバターアップロードを直接クライアント→Storage ではなく API Route 経由にするか

環境定義書の「API Routes での書き込みは必ず `createAdminClient()` を使い、サーバーサイドで本人確認を行う。RLS に認可を委ねない」という規則に従った。Storage RLS（`(storage.foldername(name))[1] = auth.uid()::text`）も設定するが、これはサーバー側バリデーションの二重防御。主たる認可はサーバーサイド。

### なぜ拡張子込みのパス（`{user_id}/avatar.{ext}`）で旧ファイル削除が必要か

`upsert: true` はパスが完全一致した場合のみ上書きする。ユーザーが `.jpg` をアップロード後に `.png` を再アップロードすると、旧 `.jpg` が Storage に残り続ける。API Route は新アップロード前に `profiles.avatar_url` から現行パスを抽出し、存在する場合は先に削除する。

### なぜ `defense_custom_instruction` を `escapeXml + truncate` で処理するか

PR #14 (C-3) でプロンプトインジェクション対策として確立されたパターン。ユーザー入力をシステムプロンプトに埋め込む際は必ずこのパターンを適用する。DB で 200 文字制限があっても、プロンプト埋め込み時に再度 `truncate(200)` を適用して二重に保護する。

### なぜ `defense_custom_instruction` を defense API Route 内で取得するか（UI 経由で渡さない）

task.md の「弁護人APIルートで plaintiff の `defense_custom_instruction` を取得してプロンプトに渡す」という要件に基づく。UI から渡す設計にすると、改ざんによるプロンプト注入の窓口を増やす。サーバーサイドで DB から直接取得する方が安全。

---

## 注意事項（実装前に必ず確認）

### Next.js App Router での multipart/form-data 取得

Route Handler の `request.formData()` を使う。AGENTS.md の指示通り、実装前に `node_modules/next/dist/docs/` を確認してバージョン固有の API を把握すること。

### PATCH /api/profile の既存確認

API キー登録に既存の `/api/profile` エンドポイントが存在する場合は、メソッド・パスが衝突しないよう確認すること。同 PATH に複数のメソッドハンドラを共存させるか、別パスにするかは既存実装を見て判断する。

### defense API での profiles 取得クエリ拡張

`defense/route.ts` と `defense/draft/route.ts` はすでに `profiles` クエリを持っているはず。`api_key_encrypted` を取得している箇所に `defense_custom_instruction` を追加するだけでよい。クエリを新たに追加する必要はない（二重クエリにしない）。

### プロフィール画面の Server/Client Component 分割

`/profile` の既存実装が Server Component か Client Component かによって、アバターのプレビュー（ファイル選択後の即時表示）やカスタム指示のリアルタイム文字数カウンターの実装方針が変わる。ファイルを読んでから設計すること。

### `profiles.avatar_url` の URL キャッシュ

Supabase Storage の公開 URL はパスが同じなら URL 文字列も同じ（`upsert` でファイルを上書きしてもブラウザキャッシュが残る可能性がある）。CDN・ブラウザキャッシュの影響を受けないよう、再アップロード後の URL にキャッシュバスター（`?t={timestamp}` など）を付与して `profiles.avatar_url` に保存することを検討する。ただし task.md で明示されていないためオプション扱い。

---

## 未解決事項（実装時に判断が必要）

### 1. プロフィール画面の既存コンポーネント構成

`/profile` の `profiles` 取得クエリ・Server/Client 分割・アイコン表示コンポーネントの構造は実装コードを読んで確認すること。新 UI ブロックをどこに挿入するかはその確認後に決定する。

### 2. PATCH /api/profile の既存有無

API キー更新に既存の API Route があれば拡張、なければ `app/api/profile/route.ts` を新規作成する。

### 3. avatars バケット作成方式

Supabase migration（`storage.buckets` テーブルへの INSERT）とダッシュボード手動設定のどちらで行うかはプロジェクトの運用方針に従うこと。他のバケットがあれば同じ方式にそろえる。バケットが存在しない状態でアバター API が呼ばれると 500 になる。本番デプロイ前に必ず作成すること。
