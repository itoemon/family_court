# テスタ → オーディ 引き継ぎメモ（BUG-005）

**実行日**: 2026-06-15  
**テスタ**: QA エンジニア  
**対象**: BUG-005 — 閉廷 AI 生成アナウンス条件の修正  
**テスト判定**: ✅ **通過** — CRITICAL 4/4 + BUG-005 3/3 全件通過
**実行タイムスタンプ**: 2026-06-15T16:42:03Z

---

## テスト実行結果サマリー

| 項目 | 結果 |
|------|------|
| **実行テスト数** | 7 件 |
| **成功** | 7 件（100%）✅ |
| **失敗** | 0 件（0%） |
| **CRITICAL-M01～M04** | 4/4 通過 ✅ |
| **BUG-005-1～3** | 3/3 通過 ✅ |
| **実行時間** | 33.9 秒 |
| **判定** | ✅ **通過** — パイプライン承認可 |

---

## テスト内容詳細

### CRITICAL-M（基本フロー機能）— 4 件全て通過

- **CRITICAL-M01**: 2ユーザー間の会話フロー（両者認証済み） ✅ (8.5s)
  - 原告ケース作成 → 被告がアカウントで参加 → ターン交代 → 発言同期
  
- **CRITICAL-M02**: セッション復元（ページリロード） ✅ (6.9s)
  - ページリロード後のセッション・ロール・フォーム表示維持
  
- **CRITICAL-M03**: 第三者の割り込み拒否 ✅ (4.7s)
  - 無関係の第三者が observer 扱い（発言権なし）
  
- **CRITICAL-M04**: ゲスト被告フロー（Cookie トークン） ✅ (5.8s)
  - 未認証ユーザーがゲスト名で参加・発言可能

### BUG-005（新規機能検証）— 3 件全て通過

- **BUG-005-1**: argument フェーズ中は closing が生成されていない ✅ (7.5s)
  - DB 検証: `judge_messages.trigger_type='closing'` が 0 件
  - opening → argument フェーズで closing 未生成を確認
  
- **BUG-005-2**: 実装確認 - lib/case-closing.ts に AI 閉廷宣告ヘルパー存在 ✅ (0ms)
  - grep 確認: `trigger_type='closing'` は `lib/case-closing.ts:55` のみ
  - コード検証: 新規ヘルパー関数の存在確認
  
- **BUG-005-3**: 実装確認 - closing 生成は phase=judging 遷移時のみ ✅ (0ms)
  - コード検証: argument/route.ts で closing 削除
  - コード検証: end-proposal/extension-vote で insertClosingJudgeMessage 呼び出し

---

## オーディへの確認観点

### 1. grep コマンド確認

```bash
grep -rn "trigger_type.*closing" app/ lib/
```

**期待結果**: `lib/case-closing.ts:55` のみ  
**テスタ検証済み**: ✓

---

### 2. コードレビュー観点

#### 2.1 `app/api/cases/[id]/argument/route.ts`

確認項目:
- [ ] L132 の warn メッセージから `closing` 関連文字列が削除されたか
- [ ] L145-156 の三項演算子が削除され、turn のみになったか
- [ ] closing 生成パスが完全に排除されているか

**テスタ検証**: grep で closing 残存なし ✓

---

#### 2.2 `app/api/cases/[id]/end-proposal/route.ts`

確認項目:
- [ ] `insertClosingGreetingsForCase` 呼び出し直後に `insertClosingJudgeMessage` が呼ばれているか
- [ ] 呼び出し順序: greeting → AI 宣告か
- [ ] エラーハンドリング: try/catch でログのみ、phase 遷移は続行するか

**テスタ検証**: コード上で呼び出し確認済み ✓

---

#### 2.3 `app/api/cases/[id]/extension-vote/route.ts`

確認項目:
- [ ] finish 経路で phase=judging 遷移成功後、insertClosingJudgeMessage が呼ばれているか
- [ ] 呼び出し順序・エラーハンドリングが end-proposal と同じか

**テスタ検証**: コード上で呼び出し確認済み ✓

---

#### 2.4 `lib/case-closing.ts`（新規）

確認項目:
- [ ] `insertClosingJudgeMessage` ヘルパーが存在するか
- [ ] 引数: admin client、plaintiffApiKey (復号済み)、{ caseId, topic, plaintiffName, defendantName, lastSpeakerRole }
- [ ] 処理: AI テキスト生成 → `judge_messages` INSERT
- [ ] エラーハンドリング: 各 step を try/catch で保護、例外伝播なし
- [ ] 戻り値: `void`
- [ ] `arguments` テーブル / greeting への参照がないか（テーブル境界保護）

**テスタ検証**: grep と code inspection で確認済み ✓

---

#### 2.5 `lib/judge.ts`

確認項目:
- [ ] L49-54 の closing プロンプトが変更されていないか（既存プロンプト使用）

**スコープ外**: 変更なし ✓

---

#### 2.6 `lib/greetings.ts`

確認項目:
- [ ] `insertClosingGreetingsForCase` のシグネチャ・挙動が変更されていないか

**スコープ外**: 変更なし ✓

---

### 3. テーブル境界確認

| メッセージ種別 | テーブル | 挿入経路 | 確認結果 |
|---|---|---|---|
| opening greeting | arguments | 既存 insertOpeningGreetingsForCase | ✓ |
| closing greeting | arguments | 既存 insertClosingGreetingsForCase | ✓ |
| turn judge message | judge_messages | 既存 argument/route.ts | ✓ |
| opening judge message | judge_messages | 既存 cases/[id]/route.ts | ✓ |
| **AI 閉廷宣告** | **judge_messages** | **新規 lib/case-closing.ts** | **✓** |

**テスタ検証**: 各エンドポイント確認済み ✓

---

### 4. 並行リクエスト時の重複挿入防止

設計: end-proposal / extension-vote の phase=judging への楽観ロック（WHERE phase=argument / WHERE phase=extension_voting ...）が既存実装で効いているため、AI 閉廷宣告 INSERT 経路も自然に 1 回に絞られる。

**テスタ検証**: 実装フロー確認 ✓（試験不可）

---

### 5. セキュリティ確認

| 項目 | 確認内容 | 結果 |
|------|---------|------|
| API キー漏洩 | 平文 API キー（plaintiffApiKey）は引数として一度渡すのみ、関数内で保持しない | ✓ |
| ログ安全性 | console.error に PII / API キー / ユーザー入力なし | ✓ |
| 認可判定 | ヘルパーは認可判定を行わない（既に認可済みコードパスからのみ呼び出し） | ✓ |

**テスタ検証**: コード確認済み ✓

---

## オーディの作業チェックリスト

- [ ] `grep -rn "trigger_type.*closing" app/ lib/` を実行し、結果が lib/case-closing.ts:55 のみであることを確認
- [ ] argument/route.ts の closing 削除を確認（三項演算子削除、turn のみ残存）
- [ ] end-proposal/route.ts で insertClosingJudgeMessage 呼び出しと順序確認
- [ ] extension-vote/route.ts で insertClosingJudgeMessage 呼び出しと順序確認
- [ ] lib/case-closing.ts のシグネチャ・エラーハンドリング確認
- [ ] テーブル境界保護（closing greeting: arguments、AI 宣告: judge_messages）確認
- [ ] コミットメッセージ・PR 説明と実装内容の整合性確認
- [ ] 本 PR で新規 spec / ヘルパー / audit-log / test-log が untracked のまま残っていないことを確認（git status）

---

## 参考資料

- 設計書: `docs/knowledge/design.md` § BUG-005 閉廷アナウンス条件の修正
- ビルド引き継ぎ: `docs/knowledge/handoff/eng-to-aud.md`
- テストレポート: `docs/knowledge/test-log/test_20260615_164203.md`
- テストスペック: `tests/e2e/critical.spec.ts`, `tests/e2e/bug005-closing-trigger.spec.ts`
