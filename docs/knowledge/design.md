# 詳細設計書

## 概要（変更の目的・背景）

FEAT-002 Phase 1 として、ユーザーの個性表現要素を追加する。

- **G-1. プロフィールアイコン設定**: Supabase Storage を利用したアバター画像アップロード機能
- **G-2. 弁護人AIカスタム指示**: ユーザーが弁護人AIのシステムプロンプト末尾を上書きできる機能

変更対象は `profiles` テーブル・プロフィール画面（`/profile`）・弁護人AI連携ロジックに限定される。フレンド機能（Phase 2）・ヘッダーナビゲーション変更はスコープ外。

---

## API 仕様（変更・追加するエンドポイントのリクエスト/レスポンス定義）

### G-1: POST /api/profile/avatar

アバター画像をサーバーサイドで受け取り、Storage にアップロードし、`profiles.avatar_url` を更新する。

**リクエスト**

```
Content-Type: multipart/form-data
Field: file  (Blob)
```

| 項目 | 内容 |
|---|---|
| 受理 MIME type | `image/jpeg` / `image/png` / `image/webp` |
| ファイルサイズ上限 | 2 MB（2,097,152 bytes） |

**処理フロー**

1. `auth.getUser()` で認証確認（未認証 → 401）
2. `request.formData()` でファイル取得
3. MIME type・サイズのサーバーサイドバリデーション（不正 → 400）
4. MIME type から拡張子を決定（`image/jpeg` → `jpg`、`image/png` → `png`、`image/webp` → `webp`）
5. 既存 `profiles.avatar_url` を参照し、拡張子が異なるファイルが存在する場合は旧 Storage オブジェクトを先に削除する
6. `createAdminClient().storage.from('avatars').upload('{user_id}/avatar.{ext}', ..., { upsert: true })` でアップロード
7. `storage.from('avatars').getPublicUrl(path)` で公開 URL を取得
8. `createAdminClient()` で `profiles.avatar_url` を更新

**レスポンス（200）**

```json
{ "avatar_url": "https://..." }
```

**エラーレスポンス**

| ステータス | 条件 |
|---|---|
| 401 | 未認証 |
| 400 | MIME type 不正・サイズ超過 |
| 500 | Storage アップロード失敗・DB 更新失敗 |

---

### G-2: PATCH /api/profile

`defense_custom_instruction` など非機密プロフィールフィールドを更新する。

**リクエスト**

```json
{ "defense_custom_instruction": "string | null" }
```

| フィールド | 型 | 制約 |
|---|---|---|
| `defense_custom_instruction` | `string \| null` | 最大 200 文字。空文字列は `null` として扱う |

**処理フロー**

1. `auth.getUser()` で認証確認（未認証 → 401）
2. `defense_custom_instruction` の文字数検証（200 文字超過 → 400）
3. `createAdminClient()` で `profiles` を `update`（profiles は signup 時作成済みのため `upsert` 不要）

**レスポンス（200）**

```json
{ "success": true }
```

**エラーレスポンス**

| ステータス | 条件 |
|---|---|
| 401 | 未認証 |
| 400 | 200 文字超過 |
| 500 | DB 更新失敗 |

> **注意**: 既存の `/api/profile` PATCH エンドポイントがある場合はフィールドを追加して拡張する。ない場合は新規作成する。API キー更新エンドポイントとのメソッド・パス衝突を実装前に確認すること。

---

## データモデル（DB スキーマ・型定義の変更）

### profiles テーブルへのカラム追加

```sql
-- migration ファイルとして supabase/migrations/ に追加すること

-- G-1: アバター URL
ALTER TABLE profiles
  ADD COLUMN avatar_url text;

-- G-2: 弁護人カスタム指示
ALTER TABLE profiles
  ADD COLUMN defense_custom_instruction text
  CHECK (defense_custom_instruction IS NULL OR char_length(defense_custom_instruction) <= 200);
```

両カラムとも nullable。既存レコードへの影響なし（デフォルト値の設定不要）。

---

### Supabase Storage: avatars バケット

バケット作成と RLS ポリシーを migration または Supabase ダッシュボードで設定する。

```sql
-- バケット作成（public = true: 公開 URL で直接参照可能）
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true);

-- 認証済みユーザーが自分の {user_id}/ 配下のみ操作できる
CREATE POLICY "Users can upload own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can update own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 読み取りは全員可（公開 URL で直接参照するため）
CREATE POLICY "Anyone can read avatars"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'avatars');
```

---

### TypeScript 型定義の変更（lib/types.ts）

`Profile` 型に以下を追加する。

```typescript
type Profile = {
  // ... 既存フィールド ...
  avatar_url: string | null;
  defense_custom_instruction: string | null;
};
```

---

## コンポーネント設計（新設・変更するファイルの責務と仕様）

### app/api/profile/avatar/route.ts（新規）

**責務**: アバター画像のサーバーサイドバリデーション・Storage アップロード・`profiles.avatar_url` 更新。

| 項目 | 内容 |
|---|---|
| メソッド | POST |
| 認証 | `auth.getUser()` |
| Supabase クライアント | `createAdminClient()`（Storage 操作・profiles 更新） |
| フォームデータ取得 | `request.formData()` |
| MIME type → 拡張子マッピング | `image/jpeg` → `jpg` / `image/png` → `png` / `image/webp` → `webp` |

---

### app/api/profile/route.ts（新規 or 既存を拡張）

**責務**: `defense_custom_instruction` などの非機密プロフィールフィールドの更新。PATCH メソッドを実装する。

---

### app/profile/page.tsx および関連コンポーネント（変更）

プロフィール画面に以下 2 つの UI ブロックを追加する。

**G-1: アバター表示・アップロード UI**

| 要素 | 仕様 |
|---|---|
| アイコン表示 | `avatar_url` が non-null なら `<img>` を表示。null なら現行の頭文字丸アイコンを fallback として表示 |
| ファイル選択 | `<input type="file" accept="image/jpeg,image/png,image/webp">` を hidden にし、label または button でラップ |
| クライアントサイドバリデーション | MIME type・サイズ（2MB 以下）をアップロード前にチェックし、不正なら UI でエラーメッセージを表示 |
| アップロード中状態 | ローディングインジケーターを表示し、完了または失敗まで送信ボタンを disabled にする（二重送信防止） |

**G-2: カスタム指示 UI**

| 要素 | 仕様 |
|---|---|
| テキストエリア | `maxLength={200}`、`rows` は 3 以上 |
| 文字数カウンター | `200 - 現在文字数` をリアルタイム表示（0 未満は表示しない） |
| 保存ボタン | クリックで PATCH /api/profile を呼び出す |

---

### lib/defense.ts（変更）

`generateDraft` とヒアリング質問生成関数のパラメータに `customInstruction` を追加する。

```typescript
// 追加するパラメータ（両関数共通）
customInstruction?: string | null
```

**システムプロンプトへの付加方式**

`customInstruction` が truthy な場合のみ、システムプロンプトの末尾に「追加指示:」ラベル付きで付加する。

```typescript
const systemPrompt = baseSystemPrompt
  + (customInstruction
      ? `\n\n追加指示:\n${escapeXml(truncate(customInstruction, 200))}`
      : '');
```

- `escapeXml` と `truncate` は既存ユーティリティ（PR #14 C-3 で確立）をそのまま流用する
- `truncate` の上限は DB CHECK 制約と合わせて 200 文字

---

### app/api/defense/route.ts、app/api/defense/draft/route.ts（変更）

両ルートはすでに plaintiff の `profiles` を参照して `api_key_encrypted` を取得している。同一クエリに `defense_custom_instruction` を追加し、`lib/defense.ts` の関数呼び出しに渡す。

```typescript
// 既存クエリに defense_custom_instruction を追加
const { api_key_encrypted, defense_custom_instruction } = profile;

// 関数呼び出しに追加
await generateDraft({ ..., customInstruction: defense_custom_instruction });
```

---

## セキュリティ設計（認証・認可・入力検証の方針）

### 認証・認可

- 全 API Route で `auth.getUser()` による認証確認（`getSession()` は使用しない。requirements.md のセキュリティ要件に準拠）
- Storage 書き込みは `createAdminClient()` 経由で行い、アップロードパスが `{認証済み user_id}/...` に一致することをサーバーサイドで検証してから実行する
- Storage には別途 RLS ポリシーを設定し、直接アクセスへの二重防御とする

### 入力検証

| 入力 | 検証方法 |
|---|---|
| アバターファイル | MIME type（allowlist: jpeg/png/webp）・サイズ（≤ 2MB）をサーバーサイドで検証 |
| defense_custom_instruction | API Route で ≤ 200 文字の検証 + DB の CHECK 制約（二重バリデーション） |
| プロンプト埋め込み時 | `escapeXml(truncate(customInstruction, 200))` によるプロンプトインジェクション対策 |

### アバター URL の扱い

- `profiles.avatar_url` に保存するのは Supabase Storage の公開 URL（平文）であり、機密情報ではない。暗号化不要
- `avatar_url` はクライアントに返してよい

---

## 制約・前提条件

1. **profiles レコードの存在保証**: `PATCH /api/profile` は `upsert` ではなく `update` を使う。profiles レコードはサインアップ時に作成される前提。この前提が崩れる場合はガード処理を追加すること。

2. **avatars バケットの事前作成**: Supabase Storage バケットは migration（`storage.buckets` テーブルへの INSERT）またはダッシュボードで作成する。作成を忘れると `/api/profile/avatar` が 500 エラーになる。

3. **拡張子変更時の旧ファイル削除**: `{user_id}/avatar.jpg` → `{user_id}/avatar.png` のように拡張子が変わる再アップロードでは、`upsert: true` では旧オブジェクトが残る。API Route は新アップロード前に `profiles.avatar_url` から旧パスを抽出し、Storage オブジェクトを明示的に削除すること。

4. **弁護人カスタム指示は原告のみ**: `defense_custom_instruction` は plaintiff（原告）のプロフィールから取得してプロンプトに付加する。被告側カスタム指示はスコープ外。

5. **Next.js App Router での multipart 取得**: Route Handler で `multipart/form-data` を受け取る場合は `request.formData()` を使用する（`body-parser` は不要）。実際の API は AGENTS.md の指示に従い `node_modules/next/dist/docs/` で確認すること。

6. **未解決: プロフィール画面の現行コンポーネント構成**: `/profile` の既存 Server/Client Component 分割・`profiles` 取得クエリの構造は実装コードを確認して判断すること。新 UI ブロックをどの階層に追加するかは実装時に決定する。

7. **未解決: PATCH /api/profile の存在確認**: API キー登録に既存の PATCH エンドポイントが存在する場合は拡張する。ない場合は新規作成する。
