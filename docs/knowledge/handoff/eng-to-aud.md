# ビルド → テスタ・オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: FEAT-002 Phase 1（プロフィールアイコン設定・弁護人AIカスタム指示）
**日時**: 2026-05-26

---

## 変更ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `supabase/migrations/20260526000001_feat002_phase1_profiles.sql` | 新規 | `profiles` に `avatar_url` / `defense_custom_instruction` 追加。`avatars` バケット作成・RLS ポリシー設定 |
| `lib/types.ts` | 変更 | `Profile` インターフェースを追加 |
| `lib/defense.ts` | 変更 | `DefenseParams` に `customInstruction?: string \| null` を追加。両関数のシステムプロンプトへの付加ロジックを実装 |
| `app/api/cases/[id]/defense/route.ts` | 変更 | `resolveApiKey` が `defense_custom_instruction` も取得するよう拡張。`generateDefenseResponse` に渡す |
| `app/api/cases/[id]/defense/draft/route.ts` | 変更 | profiles クエリに `defense_custom_instruction` を追加。`generateDraft` に渡す |
| `app/api/profile/avatar/route.ts` | 新規 | アバターアップロード API Route（POST） |
| `app/api/profile/route.ts` | 変更 | PATCH に `defenseCustomInstruction` フィールドを追加。`displayName` の更新を optional に変更 |
| `app/profile/page.tsx` | 変更 | アバター表示・アップロード UI + カスタム指示 UI を追加 |
| `next.config.ts` | 変更 | `images.remotePatterns` に `*.supabase.co` を追加（`next/image` で Supabase Storage 画像を表示するため） |

---

## 実装上の判断・設計書からの逸脱

### G-1: アバターアップロード

- **キャッシュバスター付加**: `profiles.avatar_url` に保存する URL に `?t={timestamp}` を付与している（設計書では「オプション扱い」だが、再アップロード後のブラウザキャッシュ問題を防ぐため採用）。
- **`next/image` 使用**: ESLint の `no-img-element` 警告を解消するため `<img>` ではなく `next/image` を使用。`next.config.ts` に `*.supabase.co` の remotePatterns を追加した（設計書には記載なし）。
- **旧ファイル削除の失敗は非致命的**: 旧拡張子ファイルの削除失敗（`storage.remove` のエラー）はキャッチして無視し、アップロード処理を継続する。Storage に不要ファイルが残る場合があるが、機能の正常動作は保たれる。
- **サイズ検証**: サーバー側では `file.size` プロパティで 2MB チェック（`arrayBuffer()` より前）。`ArrayBuffer` への変換はアップロード直前のみ行う。

### G-2: 弁護人AIカスタム指示

- **`generateDraft` はシステムプロンプトなしの設計だった**: 既存の `generateDraft` は system パラメータを使っていなかった。`customInstruction` がある場合のみ `system` に「追加指示:」ラベル付きで設定する実装とした。`customInstruction` が null/undefined の場合は従来通りシステムプロンプトなし。
- **`display_name` の optional 化**: 既存の PATCH `/api/profile` は `displayName` を常に `updates` に含めていた。カスタム指示のみ更新する呼び出しでも `displayName` が必要になる問題を解消するため、`displayName` が `undefined` の場合はスキップするよう修正した。後方互換あり（既存 UI の displayName+apiKey 保存は変わらず動作する）。

---

## テスタ・オーディへの注意点

### 事前確認（デプロイ前必須）

1. **Supabase migration の適用**: `supabase/migrations/20260526000001_feat002_phase1_profiles.sql` を本番 Supabase に適用してから動作確認すること。migration 未適用の場合、アバター API と `defense_custom_instruction` の保存が 500 エラーになる。
2. **`avatars` バケットの存在**: migration の `INSERT INTO storage.buckets` が実行されているか Supabase ダッシュボードで確認すること。バケットが存在しないとアップロードが 500 になる。

### 重点確認ポイント（G-1: アバター）

1. **アップロード正常系**: JPEG / PNG / WebP を 2MB 以下でアップロードし、プロフィール画面のアイコンが更新されること。
2. **拡張子変更時の旧ファイル削除**: `.jpg` をアップロード後に `.png` を再アップロードしたとき、Storage に `{user_id}/avatar.jpg` が残らないこと。
3. **クライアント側バリデーション**: 2MB 超のファイルや対応外 MIME（例: GIF、SVG）を選択したとき、サーバーへのリクエストを送らずにエラーメッセージが表示されること。
4. **サーバー側バリデーション**: クライアント側バリデーションを迂回して不正なファイルを POST した場合に 400 が返ること。
5. **他ユーザーのパスへの書き込み**: 認証済みユーザーが `{他人のuser_id}/avatar.png` を Storage に直接アップロードしようとした場合に RLS で拒否されること（API Route 経由ではサーバー側で user.id を使うため問題なし。Storage 直接アクセスの場合の二重防御確認）。
6. **fallback 動作**: `avatar_url` が null のとき、頭文字の丸アイコン（表示名の 1 文字目）が表示されること。

### 重点確認ポイント（G-2: カスタム指示）

1. **保存正常系**: テキストエリアに入力して「AIへの指示を保存」ボタンを押すと DB に保存され、再読み込み後も入力値が復元されること。
2. **文字数カウンター**: 残り文字数がリアルタイムで更新されること。200 文字入力時に残り 0 表示になること。`maxLength={200}` により 201 文字以上入力できないこと。
3. **空欄での保存**: 空欄で保存すると `defense_custom_instruction` が `null` になり、弁護人AI のプロンプトに付加されないこと。
4. **AI 連携**: `defense_custom_instruction` を設定したユーザーが原告のケースで弁護人チャット / 回答案生成を実行したとき、AI の応答に指示の影響が出ること（ブラックボックステストで確認）。
5. **200 文字超のサーバー側拒否**: DB に直接書き込もうとした場合は CHECK 制約で弾かれること。API 経由の 200 文字超リクエストは 400 が返ること。

### セキュリティ観点

- `defense_custom_instruction` はプロンプトに埋め込む際に `escapeXml(truncate(..., 200))` で二重にサニタイズされている。プロンプトインジェクションを試みる文字列（XML タグ、改行を使った指示の上書き等）が入力された場合の挙動を確認すること。
- アバター API は `createSessionClient().auth.getUser()` で認証し、アップロードパスを `{認証済み user_id}/avatar.{ext}` に固定している。他ユーザーの ID でパスを偽装することはできない。

---

## 未実装・スコープ外にしたこと

| 項目 | 理由 |
|---|---|
| ヘッダーへのアバター表示 | task.md でスコープ外 |
| アイコントリミング・リサイズ UI | task.md でスコープ外 |
| 被告側のカスタム指示 | task.md でスコープ外 |
| 指示のプリセット選択 UI | task.md でスコープ外 |
| フレンド機能（FEAT-002 Phase 2） | task.md でスコープ外（別 PR） |
