# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。

## 今回のタスク

弁護人AI機能を実装する。
ユーザは、ユーザ同士の対話チャットとは別に、自分専用の弁護人AIとの個人チャットを利用できる。
弁護人AIはヒアリングを通じてユーザの気持ちや主張を整理し、対話チャットへの回答案を生成する。

## 背景・目的

感情的になりがちな家族間・夫婦間の対話において、ユーザが自分の主張を整理しやすくなることを目的とする。
弁護人AIが共感的なヒアリングを行い、次のターンの回答案を作成することで、冷静かつ建設的な対話を促進する。

## 機能要件

### 1. UI：チャット切り替えナビゲーション

- ケースページ（`/case/[id]`）をチャット切り替え型の 2 ビュー構成に変更する
  - **対話チャット**: 既存のユーザ同士の対話（変更最小限）
  - **弁護人AIチャット**: 自分専用の弁護人AIとの個人チャット
- ナビゲーションは Teams / Slack / LINE のようなサイドバー or タブ切り替え形式
- 弁護人AIチャットは**相手ユーザには非公開**（RLS で自分のみ参照可）

### 2. 弁護人AIチャット

- ユーザと AI が多ターンでやり取りできるチャット UI
- AI は共感力が高く、感情に寄り添うキャラクター（詳細は § 5 プロンプト参照）
- 会話はターンをまたいでリセットされない（ケース単位で永続）
- チャット欄の末尾に「回答案を作成する」ボタンを常時表示

### 3. 回答案生成フロー

1. ユーザが「回答案を作成する」ボタンを押す
2. API が以下を入力として回答案を生成する:
   - 対話チャットの発言履歴（`arguments` テーブル）
   - 弁護人AIとの会話履歴（`defense_messages` テーブル）
3. 生成された回答案をオーバーレイ（モーダルポップアップ）で表示
4. ユーザが回答案を加筆修正（任意）
5. 「送信」を押すと対話チャットへ自動投稿 → ビューが対話チャットに自動切り替わる
6. 「キャンセル」を押すとモーダルを閉じる（会話は保持）

### 4. DB スキーマ

新規テーブル `defense_messages` を追加：

```sql
CREATE TABLE defense_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  role       text NOT NULL CHECK (role IN ('user', 'assistant')),
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: 本人のみ参照・作成可
ALTER TABLE defense_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users can read own defense messages"
  ON defense_messages FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "users can insert own defense messages"
  ON defense_messages FOR INSERT
  WITH CHECK (user_id = auth.uid());
```

### 5. AI プロンプト方針

**弁護人AIチャット（ヒアリング）**

- モデル: `claude-haiku-4-5-20251001`（レスポンス速度重視）
- キャラクター: 共感力が高く、感情に寄り添う弁護人
  - まずユーザの気持ちを受け止めてから質問する
  - 詰問せず、ユーザが話しやすい雰囲気を作る
  - 1 ターンで複数の質問を連打しない（1 つずつ丁寧に）
- 入力: ケースのトピック（topic）・現在の対話チャット履歴・弁護人AI会話履歴
- ユーザ入力は XML タグで区切る（プロンプトインジェクション対策）

**回答案生成**

- モデル: `claude-haiku-4-5-20251001`
- 入力: 対話チャット履歴・弁護人AI会話履歴・ケーストピック
- 出力: 次のターンで相手に伝える発言文（日本語・200 文字以内）
- ユーザ入力は XML タグで区切る（プロンプトインジェクション対策）

### 6. API ルート

- `POST /api/cases/[id]/defense` — 弁護人AIへのメッセージ送信・AI 応答返却
- `POST /api/cases/[id]/defense/draft` — 回答案生成

## スコープ外

- 相手ユーザの弁護人AI会話履歴への参照
- 弁護人AIによる自動ヒアリング開始（ユーザが話しかけるまで AI は動かない）
- 回答案の複数候補生成
- 会話履歴のリセット機能
