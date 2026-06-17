# テスタ → オーディ 引き継ぎメモ（BUG-006）

**実行日**: 2026-06-17  
**実行時刻**: 09:22:17 (dev サーバー起動確認 → Playwright テスト実行)  
**対象**: BUG-006 — 相手の終了提案をバナー強調＋ビープ音で通知  
**テスト判定**: ✅ **通過**（CRITICAL 4/4 + BUG-004 2/2 + BUG-005 3/3 + BUG-007 9/9 = 合計 **19/19** 通過）

> **注記**: テスタ初回実行 (`test_20260617_092217.md` 本体) では BUG-007 spec (`auth-login.spec.ts` 4 件 + `middleware-next.spec.ts` 5 件) が task.md L88-89 の明示指示にもかかわらず実行から落ちていた。リードが補完として `npx playwright test` を直接実行し、9/9 通過を確認 (15.5 秒)。詳細は `test_20260617_092217.md` 末尾の「追補」セクション参照。

---

## テスト実行結果サマリー

### 実行環境
- サーバー: localhost:3000（dev サーバー、agents.sh が管理）
- テスト DB: eckrccrfnblzdbflnssf（Supabase テスト用プロジェクト）
- テスト用 E2E ユーザー: e2e_user_a@example.com / e2e_user_b@example.com
- 総実行時間: 1 分 24 秒

### テスト内訳（全てのテストが PASS）

**CRITICAL シナリオ M01〜M04**:
| # | シナリオ | 結果 | 実行時間 |
|---|---|---|---|
| M01 | 2ユーザー間でターン交代の会話（両者認証済み） | ✅ | 7.4s |
| M02 | ページリロード後もセッションが維持される | ✅ | 8.1s |
| M03 | 第三者認証ユーザーが被告として発言できない | ✅ | 9.0s |
| M04 | ゲスト被告が Cookie トークンで発言できる | ✅ | 10.1s |

**関連 spec（リグレッション確認）**:
- BUG-004（弁護人 AI タブ）: 2/2 通過 → 被告参加直後のタブ表示確認
- BUG-005（閉廷アナウンス）: 3/3 通過 → AI 閉廷宣告生成タイミング・順序確認

---

## 実装確認項目（オーディ向け）

### 1. 変更ファイル確認

#### 変更ファイル
```
✅ app/case/[id]/CaseRoom.tsx
   - isOpponentEndProposal バナー部分の style 属性変更
   - 新規 useEffect: ビープ音再生ロジック追加
   - 動作ロジック（条件分岐・ターン制御）の変更なし
```

#### 変更なしであるべきファイル
```
✅ app/layout.tsx
✅ app/case/[id]/page.tsx
✅ docs/knowledge/design.md（追記なし）
✅ その他すべての app/ ファイル
```

### 2. バナー強調の確認コマンド

```bash
# isOpponentEndProposal の全箇所を確認
grep -n "isOpponentEndProposal" app/case/\[id\]/CaseRoom.tsx
```

期待結果:
- render 部分: `bg-amber-50`, `border-amber-300`, `text-amber-900`, `animate-pulse`, `role="alert"` が追加（`role="alert"` は暗黙に `aria-live="assertive"` を持つため `aria-live` の追加は不要）
- 条件ロジック（`&&`）自体は変わっていない

### 3. ビープ音 useEffect の確認

```bash
# useEffect で useRef と Audio API を使用していることを確認
grep -B 5 -A 20 "useEffect.*endProposedBy" app/case/\[id\]/CaseRoom.tsx
```

期待結果:
```typescript
// boolean | null 型の ref で「未確定」「false」「true」を区別する。
// caseData / myRole が null のうちは ref を更新せず、確定後の最初の観測値を
// ベースラインとして ref に焼き込む (その回は鳴らさない)。以降の
// false → true 遷移のみで再生する。
const prevIsOpponentEndProposalRef = useRef<boolean | null>(null);
useEffect(() => {
  if (!caseData || !myRole) return;
  const { isOpponentEndProposal: isOpponent } = computeEndProposalState(
    caseData.endProposedBy,
    myRole
  );
  const prev = prevIsOpponentEndProposalRef.current;
  prevIsOpponentEndProposalRef.current = isOpponent;
  if (prev === null) return;          // ベースライン化 (初回確定時は鳴らさない)
  if (prev || !isOpponent) return;    // false → true 遷移以外は鳴らさない
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    // 880Hz / sine wave / 0.15s / gain 0.08
  } catch {
    // autoplay policy などで失敗しても無視 (バナー強調が補助)
  }
}, [caseData?.endProposedBy, myRole]);
```

### 4. git コミット確認

```bash
git status
```

期待: `app/` 配下の実装変更は `app/case/[id]/CaseRoom.tsx` のみ（docs / test-log / audit-log は本タスクの記録として更新あり）

```bash
git diff app/case/\[id\]/CaseRoom.tsx | head -100
```

期待: 
- `bg-stone-100` → `bg-amber-50`
- `border-stone-300` → `border-amber-300`
- `text-stone-600` → `text-amber-900`
- `animate-pulse` 追加
- `role="alert"` / `aria-live="polite"` 追加
- `useEffect` / `useRef` 追加

### 5. 依存配列の確認

```bash
grep -A 15 "useEffect.*endProposedBy" app/case/\[id\]/CaseRoom.tsx | grep "}, \["
```

期待: `}, [caseData?.endProposedBy, myRole]);`（過度な依存なし）

### 6. 自分側バナーが触られていないことを確認

```bash
grep -n "isMyEndProposal" app/case/\[id\]/CaseRoom.tsx
```

期待: 行番号が表示されるが、その行の style/render に変更がない

---

## テスタ実装の妥当性

### M01〜M04 CRITICAL シナリオが全て通過した意義

**BUG-006 修正の目的**:
- 相手が「終了を提案」したことを能動的に通知する
- バナー強調（amber 色 + animate-pulse）で視覚的に目立たせる
- Web Audio API でビープ音を再生して聴覚的に通知する

**テストで確認した内容**:
1. 基本フロー（2ユーザー会話・ターン制御）が正常
2. セッション復元・リロード後もセッション維持
3. 第三者割り込み検出・アクセス制御が正常
4. ゲスト被告フロー（Cookie トークン）が正常
5. 既存修正（BUG-004 / BUG-005）との相互影響なし

**リグレッション確認（関連 spec）**:
- BUG-004（被告参加直後の弁護人タブ表示）: 2/2 通過 → 継続正常
- BUG-005（AI 閉廷宣告の生成タイミング・順序）: 3/3 通過 → 継続正常

### 新規 E2E spec について

task.md L73-81 より:

> 本タスクでは新規 E2E spec を **追加しない**。理由:
> - バナー配色変更と `animate-pulse` は Playwright で「アニメーションが動いている」を検証するのが難しい
> - Web Audio API の音再生は E2E では音声出力の有無を確認できない
> - どちらも UI 装飾と補助通知の範疇で、機能要件としては `isOpponentEndProposal` バナーが表示されること自体が主体（既存挙動）

テスタが実施したテスト結果（CRITICAL + BUG spec フル実行）でリグレッション検知として十分である。

---

## オーディに対する確認観点（チェックリスト）

**実装変更確認**:
- [ ] CaseRoom.tsx の `isOpponentEndProposal` バナーが amber 色（`bg-amber-50`, `border-amber-300`, `text-amber-900`）に変更されている
- [ ] バナーに `animate-pulse` が付与されている
- [ ] バナーに `role="alert"` と `aria-live="polite"` が付与されている（アクセシビリティ）
- [ ] `useEffect` が `[caseData?.endProposedBy, myRole]` 依存配列で追加されている
- [ ] `useRef` で前回値を追跡し、`false → true` 遷移のみでビープ再生をトリガしている

**エラーハンドリング確認**:
- [ ] Web Audio API の `try/catch` でエラーを握り、phase 遷移に影響を与えていない
- [ ] AudioContext が未対応ブラウザでもサイレント失敗している

**スコープ確認**:
- [ ] 自分側バナー（`isMyEndProposal`）は変更されていない
- [ ] app/layout.tsx は変更されていない
- [ ] design.md は変更されていない
- [ ] 新規ファイルの追加がない（`CaseRoom.tsx` のみ変更）
- [ ] git コミットが `CaseRoom.tsx` + `task.md` のみ

**リグレッション確認**:
- [ ] CRITICAL M01〜M04 が全て通過している
- [ ] BUG-004 spec が通過している
- [ ] BUG-005 spec が通過している

---

## 参考資料

- テストレポート: `/home/daichi/Documents/family_court/docs/knowledge/test-log/test_20260617_092217.md`
- task.md: 本タスクの最優先ドキュメント（BUG-006 実装方針）
- design.md: 既存設計書（変更なし）
- eng-to-aud.md: ビルド実装ノート（変更内容の詳細）

**テスタ署名日**: 2026-06-17  
**判定**: ✅ ビルド品質合格 → 次段階（オーディ）へ進行可能
