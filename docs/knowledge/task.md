# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。
>
> **重要 1**: `docs/knowledge/design.md` は永続資料である。既存の設計を絶対に削除・短縮しないこと。本タスクの設計はアーキが `design.md` の末尾に新規セクション（`## BUG-005 閉廷アナウンス条件の修正`）として追記する形で書くこと（[[feedback-design-md]] 参照）。
>
> **重要 2**: 本タスクは標準パイプライン (アーキ → ビルド → テスタ → オーディ) で進める。

## 今回のタスク

「閉廷」AI 生成アナウンスの発火タイミングを、現状の「全ラウンド完了 → `phase=extension_voting` 遷移時」から、「ユーザーが終了を確定した時 (`phase=judging` 遷移時)」へ変更する。

**バックログ ID**: BUG-005
**ブランチ**: `fix/bug-005-closing-announcement-trigger`

---

### 背景

現状、`app/api/cases/[id]/argument/route.ts:132,145-156` で、全ラウンド完了して `phase` が `argument` → `extension_voting` に遷移する瞬間に、`lib/judge.ts` の `trigger === "closing"` プロンプトで AI 生成された「閉廷宣告」メッセージ (`judge_messages.trigger_type = "closing"`) を挿入している。

`lib/judge.ts:49-54` のプロンプトは「閉廷と審議入りを告げてください」「閉廷を宣言してください」とあり、文脈的に「審議入り」(= `phase=judging`) の直前で発火するべきもの。だが現状は `extension_voting` 遷移時に出るため:

- ユーザーがまだ延長 / 終了の選択をしていない
- 「審議入り」(`phase=judging`) にもなっていない
- ユーザーが「延長」を選んで新しい 3 ラウンドが始まる場合でも、既に「閉廷宣言」が出てしまっている

これは演出の整合性問題で、ダイチが手動確認で発見した実バグ（backlog [BUG-005]、由来: 2026-06-13 ダイチ手動確認）。

---

### 修正方針

#### 1. argument/route.ts から closing 生成を削除

`app/api/cases/[id]/argument/route.ts`:

- L132 の warn メッセージから `closing` 関連の文字列を削除し、turn のみを残す
- L146-156 の `nextPhase === "extension_voting" ? "closing" : "turn"` の三項演算子を削除し、turn のみ生成する
- closing 生成はこの API から完全に排除する

#### 2. end-proposal/route.ts に AI 閉廷宣告生成を追加

`app/api/cases/[id]/end-proposal/route.ts:108-148` の `phase=judging` 遷移成功直後、現状の **`insertClosingGreetingsForCase` 呼び出し (L127-148) の直後**に、`closing` trigger の AI `judge_message` を生成・挿入する処理を追加する。

順序: **closing greeting (固定挨拶「ありがとうございました。」、`arguments` テーブルへ 2 行 INSERT) → AI 閉廷宣告 (`judge_messages` テーブルへ 1 行 INSERT)**

エラーハンドリング:

- `generateJudgeMessage` または `judge_messages` INSERT の失敗は `console.error` でログのみ。`phase=judging` 遷移はロールバックしない（user 体験的に判決画面に進めた方が良い）
- 失敗時の DB 状態: closing greeting だけ挿入されて AI 閉廷宣告が欠落するパターンがあり得るが、許容（greeting だけで会話として最低限成立）

#### 3. extension-vote/route.ts に AI 閉廷宣告生成を追加

`app/api/cases/[id]/extension-vote/route.ts:149-176` の finish 経路で `phase=judging` 遷移成功直後、現状の **`insertClosingGreetingsForCase` 呼び出し (L170-173 周辺) の直後**に、`closing` trigger の AI `judge_message` を生成・挿入する。

end-proposal と同じ順序・エラーハンドリング。

#### 4. 共通ヘルパー化（AI 閉廷宣告のみ）

end-proposal と extension-vote で同じ「AI 閉廷宣告生成 → `judge_messages` INSERT」ブロックが発生するので、`lib/case-closing.ts` にヘルパー関数を切り出す。**closing greeting (固定挨拶) は既存の `lib/greetings.ts` の `insertClosingGreetingsForCase` をそのまま利用する**（このヘルパーには greeting を取り込まない）。

CLAUDE.md / AGENTS.md の方針に従い、過度な抽象化は避ける（共通処理が 2 箇所で済むなら関数 1 つで充分）。

ヘルパー関数 `insertClosingJudgeMessage` の責務:

- 引数: `admin client`, `plaintiffApiKey` (復号済み平文), `{ caseId, topic, plaintiffName, defendantName, lastSpeakerRole }`
- 処理:
  1. `generateJudgeMessage({ trigger: "closing", topic, plaintiffName, defendantName, lastSpeakerRole }, plaintiffApiKey)` を呼んで AI テキストを生成
  2. 生成された AI テキストを `judge_messages` に `trigger_type='closing'` で INSERT
- エラーハンドリング: 各 step（AI 生成 / INSERT）を try/catch で個別に保護、ログ出力のみ。例外を上位に伝播させない（呼び出し側は phase 遷移を続行する）
- 戻り値: `void`

#### 5. テーブル境界の整理（重要）

本タスクで扱うメッセージ種別と DB テーブルの対応:

| メッセージ種別 | テーブル | 挿入経路 | カラム |
|---|---|---|---|
| **opening greeting** (固定挨拶「よろしくお願いします」) | `arguments` | 既存 `insertOpeningGreetingsForCase` (`lib/greetings.ts:64`) | `role`, `phase='opening'`, `round=0`, `is_greeting=true` |
| **closing greeting** (固定挨拶「ありがとうございました。」) | `arguments` | 既存 `insertClosingGreetingsForCase` (`lib/greetings.ts:83`) | `role`, `phase='closing'`, `round=0`, `is_greeting=true` |
| **turn judge メッセージ** (AI 生成、ラウンド進行) | `judge_messages` | 既存 `argument/route.ts` | `trigger_type='turn'` |
| **opening judge メッセージ** (AI 生成「開廷」) | `judge_messages` | 既存 `cases/[id]/route.ts` (PATCH で参加成功時) | `trigger_type='opening'` |
| **AI 閉廷宣告** (AI 生成「閉廷と審議入りを告げる」) | `judge_messages` | **本タスクで再配置**: 現状 `argument/route.ts` → 修正後 end-proposal / extension-vote | `trigger_type='closing'` |

**重要**: closing greeting と AI 閉廷宣告は **異なるテーブル** (`arguments` と `judge_messages`)。新規ヘルパー `insertClosingJudgeMessage` は `judge_messages` テーブルにのみ関与する。

#### 6. 既存 judge_messages の trigger_type は変更しない

`judge_messages` テーブルに既に保存されている過去の `closing` レコードは触らない（migration 不要）。新規生成のみ振る舞いが変わる。

---

### スコープ外

- `lib/judge.ts:49-54` の closing プロンプト本体の変更（既存プロンプトをそのまま使う）
- closing greeting の固定文字列変更（FEAT-006 で確定済み）
- 過去ケース（既存 verdict）の `judge_messages` 修正
- `extension_voting` フェーズ中の UI 変更
- 「閉廷しました」というシステム表示ラベル（もし CaseRoom 内に存在するなら）の修正 — 調査でこの種のラベルが UI 側にも存在することが判明したら BUG-005 の関連タスクとして追記する

---

### テスト観点（テスタが書く E2E spec の方向性）

`TEST_MODE=1` 経由でテスト Supabase（`eckrccrfnblzdbflnssf`）に対して動作する。E2E ユーザー A/B（`e2e_user_a@example.com` / `e2e_user_b@example.com`、パスワード `E2eTest123!`）はテスト DB に存在。

#### 必須

1. **3 ラウンド完了 → 延長投票 continue 選択 → 新しい 3 ラウンドが始まる**: 最初の 3 ラウンド完了タイミングで `judge_messages` に `trigger_type='closing'` のレコードが **挿入されていない** ことを assert
2. **3 ラウンド完了 → 延長投票で両者 finish → `phase=judging`**: closing greeting が `arguments` テーブルに 2 行 (`role=plaintiff/defendant`, `phase='closing'`, `is_greeting=true`) で挿入され、AI 閉廷宣告が `judge_messages` テーブルに 1 行 (`trigger_type='closing'`) で挿入されていることを assert。`arguments.created_at` (closing greeting) が `judge_messages.created_at` (AI 閉廷宣告) よりも前であることも併せて確認
3. **早期終了 (end-proposal) 両者合意で `phase=judging`**: 2 と同様に、`arguments` (closing greeting 2 行) → `judge_messages` (AI 閉廷宣告 1 行) の順で挿入されていることを assert

#### 推奨

4. closing AI 生成が失敗した場合（API キー欠落をシミュレート）、`phase=judging` 遷移自体は成功すること（closing greeting は挿入されるが AI 生成は欠落、ヘルパー内で catch される）
5. `extension_voting` フェーズ中、polling で `judge_messages` を取得しても新たな `trigger_type='closing'` レコードが増えないこと

#### 既存テストへの影響確認

- BUG-007 / BUG-004 関連 spec はこの変更で影響を受けないはず。確認のため `tests/e2e/` 全体をフルパス実行
- FEAT-006 (チャット回数仕様変更) 関連 spec があれば、特に closing greeting 挿入経路に影響しないことを確認

---

### オーディに対する観点

- `argument/route.ts` の修正で turn 生成パスが正しく残っているか（巻き添えで turn まで壊れていないか）
- 新規ヘルパー `lib/case-closing.ts` のエラーハンドリングが既存パターン（try/catch でログのみ、phase 遷移は続行）と整合しているか
- 呼び出し順序: `insertClosingGreetingsForCase` (arguments テーブル) → `insertClosingJudgeMessage` (judge_messages テーブル) が両経路（end-proposal / extension-vote）で保証されているか
- 新規ヘルパーが `arguments` テーブルや greeting 文字列を一切触らないこと（テーブル境界の侵食防止）
- `extension_voting` フェーズ中に `judge_messages.trigger_type='closing'` レコードが新たに増えない（負例テスト）
- `judge_messages.trigger_type='closing'` の INSERT 箇所が `phase=judging` 遷移後のコードパスにのみ存在することを grep で確認: `grep -rn "trigger_type.*closing" app/ lib/`
- **git status 最終確認**: 新規 spec / ヘルパー / audit-log / test-log が untracked のまま残っていないこと（[[feedback-commit-check]]）

---

### 関連ファイル

- `app/api/cases/[id]/argument/route.ts` (L132, L145-156 を修正、closing 生成を削除)
- `app/api/cases/[id]/end-proposal/route.ts` (L127-148 の `insertClosingGreetingsForCase` 呼び出し直後に AI 閉廷宣告呼び出しを追加)
- `app/api/cases/[id]/extension-vote/route.ts` (finish 経路の `insertClosingGreetingsForCase` 呼び出し直後に AI 閉廷宣告呼び出しを追加)
- `lib/judge.ts` (closing プロンプトはそのまま使用、変更なし)
- `lib/greetings.ts` (`insertClosingGreetingsForCase` は変更なし、そのまま利用)
- 新規: `lib/case-closing.ts`（共通ヘルパー `insertClosingJudgeMessage`、AI 閉廷宣告の `judge_messages` 挿入のみ担う）
- 新規: `tests/e2e/bug005-closing-trigger.spec.ts`（テスタが書く E2E spec）

---

### 確定事項（ダイチ合意済み）

- closing greeting と AI 生成 closing の順序: **greeting → AI**（2026-06-15 ダイチ確認）
- `argument/route.ts` からの closing 生成削除: 確定
- AI 生成失敗時の振る舞い: phase 遷移は続行（ログのみ）: 確定
- **テーブル境界**: closing greeting は `arguments` テーブル (既存 `insertClosingGreetingsForCase` を流用)、AI 閉廷宣告は `judge_messages` テーブル (新規ヘルパー `insertClosingJudgeMessage` のみで管轄)。両者を 1 関数に集約しない（2026-06-15 既存実装 `lib/greetings.ts:83-98` の確認結果に基づくリードの判断）
