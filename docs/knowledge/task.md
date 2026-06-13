# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。
>
> **重要 1**: `docs/knowledge/design.md` は永続資料である。**既存の設計（FEAT-001〜FEAT-005、MEDIUM-001、LOW バッチ、FEAT-RESP-HEADER、BUG-002/003 等、過去 PR の設計）を絶対に削除・短縮しないこと**。本タスクの内容は `design.md` の末尾に新規セクションとして **追記** すること（[[feedback-design-md]] 参照）。
>
> **重要 2**: 本タスクは **DB マイグレーション伴う**（`cases` に新カラム追加 + `profiles` に新カラム追加 + 旧データ全削除）。RLS は新カラムにのみ波及する範囲で更新する。
>
> **重要 3**: 旧ケースデータ（`max_rounds = 2 / 5` のもの、および `max_rounds = 3` も含む既存全件）を **削除する** ことが要件である。本番 DB は現状テストデータのみのため後方互換ロジックは作らない。

## 今回のタスク

ケースのチャット回数の仕様を、現行の「2 回 / 3 回 / 5 回」固定選択方式から、**3 回デフォルト + 両者合意による早期終了 + 双方の意思での 3 回延長** に変更する。あわせて開始と終了の挨拶を **固定メッセージ化**（ユーザー入力ではなくシステム自動投入）し、ユーザーがプロフィール編集画面 (`/profile`) から固定文を上書き設定できるようにする。

**バックログ ID**: `FEAT-006`（`docs/backlog.md` 参照）

---

### 背景

- 現状は `cases.max_rounds` (`int not null default 3`) に対し、ケース作成画面 (`app/page.tsx`) で「2 回（さらっと）/ 3 回（ちょうどよく）/ 5 回（じっくりと）」の 3 値選択 UI を提供。
- ユーザーから「短く済ませたい時 / 長く議論したい時」両方への柔軟性は欲しいが、最初に固定値を選ばせる UX は摩擦が大きく、また「挨拶」もカウントに含まれることで実質の議論回数が目減りしている。
- そこで、開始時はデフォルト 3 回で固定し、(a) 早期終了は会話中に両者の合意で発火、(b) 3 回終了後に「もう少し話したいか」を両者に確認して片方でも続行希望なら +3 ラウンド、という形に変更する。挨拶は固定文化してラウンド外で扱う。

---

### 要件（リード確定事項）

#### 1. デフォルト値と作成 UI

- `cases.max_rounds` の初期値は `3` 固定（現行 schema の default 3 に一致）。
- `app/page.tsx` のケース作成画面から **`<select>` の「2 回 / 3 回 / 5 回」選択肢を撤廃**。`maxRounds` 状態と body 送信を除去し、API 側で `max_rounds = 3` をサーバ採番する形に揃える。
- ケース作成 API (`app/api/cases/route.ts`) が body の `maxRounds` を受け取っている場合、当該フィールドは無視する（互換のため `400` は出さず、サーバ側で常に `3` を採用）。

#### 2. 早期終了（両者合意で終了）

- チャット画面 (`app/case/[id]/CaseRoom.tsx`) の **サイドに常設の「終了を提案」アイコン** を配置する。配色は控えめ（`stone-*` 系トーン、`brand-500` 不使用）。
- 押下時の状態管理:
  - `cases` に **`end_proposed_by uuid null`** を追加（NULL = 未提案、UUID = 提案者の `user_id`）。
  - 自分が押す → `end_proposed_by = 自分の user_id`。相手側 UI には「相手が終了を提案しています」バナーを表示。
  - 相手が同じアイコンを押す（または「同意して終了」CTA を押す）→ `phase = "judging"` へ遷移（既存の判決生成フローを再利用）。
- 提案を撤回したい場合は、提案者が再度同じアイコンを押すと `end_proposed_by = NULL` に戻る。
- 早期終了が確定したラウンドの途中までの `arguments` はそのまま保持し、判決生成は既存ロジックを再利用する。

#### 3. 延長分岐（3 回終了後 / 延長後の再分岐）

- 現行の判決遷移（`phase === "verdict"` への移行）の前段に、**「続けたい / 終わりたい」の 2 択モーダル** を両者に出す段階を挟む。
  - cases に **新 phase `"extension_voting"`** を追加（or 既存 `phase` enum に値追加）。phase ラベル定義 (`PHASE_LABELS` など) も併せて更新。
- 投票の保存先:
  - 案 A: `cases` に **`extension_vote_plaintiff text null`** / **`extension_vote_defendant text null`** を追加（値: `"continue"` / `"finish"` / NULL）。
  - 案 B: 別テーブル `case_extension_votes(case_id, user_id, vote, created_at)` を作る。
  - 上記 2 案のトレードオフを `design.md` に記載し、アーキが推奨を明記。**履歴を 1 回分だけ持てば良ければ A、複数延長の履歴も持つなら B**。
- 判定ロジック: **どちらか一方でも `continue` を選択した時点で +3 ラウンド延長**（OR 条件）。両者 `finish` でのみ判決へ進む。
  - 「+3 ラウンド」は `cases.max_rounds += 3` を加算する形（カラムは残す方針）。
- 延長後も同じ 3 回終了タイミングで再度モーダルを出す。回数の上限は設けない（ダイチ判断、上限が必要なら設計時にアーキが提案）。

#### 4. 固定挨拶メッセージ

- 開始時と終了時の挨拶を **システム自動投入** とし、ユーザー入力ではない。
  - 開始時デフォルト: 「よろしくお願いします」
  - 終了時デフォルト: 「ありがとうございました。」
- 保存先: **`profiles`** に **`opening_greeting text`** / **`closing_greeting text`** を追加。NULL の場合はサーバ側デフォルトを使う（カラム自体は NOT NULL ではなく nullable で OK、初期値は SQL の default で上記文字列）。
- 編集画面: `/profile`（プロフィール編集ページ）に「開始時の挨拶」「終了時の挨拶」テキスト入力欄を追加。空文字保存はバリデーションで弾く（NULL 化したい場合は「デフォルトに戻す」ボタンを提供）。
- マイページ (`/me`) からの導線: 既存どおり `/profile` リンクで遷移するのみ。マイページ本体には挨拶設定 UI は **追加しない**。
- 挨拶メッセージは **ラウンドカウントに含めない**。`arg.round` への加算を行わない。
  - 保存場所: 既存テーブルへの記録方針（`arguments` テーブルに `is_greeting boolean` を足すか、もしくは `judge_messages` の用途を流用するか、もしくは別テーブル `case_greetings` を作るか）はアーキ判断とし、根拠を `design.md` に書く。
  - 表示: チャット画面では他のメッセージと同様の吹き出しで表示するが、ラベル（例: 「開始の挨拶」「終了の挨拶」）を小さく付ける。

#### 5. 旧データ削除（マイグレーション最初のステップ）

- 本 PR の最初のマイグレーション SQL で、**`cases` / `arguments` / `verdicts` / `judge_messages` の全行を削除** する。
  - 削除順: FK 依存関係に従い `arguments` → `verdicts` → `judge_messages` → `cases` の順、または cascade 設定済みなら `DELETE FROM cases;` で一括。schema 確認の上、アーキが順序を確定する。
  - 本番 + テスト DB の両方で適用する想定（migration として履歴に残す）。
- 削除を含む migration の名前は時刻昇順ファイル名規約（例: `20260612NNNNNN_feat006_*.sql`）に従う。
- 既存ユーザーの `profiles` / `friend_requests` / `laws` / `law_*` 関連テーブルは **保持** する（チャット履歴のみ削除）。

---

### スコープ外（重要）

- ケース作成画面の他項目（topic、被告選択フロー）は変更しない。
- 「終了を提案」の通知をリアルタイム push する仕組みは導入しない。既存のポーリング機構（CaseRoom が phase / round を polling する仕組み）に揃えて、相手側にも 5〜10 秒で伝わる程度で十分。
- 弁護人 AI の挙動・プロンプト・出力契約は変更しない（挨拶を AI 経由で生成することはしない、システム固定文を直接挿入する）。
- 延長回数の上限。
- 判決画面 (`/case/[id]/verdict`) の UI 改修。判決ロジック側は既存どおり、入力されたラウンド数で評価する。
- 挨拶設定の i18n / 国際化対応。
- 既存ケースのデータ補正・移行（**削除のみで対応**、後方互換ロジックは作らない）。
- マイページ (`/me`) 本体への挨拶設定 UI 追加（`/profile` のみ）。
- breakpoint の導入。本対応も全画面サイズで同じ UI を維持。
- 配色トーンの追加（`stone-*` / `brand-700` / `brand-800` の範囲で完結。`brand-500` 不使用）。

---

### 解決すべき設計上の課題

#### A. 「終了を提案」アイコンの UI 配置と発火 UX

- チャット欄サイド（既存レイアウト上、自分の発言欄の近く）に常設する。アイコンの選定（絵文字 or SVG）、ホバー / 押下挙動、提案中の状態表示（相手側バナー含む）をアーキが決定。
- 「自分が提案中」を表す視覚的フィードバック（押下後にアイコンの色が変わる / トグル状態が分かる等）が必要。
- 「相手が提案中」を表す UI（例: 画面上部に dismiss 可のバナー、または常設のサイド表示の状態切り替え）の挙動定義。

#### B. 延長分岐モーダルの発火タイミングと再表示

- `phase === "judging"` への遷移直前で **`phase = "extension_voting"`** に切り替え、両者の投票が揃うまで停留する。投票後に集計し:
  - 両者 `finish` → `phase = "judging"`（判決生成へ）
  - どちらかが `continue` → `cases.max_rounds += 3` 加算 → `phase = "argument"` に戻す
- 「投票後の取り消し」は許可しない（一度押したら確定）。
- 片方だけ投票済みで相手が未投票の状態は、CaseRoom 上で「相手の投票待ち」バナーを出す。

#### C. 挨拶メッセージの記録方式

- 案 1: `arguments` テーブルに `is_greeting boolean default false` を追加し、開始時 / 終了時に挿入する行で `true` をセット。`round` には 0 もしくは NULL を入れる（要トレードオフ整理）。
- 案 2: `judge_messages` を流用（裁判官メッセージ枠だが「ファクト」記録としても使える）。
- 案 3: 別テーブル `case_greetings(case_id, kind, content, created_at)`。
- アーキはトレードオフを書き、推奨案を明記する。SELECT の取り回しの良さ・既存表示ロジックの差分量・migration 量を判断材料とする。

#### D. 旧データ削除と migration の段取り

- migration ファイルは 1 つに集約する案 / 段階に分ける案がある。
  - 案 A: 1 つの migration に「データ削除 → カラム追加 → ALTER TABLE / 制約追加 → デフォルト値設定」を集約。
  - 案 B: 「データ削除」だけ別 migration、その後の「カラム追加」を別 migration に分離。
- 案 A の方が原子性が高く事故りにくいが、レビュー時の見通しが悪い。アーキ判断とする。
- `phase` 列挙の値追加（`"extension_voting"`）は ENUM 型なら ALTER TYPE が必要。schema.sql 実態を確認し、ENUM か text + check 制約かを把握した上で SQL を書く。

#### E. RLS 影響範囲

- `cases` の新カラム（`end_proposed_by` / `extension_vote_*` or `case_extension_votes`）に対する SELECT/UPDATE ポリシーを、既存 `cases` ポリシーに整合する形で追記する。
- `profiles` の `opening_greeting` / `closing_greeting` は本人のみ UPDATE 可、SELECT は既存の閲覧範囲（自身 + 既存「フレンド／ケース当事者」）に揃える。
- `case_extension_votes` を新設する場合は、ケース当事者のみが INSERT/SELECT 可のポリシーを追加。

---

### 期待する設計成果物

#### 1. `docs/knowledge/design.md` への **追記**（既存内容は保持）

末尾に以下のセクションを **追加** する（既存の章は一切変更しないこと）。

```
## FEAT-006 対応: チャット回数仕様の柔軟化と固定挨拶の導入

### 概要
（目的・背景・旧データ削除統一の方針）

### 影響範囲
- supabase/migrations/20260612NNNNNN_feat006_*.sql（新設、削除 + カラム追加 + RLS 更新）
- supabase/schema.sql（追記方式での反映方針はアーキ判断）
- app/page.tsx（max_rounds 選択 UI 撤廃）
- app/api/cases/route.ts（POST 時に body.maxRounds を無視）
- app/case/[id]/CaseRoom.tsx（「終了を提案」アイコン、延長投票 UI、固定挨拶表示）
- app/api/cases/[id]/*（新エンドポイント: 終了提案 / 延長投票）
- app/profile/page.tsx（挨拶 2 項目の編集 UI）
- app/api/profile/route.ts などプロフィール更新 API（挨拶 2 項目を受け付け）
- lib/types.ts（Case / Profile 型に新フィールド）

### データモデル設計
- cases.end_proposed_by の意味と状態遷移
- 延長投票の保存方式（案 A: cases に 2 カラム / 案 B: 別テーブル）の推奨と根拠
- 挨拶記録の保存方式（案 1/2/3）の推奨と根拠
- 旧データ削除 migration の構成（案 A: 1 本 / 案 B: 2 本）の推奨と根拠

### API 設計
- POST /api/cases/[id]/end-proposal（提案 / 撤回のトグル）
- POST /api/cases/[id]/extension-vote（continue / finish 投票）
- 各エンドポイントの認証・認可・冪等性・エラーレスポンス

### コンポーネント設計
- CaseRoom 内の終了提案アイコン配置、状態表示
- 延長投票モーダルの発火タイミング、表示内容、投票後の挙動
- 固定挨拶のチャット内表示（吹き出し + 「開始の挨拶」「終了の挨拶」ラベル）
- profile ページの挨拶 2 項目編集 UI

### セキュリティ設計
- 新カラムへの RLS 拡張（既存ポリシーとの整合）
- 終了提案 / 延長投票エンドポイントの権限チェック（ケース当事者のみ）
- 挨拶文字数上限と XSS 対策（既存 escapeXml 等の流用）

### 制約・前提条件
- 旧データ削除前提、後方互換ロジックなし
- breakpoint なし、配色は既存 stone/brand トーン
- 弁護人 AI の挙動は不変
- 既存ポーリング機構に乗せる（リアルタイム push なし）
```

#### 2. `docs/knowledge/handoff/arch-to-eng.md` の更新

ビルドへの引き継ぎメモ。以下を含める:

- migration ファイル新設の順序とファイル名規約（時刻昇順）。**最初のステップで `DELETE FROM cases;` (cascade 設定により下流テーブルも削除) を実行することを明示。**
- カラム追加の DDL 例（NOT NULL / DEFAULT / nullable の確定値）。
- RLS ポリシー追加 / 変更の SQL ドラフト。
- `app/page.tsx` から削除する箇所の特定（`maxRounds` state / select / body 送信）。
- 新規 API ハンドラの認証パターン（`createSessionClient` 経由、ケース当事者チェック）。
- CaseRoom の状態管理に追加する `useState` / fetch サイクル。
- フェーズラベル定義の更新箇所（`PHASE_LABELS` 等の grep ヒント）。
- 既存ケースの挙動: 旧データ削除済み前提なので、テスト時は新規ケース作成から流す。
- リグレッション確認シナリオ:
  - 新規ケース作成 → 3 回まで普通に進行 → 延長投票で両者 finish → 判決
  - 新規ケース作成 → 2 回目で片方が終了提案 → 相手が承認 → 判決
  - 新規ケース作成 → 3 回終了後の延長投票で片方が continue → max_rounds += 3 → 6 回目まで進行
  - profile 編集画面で挨拶を変更 → 新ケースで反映、空文字保存は弾かれる
  - 認証 / フレンド / 法律機能に regression が無いこと

---

### 制約・前提

- **`design.md` は永続資料**: 既存セクション（FEAT-001〜FEAT-005、MEDIUM-001、LOW バッチ、FEAT-RESP-HEADER、BUG-002/003）を **絶対に削除しない**。末尾に追記すること。
- 旧データは migration で全削除する前提。後方互換ロジックは書かない。
- 新規 npm 依存を追加しない。
- breakpoint を導入しない。全画面サイズで同じ UI を維持する。
- 配色は既存 `stone-*` / `brand-700` / `brand-800` の範囲で完結させる。`brand-500` は使用しない。
- 弁護人 AI のプロンプト・出力契約は変更しない。
- ヘッダー本体のレイアウトは変更しない。
- マイページ (`/me`) 本体に挨拶設定 UI を追加しない（`/profile` のみ）。

---

### 関連ファイル

- `supabase/schema.sql`（参照: 現行 cases / arguments / verdicts / judge_messages / profiles スキーマ）
- `supabase/migrations/`（新規 migration を配置）
- `app/page.tsx`（max_rounds 選択 UI を撤廃）
- `app/api/cases/route.ts`（POST 時の maxRounds 無視）
- `app/case/[id]/CaseRoom.tsx`（終了提案アイコン、延長投票 UI、固定挨拶表示）
- `app/api/cases/[id]/argument/route.ts`（既存。挨拶記録方式の判断材料）
- `app/api/cases/[id]/verdict/route.ts`（既存。挨拶を verdict 入力に含めるかの判断材料）
- `app/profile/page.tsx`（挨拶 2 項目の編集 UI）
- `app/api/profile/route.ts` 等のプロフィール更新 API（挨拶 2 項目の受け付け）
- `lib/types.ts`（Case / Profile 型に新フィールド追加）
- `lib/case-response.ts`（snake → camel マップに新カラムを追加）
- `middleware.ts`（参照のみ、変更なし）
- `docs/knowledge/design.md`（設計書、**末尾に追記**）
- `docs/backlog.md`（FEAT-006 の起源）
