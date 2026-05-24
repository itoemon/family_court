# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。

## 今回のタスク

矛盾チェック機能を実装する。
同一ユーザーの過去ケース（判決済み）と現在進行中のケースを比較し、過去の自分の主張と矛盾する発言をしていないか AI が検出・警告する機能。

## 背景・目的

ユーザーが過去に「Aが正しい」と主張していたのに、別のケースで「Aは間違いだ」と主張するような矛盾が発生しうる。
これを検出することで話し合いの質を高め、アプリの差別化ポイントにもなる。

## 機能要件

### 1. 矛盾チェックのトリガー

- ユーザーが発言を投稿した直後（POST /api/cases/[id]/argument の後）に非同期で実行
- 発言者本人の過去ケース（phase = "verdict"）の arguments を参照する
- 過去のケースが存在しない場合はスキップ（静かに何もしない）

### 2. AI による矛盾判定

- 使用モデル: claude-haiku-4-5-20251001（コスト重視）
- 入力:
  - 今回の発言内容（content）
  - 今回のケースのトピック（topic）
  - 過去ケースから抽出した同一ユーザーの発言リスト（直近 3 ケース分、各ケース最大 5 発言）
- 出力: 矛盾ありの場合のみ警告メッセージ（50 文字以内の日本語）、なければ null
- プロンプトは XML タグでユーザー入力を区切ること（プロンプトインジェクション対策）

### 3. 矛盾警告の表示

- 矛盾あり判定の場合、`contradiction_warnings` テーブルに保存
- ケースページのタイムラインに、対象発言の直下に警告バブルとして表示
- 警告バブルのデザイン: ⚠️ アイコン + amber 系の配色（judge バブルと区別する）
- 発言者本人にのみ表示（相手・observer には見せない）

### 4. DB スキーマ

新規テーブル `contradiction_warnings` を追加：

```sql
CREATE TABLE contradiction_warnings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  argument_id uuid NOT NULL REFERENCES arguments(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS: 本人のみ参照可
ALTER TABLE contradiction_warnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users can read own warnings"
  ON contradiction_warnings FOR SELECT
  USING (user_id = auth.uid());
```

## スコープ外

- 相手の発言との矛盾チェック（自分の過去発言との比較のみ）
- 矛盾の深刻度分類
- 警告の非表示・スヌーズ機能
- ページネーション（過去ケース参照は直近 3 件で固定）
