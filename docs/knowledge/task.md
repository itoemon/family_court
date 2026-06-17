# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。
>
> **重要 1**: `docs/knowledge/design.md` は永続資料である。既存の設計を絶対に削除・短縮しないこと（[[feedback-design-md]] 参照）。本タスクは UI 通知の局所追加で、設計書への追記対象は無い。design.md の修正は **しない**。
>
> **重要 2**: 本タスクは **リードが先行実装を済ませた状態でテスタ・オーディに渡している**。アーキ・ビルドは省略する（PR #47 / PR #50 と同じパターン）。テスタはリグレッション確認が主目的、オーディはリード実装の差分監査が主目的。

## 今回のタスク

相手が「終了を提案」したことを能動的に通知する。現状の `isOpponentEndProposal` バナーは静的で、画面が active でも見落とされやすい。

**バックログ ID**: BUG-006
**ブランチ**: `feature/20260617-091907-bug-006`（既に切ってある）

---

### 背景

現状、相手が「終了を提案」したことは polling 経由でバナー（`isOpponentEndProposal` 分岐、`CaseRoom.tsx:499-514`）が表示されるが、配色が `bg-stone-100` + `border-stone-300` と他のシステム表示と同等で、視覚的な強調がない。相手画面が active でも見落とされる可能性があり、active でない場合は気づきようがない。

backlog [BUG-006]、由来: 2026-06-13 ダイチ手動確認。

---

### 修正方針（実装済み）

#### 通知方式の選定（2026-06-17 ダイチ確認）

「バナー強調 + 音」のシンプル組み合わせを採用。ブラウザ通知 API（Notification.requestPermission）は許可フロー設計が必要なため別タスクへ。タブタイトル点滅（document.title 書き換え）も別タスク。

#### 1. バナー強調（視覚通知）

`CaseRoom.tsx:499-516` の `isOpponentEndProposal` バナーを次のとおり強調する:

- 配色を amber 系へ変更（`bg-amber-50` + `border-amber-300` + `text-amber-900`）。プロジェクト内で「警告 / 注意」トーンとして既に確立（`ContradictionWarningBubble.tsx`, `app/page.tsx`, `app/me/_components/LawsCard.tsx`）
- `animate-pulse` を最外殻 `<div>` に追加して脈動アニメーション。ユーザーが「同意して終了」を押すか、相手が撤回するまで継続
- テキストに `font-semibold` を追加して文字も強調
- アクセシビリティ: `role="alert"` + `aria-live="polite"` を追加（スクリーンリーダー向け）

#### 2. ビープ音（聴覚通知）

`CaseRoom.tsx` に新規 `useEffect` を追加し、polling で `caseData` が更新された結果として `isOpponentEndProposal` が **false → true 遷移** した瞬間を `useRef` で検知して、Web Audio API でビープ音を再生する:

- 周波数 880Hz / sine wave / 0.15 秒 / gain 0.08（控えめな音量）
- `window.AudioContext` または `webkitAudioContext` で構築、未対応ブラウザは静かにスキップ
- `try/catch` で autoplay policy 等の失敗を握り、`phase=judging` 遷移はロールバックしない（バナー強調が補助）
- 音源ファイルは追加しない（Web Audio API で生成、依存ゼロ）

#### 3. スコープ外（明示）

- 自分側終了提案バナー（`isMyEndProposal`、`CaseRoom.tsx:518-524`）は触らない（自分のアクション結果なので強調不要）
- ブラウザ通知 API（Notification.requestPermission）の許可フロー実装
- タブタイトル点滅（document.title 書き換え）
- 音量設定 / ミュート UI（将来の課題）
- 終了提案 *以外* の通知（延長投票確定、判決完了など）

---

### テスト観点（テスタが行うリグレッション確認の方向性）

`TEST_MODE=1` 経由でテスト Supabase（`eckrccrfnblzdbflnssf`）に対して動作する。E2E ユーザー A/B はテスト DB に存在。

#### 必須（リグレッション確認）

1. **CRITICAL M01〜M04 をフル実行**: 既存の認証・会話フロー・セッション復元・第三者割り込み拒否が全て通過すること
2. **BUG-007 / BUG-004 / BUG-005 spec の実行**: 既存挙動への影響がないこと

#### 推奨

3. `npm run build` が新規 `useEffect` に関する警告を出さないこと（実装時に既に確認済み）

#### 新規 spec の方針

本タスクでは新規 E2E spec を **追加しない**。理由:

- バナー配色変更と `animate-pulse` は Playwright で「アニメーションが動いている」を検証するのが難しい（ロバスト性に欠ける）
- Web Audio API の音再生は E2E では音声出力の有無を確認できない（ブラウザ環境依存）
- どちらも UI 装飾と補助通知の範疇で、機能要件としては `isOpponentEndProposal` バナーが表示されること自体が主体（既存挙動）

代わりに、本変更がリグレッションを起こさないことを既存 CRITICAL + BUG spec のフル実行で担保する。

---

### オーディに対する観点

- `CaseRoom.tsx` のバナー条件レンダリング (`isOpponentEndProposal && ...`) のロジック自体が変更されていないこと
- `useEffect` の依存配列が `[caseData?.endProposedBy, myRole]` で適切なこと（過度な依存を入れていない）
- `useRef` の前回値追跡が `false → true` 遷移のみで再生をトリガすること（`true → true` や逆遷移で再生しないこと）
- `try/catch` で AudioContext 失敗を握っており、phase 遷移や他処理に影響を与えないこと
- 配色変更が `ContradictionWarningBubble.tsx` などのプロジェクト既存パターンに整合していること
- 自分側 `isMyEndProposal` バナーは触られていないこと
- **git status 最終確認**: 新規ファイルなし、変更は `CaseRoom.tsx` と `task.md` のみであること（[[feedback-commit-check]]）

---

### 関連ファイル

- `app/case/[id]/CaseRoom.tsx`（音再生 `useEffect` 追加 + バナー強調）
- `docs/knowledge/task.md`（本ファイル）
- 既存テストファイル（変更なし、リグレッション確認のため）

---

### 確定事項

- 通知方式: **バナー強調 + ビープ音** のシンプル組み合わせ（2026-06-17 ダイチ確認）
- ブラウザ通知 API / タブタイトル点滅は別 PR
- 音源ファイル追加せず Web Audio API で生成
- リード先行実装で進める（PR #47 / PR #50 と同じパターン）
- 新規 E2E spec は追加しない（既存 CRITICAL + BUG spec でリグレッション確認が十分）
- design.md への追記はしない
