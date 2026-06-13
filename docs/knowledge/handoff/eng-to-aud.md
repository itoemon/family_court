# ビルド → テスタ・オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: FEAT-006 — チャット回数仕様の柔軟化（3回 + 早期終了 + 3回延長）と固定挨拶導入
**日時**: 2026-06-12
**ブランチ**: feature/20260612-163856

由来: `docs/knowledge/task.md` FEAT-006、`docs/knowledge/design.md ## FEAT-006 対応`、`docs/knowledge/handoff/arch-to-eng.md`

---

## 変更ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `supabase/migrations/20260612164035_feat006_chat_rounds_and_greetings.sql` | 新規 | (1) 旧ケース全削除 (2) `cases` に `end_proposed_by` / `extension_vote_*` 追加 (3) `profiles` に `opening_greeting` / `closing_greeting` 追加 (4) `arguments.is_greeting` 追加 (5) `cases.phase` の check に `'extension_voting'` 追加 |
| `supabase/schema.sql` | 変更 | 上記 migration を反映（profiles / cases / arguments の DDL 更新、phase check 値追加） |
| `lib/types.ts` | 変更 | `Phase` に `"extension_voting"` 追加、`EndProposalActor` / `ExtensionVote` 型追加、`Argument.isGreeting`、`Case.endProposedBy` / `extensionVotePlaintiff` / `extensionVoteDefendant` 追加、`Profile` に挨拶 2 項目追加、`CreateCaseRequest.maxRounds` 削除 |
| `lib/greetings.ts` | 新規 | `DEFAULT_OPENING_GREETING` / `DEFAULT_CLOSING_GREETING` / `resolveOpeningGreeting` / `resolveClosingGreeting` / `validateGreeting` / `MAX_GREETING_LENGTH` |
| `lib/case-response.ts` | 変更 | snake→camel マップに `endProposedBy` / `extensionVotePlaintiff` / `extensionVoteDefendant` / `isGreeting` を追加 |
| `app/page.tsx` | 変更 | `maxRounds` state / `<select>` ブロック / POST body の `maxRounds` キーを削除 |
| `app/api/cases/route.ts` | 変更 | POST から `body.maxRounds` の参照を完全撤去（DB default の 3 に委ねる） |
| `app/api/profile/route.ts` | 変更 | PATCH に `openingGreeting` / `closingGreeting` 受領追加。`validateGreeting` でバリデーション。レスポンスに新項目を含める |
| `app/profile/page.tsx` | 変更 | 「開始時の挨拶」「終了時の挨拶」入力 2 項目 + 各「デフォルトに戻す」リンク + 保存ボタンを追加 |
| `app/api/cases/[id]/route.ts` | 変更 | 被告参加（認証 / ゲスト両方）時の `phase: opening` 遷移直後に `insertOpeningGreetings` で両者の開始挨拶を `arguments` に `is_greeting=true, round=0` で INSERT |
| `app/api/cases/[id]/argument/route.ts` | 変更 | (1) 発言禁止フェーズに `extension_voting` 追加 (2) `closing → judging` を `closing → extension_voting` に変更 (3) judge_message の `"closing"` trigger 発火条件を `nextPhase === "extension_voting"` に修正 |
| `app/api/cases/[id]/end-proposal/route.ts` | 新規 | POST。actor 識別（plaintiff / defendant / guest）後にトグル分岐: NULL→提案 / 自分→撤回 / 相手→同意（終了挨拶 INSERT + `phase=judging`）。`argument` 以外のフェーズは 409 |
| `app/api/cases/[id]/extension-vote/route.ts` | 新規 | POST `{ vote: "continue" | "finish" }`。自分側カラムへ楽観的更新（既投票は 409）。両者揃った場合: いずれか continue → `max_rounds += 3, phase=argument, round=旧max+1, current_turn=plaintiff` / 両者 finish → 終了挨拶 INSERT 後 `phase=judging`。両分岐とも `extension_vote_*` と `end_proposed_by` を NULL に戻す |
| `app/api/cases/[id]/verdict/route.ts` | 変更 | `caseForClaude: Case` 構築時に新フィールド (`endProposedBy` / `extensionVote*` / `isGreeting`) を追加 |
| `app/case/[id]/CaseRoom.tsx` | 変更 | (1) `PHASE_LABELS` に `extension_voting: "もう少し話し合うか確認中"` (2) `canSpeak` 判定に `extension_voting` を追加 (3) 相手側「終了提案中」バナー + CTA「同意して終了」 (4) 自分側「提案中」状態テキスト (5) 入力欄ヘッダー / 返答待ち表示に `EndProposalButton`（SVG インライン、`stone-*` 配色、`argument` フェーズのみ表示）(6) `extension_voting` 中の `ExtensionVotingModal`（× ボタンなし、投票後は「相手の投票を待っています」表示） (7) 吹き出しで `isGreeting === true` のラベルを「開始の挨拶」/「終了の挨拶」に切り替え |
| `app/case/[id]/verdict/page.tsx` | 変更 | やりとり一覧で `isGreeting === true` のラベル表示を「開始の挨拶」/「終了の挨拶」に |

---

## 設計書から逸脱した箇所と理由

### 1. アーキ判断に従ったため逸脱なし

設計書（design.md FEAT-006 セクション）と arch-to-eng.md に記述された判断にすべて準拠して実装した。`uuid` ではなく `text + check` での `end_proposed_by`、案 A の `cases` 2 カラム延長投票、案 1 の `arguments.is_greeting`、案 A の 1 migration 集約、いずれも採用済み。

### 2. 一部 UI 細部の判断

- **「終了を提案」アイコンの配置**: 設計書では「自分側入力欄ヘッダーまたは送信ボタン左隣」とあり、自分のターンでない場合（返答待ち表示）にも同じアイコンを表示するようにした。常設の要件を厳密に解釈し、両分岐に同じコンポーネント `EndProposalButton` を配置。
- **アイコン SVG 図柄**: 「下向き矢印付きドア（exit）」案 → 「矩形 + 右矢印」を実装（出口のシンボル）。アクセシブル名は提案中 / 未提案で文言を切替。
- **延長投票モーダルのコピー**: 設計書文言に準拠しつつ、`?` を含むタイトル、説明、ボタン文言を全角に揃えた。
- **「自分が提案中」UI**: 設計書では「アイコン背景 `bg-stone-200`、aria-pressed」+ 「`「あなたが終了を提案中」` のテキスト」。実装ではアイコンとは別に上部に小さなテキストバナーを置き、撤回手順を案内する文を入れた（提案者が撤回手順を見落とさないため）。

### 3. closing フェーズの挙動

- 既存の `closing → judging` 遷移を `closing → extension_voting` に置き換えた。`argument` フェーズの最終ラウンドが終わったあと、原告→被告の closing 1 ターンを取り、closing 終了時点で `extension_voting` に遷移する（設計書「closing フェーズは廃止せず維持」に準拠）。
- judge_message の `"closing"` trigger の発火タイミングも `nextPhase === "extension_voting"` に修正した（旧 `nextPhase === "judging"` の置換）。

### 4. extension_voting 突入時の `end_proposed_by` リセット

- closing → extension_voting への自動遷移時には、`end_proposed_by` のリセットは行っていない（カラムが NULL のままで遷移する想定）。
- extension_vote の集計確定時には、continue / finish のどちらに転んでも `end_proposed_by = NULL`、`extension_vote_* = NULL` をまとめてリセットしている（design.md 注意事項にある「extension_voting 突入時に end_proposed_by を NULL にリセット」の意図を、両側のフェーズ離脱時に実装した）。

### 5. 開始挨拶 INSERT のタイミング

- 被告参加（認証 / ゲスト両方）で `phase: "opening"` に遷移した直後、judge_message 生成より前に両者の挨拶 row を 2 行 INSERT。
- ゲスト被告には `profiles` 行が存在しないため、サーバ既定文（`DEFAULT_OPENING_GREETING`）を使用。

---

## テスタ・オーディへの注意点

### マイグレーション適用順

1. 本 PR の `supabase/migrations/20260612164035_feat006_chat_rounds_and_greetings.sql` を Supabase に適用すること。**最初の `delete from public.cases;` で既存ケースが全削除される**（cascade で arguments / verdicts / judge_messages も削除）。テスト DB に保持したい旧ケースがあれば事前に退避を。
2. `profiles` / `friend_requests` / `laws` / `law_*` は保持される。
3. schema.sql は本番 snapshot として整合済み。新規環境セットアップは schema.sql 1 本で完結する。

### リグレッション確認シナリオ（arch-to-eng.md より転記 + 補足）

1. **新規ケース → 3 回まで argument → 最終 closing → 延長投票で両者 finish → 判決**
   - argument のラウンド表示は 1〜3。挨拶 row は round=0 で表示されラウンドカウントに乗らない。
   - extension_voting 中、両者にモーダルが出る。投票後は「相手の投票を待っています」に。
   - 両者 finish 確定で終了挨拶 2 行が timeline に表示され、`phase=judging` に遷移、verdict 画面へ。
2. **argument 中に原告が「終了を提案」 → 被告に「同意して終了」バナーが表示 → 同意で判決へ**
   - 終了挨拶 2 行が INSERT される。
3. **終了提案を出して撤回**
   - 同じアイコンを押すと `end_proposed_by` が NULL に戻り、相手側のバナーが polling 後に消える。
4. **延長投票で原告 continue / 被告 finish → max_rounds が 6 に → 6 回目まで進行**
   - argument の current_turn は plaintiff にリセットされ、round が `旧max_rounds + 1` から再開（例: 3→4）。
   - 6 回目終了後 → closing 1 ターン → 再度 extension_voting → 延長または終了選択可。
5. **profile 編集**
   - 「開始時の挨拶」「終了時の挨拶」テキスト入力で保存 → 新ケースで反映。
   - 空欄保存は 400（API）+ UI 側でも事前に弾く。
   - 「デフォルトに戻す」リンクで該当カラムが NULL に戻り、次のケースで `DEFAULT_OPENING_GREETING` / `DEFAULT_CLOSING_GREETING` が使われる。
6. **ゲスト被告**
   - 終了提案アイコンが表示・押下可能（`end_proposed_by = 'guest'` で保存）。
   - 延長投票モーダルも表示・投票可能（`extension_vote_defendant` 側に書き込み）。
   - 挨拶はサーバ既定文。

### 影響範囲外（regression が出ないことを確認）

- 認証 / フレンド / 法律機能 / プロフィールの他項目編集 / アバター変更 / API キー登録
- マイページ (`/me`) の表示 / 過去のケースダイジェスト
- 弁護人 AI（プロンプト・出力契約は不変。`arguments` を読む defense / draft / verdict 側に挨拶 row が混入することは許容範囲との設計判断）
- 矛盾警告（既存ロジック不変）

### 注意ポイント

- **挨拶 row の round=0**: 既存の SELECT クエリは `arguments` を `created_at` 順で取得しているだけで `round > 0` 前提のロジックは見当たらなかった。判決生成（verdict）/ 弁護人 AI（defense, draft）も全件読みなので挨拶が混じる。設計書方針どおり初版では除外しない。AI 品質劣化を観察したら次タスクで除外検討。
- **タイムライン上の挨拶吹き出し**: 通常の発言と同じ吹き出しコンポーネントを使い、上部の小ラベルだけ「開始の挨拶」「終了の挨拶」に切り替えている。
- **end-proposal API は ボディなし**: トグル意味論なのでクライアントは `POST {}` を送るだけ。サーバが現在状態を見て分岐。
- **extension-vote の二重投票**: 楽観的更新（`is(column, null)`）で安全側に倒している。すでに投票済みの場合は事前に 409 を返す。
- **配色**: 終了提案 = `stone-*` 系（控えめ）、相手側バナーの CTA / 延長「続ける」CTA = `brand-700/800`、延長「終わる」CTA = `stone-200/300`。`brand-500` は不使用。

---

## 未実装・スコープ外にしたこと

### スコープ外（task.md / design.md 明示）

- 終了提案 / 延長投票のリアルタイム push（既存の 2 秒ポーリングに乗せる）
- 判決画面 UI 改修
- 挨拶設定の i18n
- 既存ケースのデータ補正・移行（削除のみで対応）
- マイページ (`/me`) への挨拶 UI 追加
- ケース作成画面の他項目変更
- 弁護人 AI のプロンプト・出力契約変更
- 延長回数の上限
- 配色トーンの追加
- breakpoint 導入
- 「終了を提案」のリッチアニメーション / トースト通知
- 延長投票モーダルの閉じる × ボタン
- `case_extension_votes` 別テーブル（案 A 採用）
- 挨拶記録の `judge_messages` 流用 / 別テーブル（案 1 採用）
- AI 履歴からの挨拶除外（初版では除外しない方針）

### 実装上の未対応事項

- **マイページ `/me` の表示**: 旧ケース削除に伴い、`/me` の「過去のケース」セクションは空になる想定。`/history` も同様。これらは設計書「regression なし」確認の対象だが、表示自体は崩れない（0 件の handling は既存）。テスタは念のため確認。
- **過去の `/case/[id]` URL**: 旧ケースは全削除のため 404 を返す。リンクを共有していたユーザーは新ケース作成からやり直し。
- **テスト用既存 e2e**: `e2e/` 配下に `max_rounds` の 2/5 を前提とした spec が残っている場合、本 PR で挙動が変わる（API は無視する）。本タスクのスコープでは spec の修正は行っていない。テスタが必要に応じて追加 PR で更新を。

### 開いた論点（次タスクで判断）

- 弁護人 AI / 判決 AI 入力からの挨拶除外
- 延長投票の票履歴保存（必要なら `case_extension_votes` テーブル新設）
- 挨拶長さ上限の調整（現状 125 文字）
- closing フェーズの存続自体（要件再定義時に再検討）
