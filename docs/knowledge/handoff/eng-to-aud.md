# ビルド → テスタ・オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: BUG-005 — 閉廷アナウンス条件の修正（AI 閉廷宣告の発火位置を `phase=judging` 遷移時へ移動）
**日時**: 2026-06-15
**ブランチ**: feature/20260615-163410（task.md 推奨は `fix/bug-005-closing-announcement-trigger` だが、アーキの設計・引き継ぎコミットが既に本ブランチに乗っていたためそのまま流用）

由来: backlog [BUG-005]、ダイチ手動確認（2026-06-13）。`docs/knowledge/design.md` 末尾 `## BUG-005 閉廷アナウンス条件の修正` を参照。

---

## 変更ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `lib/case-closing.ts` | 新規 | `insertClosingJudgeMessage` ヘルパー（AI 閉廷宣告生成 → `judge_messages` INSERT のみ） |
| `app/api/cases/[id]/argument/route.ts` | 変更 | `argument` 以外への遷移時は `judge_messages` INSERT を一切しない。closing 生成パスを削除 |
| `app/api/cases/[id]/end-proposal/route.ts` | 変更 | 両者合意で `phase=judging` 遷移成功 + closing greeting INSERT 成功直後に AI 閉廷宣告を生成・INSERT |
| `app/api/cases/[id]/extension-vote/route.ts` | 変更 | 両者 finish で `phase=judging` 遷移成功 + closing greeting INSERT 成功直後に AI 閉廷宣告を生成・INSERT |

DB スキーマ変更なし。新規 migration なし（design.md の方針通り）。

---

## 設計判断と注意事項

### 1. AI 閉廷宣告ヘルパー (`lib/case-closing.ts`) の責務

- `judge_messages` テーブルへの INSERT のみ。
- `arguments` テーブル / `DEFAULT_CLOSING_GREETING` / `cases` UPDATE / 認可判定には触れない（テーブル境界保護。task.md 「テーブル境界の整理」確定事項）。
- AI 生成失敗 / INSERT 失敗とも `console.error` でログのみ。例外を上位に伝播させない。
- `plaintiffApiKey` が `null` の場合は `console.warn` で `[judge] closing: plaintiff has no api_key_encrypted (case=<id>)` を出して return。

### 2. `lastSpeakerRole` の解決

- 呼び出し側 (`end-proposal` / `extension-vote`) で `arguments` から `is_greeting=false` の最新 row を SELECT して `role` を取得。
- クエリ失敗 / 0 件は `"plaintiff"` を fallback。
- 解決責務はヘルパーに持たせず、呼び出し側に置く（ヘルパーが `arguments` を触らない方針のため）。

### 3. `argument/route.ts` の closing 削除方針

- 旧設計の三項演算子 `nextPhase === "extension_voting" ? "closing" : "turn"` を完全に削除。
- `nextPhase === "argument"` の場合のみ turn judge message を生成。`extension_voting` 遷移時は turn も含めて `judge_messages` INSERT を一切行わない（アーキ引き継ぎ「実装の順序」#2、推奨方針に従った）。
- これにより `argument/route.ts` 経由で `trigger_type='closing'` が INSERT されることはなくなった。

### 4. `caseRow` 参照のインライン化（共通化見送り）

- `end-proposal` と `extension-vote` の 2 経路で同等の処理（profile 取得・defendant 名解決・lastSpeakerRole 取得・ヘルパー呼び出し）が並ぶが、関数化していない。
- 理由: アーキ引き継ぎメモで「2 経路のみ・`caseRow` の参照タイミングが異なる・CLAUDE.md の過度抽象化禁止」が明示されている。
- 共通化されている部分は `lib/case-closing.ts` の `insertClosingJudgeMessage` のみ（テーブル境界保護目的の最小単位）。

### 5. 設計書からの逸脱なし

- design.md / arch-to-eng.md の指示にすべて準拠。逸脱した箇所はない。

---

## テスタへの注意点

### 必須シナリオ（task.md 「テスト観点」より）

1. **3 ラウンド完了 → 延長投票 continue → 新ラウンド**
   - `judge_messages` で `trigger_type='closing'` の COUNT が 0 件であることを assert。
2. **3 ラウンド完了 → 延長投票で両者 finish → `phase=judging`**
   - `arguments` に closing greeting 2 行（`phase='closing'`, `is_greeting=true`）
   - `judge_messages` に `trigger_type='closing'` 1 行
   - `arguments.created_at` (closing greeting) < `judge_messages.created_at` (AI 閉廷宣告) の順序を確認。
3. **早期 end-proposal 両者合意 → `phase=judging`**
   - 上記 #2 と同じ条件で assert。
4. **AI 生成失敗時のフォールバック（推奨）**
   - `profiles.api_key_encrypted` を NULL の状態にして上記 #2 / #3 を再現。
   - `phase=judging` 遷移は成功、closing greeting は挿入される。
   - `judge_messages.trigger_type='closing'` は欠落（0 件）。
   - サーバログに `[judge] closing: plaintiff has no api_key_encrypted (case=<id>)` が出る。
5. **`extension_voting` 中の polling**
   - 3 ラウンド完了 → 延長投票画面で待機 → polling で `judge_messages` を取得し続けても新規 `trigger_type='closing'` レコードが増えない。

### 既存 spec への影響確認

- `tests/e2e/` 配下を全件実行。BUG-007 / BUG-004 / FEAT-006 関連 spec が赤化しないこと。
- 特に turn 生成パス (`argument/route.ts`) は 3 ラウンド以内では従来通り `trigger_type='turn'` が挿入される（巻き添えで turn が出なくなっていないか確認）。

### テスト DB

- `TEST_MODE=1` 経由でテスト Supabase（`eckrccrfnblzdbflnssf`）に対して動作する。
- E2E ユーザー A/B（`e2e_user_a@example.com` / `e2e_user_b@example.com`、パスワード `E2eTest123!`）はテスト DB に存在。

---

## オーディへの注意点

### grep 確認

```bash
grep -rn "trigger_type.*closing" app/ lib/
```

期待結果: `lib/case-closing.ts` の 1 箇所のみ（`judge_messages` INSERT 行）。`app/` 配下に `trigger_type='closing'` の INSERT が残っていれば設計違反。

### コードレビュー観点

- `argument/route.ts` の turn 生成パスが破壊されていない（`nextPhase === "argument"` 内で従来通り動作）。
- `lib/case-closing.ts` 内に `arguments` テーブル / `DEFAULT_CLOSING_GREETING` への参照がない（テーブル境界保護）。
- 呼び出し順序: 両経路（end-proposal / extension-vote）で `insertClosingGreetingsForCase` → `insertClosingJudgeMessage` の順が保たれている。
- ヘルパーのエラーハンドリングが既存パターン（try/catch でログのみ、phase 遷移は続行）と整合している。
- 並行リクエストでの重複 INSERT 抑止: `end-proposal` / `extension-vote` 双方で `phase=judging` への楽観ロック (`WHERE phase=argument` / `WHERE phase=extension_voting AND 両者票一致`) が既存実装で効いており、AI 閉廷宣告 INSERT 経路もその後でしか走らないため自然に 1 回に絞られる。

### セキュリティ観点

- 平文 API キー (`plaintiffApiKey`) はヘルパー引数として一度渡すのみ、関数内で保持しない（既存 `lib/judge.ts:generateJudgeMessage` と同一パターン）。
- `console.error` ログにはユーザー入力 / API キー / PII を載せていない（プレフィックス `[judge] closing:` と例外オブジェクトのみ）。
- ヘルパーは認可判定を行わない（既に認可済みコードパスからのみ呼ばれる前提）。

---

## 未実装・スコープ外にしたこと

- `lib/judge.ts:49-55` の closing プロンプト本体（変更なし、既存プロンプトをそのまま流用）。
- `lib/greetings.ts:insertClosingGreetingsForCase` のシグネチャ・挙動（変更なし）。
- 過去の `judge_messages.trigger_type='closing'` レコード（旧経路で挿入されたもの）。マイグレーションでの遡及修正は実施しない（task.md L88-90 / design.md L2470 に従う）。
- `extension_voting` フェーズ中の UI（バナー・モーダル・サイドアイコン）変更。
- CaseRoom 内の「閉廷しました」システム表示ラベルの調査・修正（task.md L100 でスコープ外明示）。本 PR 着手中に CaseRoom 側で該当ラベルは確認していない。発見時は backlog 派生タスクへ。
- E2E spec の追加（テスタ担当）。本 PR では `tests/e2e/bug005-closing-trigger.spec.ts` を新規作成していない。
- 動作確認（ローカル）: `npm run dev` ベースの実機確認は実施せず、型・lint のみで判断。テスタが E2E spec で実環境動作を担保する前提。

---

## 残課題・引き継ぎ事項

1. **テスタ**: `tests/e2e/bug005-closing-trigger.spec.ts` を新規作成し、上記「必須シナリオ」#1〜#5 を全て assert する。`arguments.created_at < judge_messages.created_at` の順序確認は polling ベースで（AI 生成完了を待つ）。
2. **オーディ**: 上記「grep 確認」を実行し、`trigger_type='closing'` の INSERT 箇所が `lib/case-closing.ts` の 1 箇所のみであることを確認する。
3. **未確定論点**（design.md L2564-2566 より、本 PR では未対応）:
   - `lastSpeakerRole` 解決のために `arguments` SELECT を 1 ラウンドトリップ追加した。`phase=judging` 遷移経路は頻度が低いため許容と判断したが、polling 中の負荷で問題が出たら後追いで `cases.current_turn` 反転値による fallback 最適化を検討。
   - `api_key_encrypted` NULL ケースで AI 閉廷宣告がスキップされる際の挙動: closing greeting だけ挿入される。verdict 生成自体も同じ API キーを使うため、未登録状態では verdict 画面側で別途エラー処理が走る既存挙動に乗る（本タスクで verdict 側は変えない）。

---

## 確認済み

- 型エラー: `npx tsc --noEmit` で 0 件。
- lint エラー: `npx eslint` で 0 件（変更 4 ファイル）。
- grep 確認: `trigger_type.*closing` が `app/` 配下から消え、`lib/case-closing.ts` の 1 箇所のみに収束。
