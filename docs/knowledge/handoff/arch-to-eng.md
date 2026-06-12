# アーキ → ビルド 引き継ぎメモ（FEAT-006）

このメモは `docs/knowledge/design.md` 末尾の `## FEAT-006 対応` セクションと併読すること。
矛盾があれば `task.md` → `design.md` → 本メモの順で優先する。

---

## 設計上の主要判断と理由

### 1. `end_proposed_by` の型を `uuid` → `text` に変更した

- **判断**: task.md の例示は `uuid null` だが、ゲスト被告には `user_id` 相当の UUID が存在しないため、`text` で `'plaintiff'` / `'defendant'` / `'guest'` のロール識別子を保存する形に変更した。
- **理由**: ゲスト被告が終了提案を出せる経路を保ちつつ、認証被告とゲスト被告を同じ意味論で扱うため。
- **実装上の注意**: クライアントから送られてきた role 値は信用せず、サーバ側で認証情報（`auth.getUser()` または `verifyGuestToken`）から actor を確定すること。

### 2. 延長投票は `cases` の 2 カラム方式（案 A）

- **判断**: `extension_vote_plaintiff text` / `extension_vote_defendant text` を `cases` に追加。別テーブル不要。
- **理由**: 両者投票後にカラムを NULL に戻して次の延長サイクルへ進める状態管理が単純。RLS / GRANT 追加が不要。
- **トレードオフ**: 票履歴が残らない。必要になったら次タスクで `case_extension_votes` テーブル追加に移行可能。

### 3. 挨拶記録は `arguments.is_greeting boolean` で表現（案 1）

- **判断**: `arguments` に `is_greeting boolean not null default false` を追加。挨拶 row は `round = 0`、`phase = 'opening'` または `'closing'` で INSERT。
- **理由**: 既存の SELECT / 表示ロジックにそのまま乗る。round 集計は `WHERE is_greeting = false`（または `round > 0`）で除外。
- **AI 影響**: `/api/cases/[id]/defense/draft` が `arguments` を読む際に挨拶も含まれることになるが、初版では除外せず採用する。AI の出力品質が落ちたら次タスクで除外検討。

### 4. migration は 1 ファイルに集約（案 A）

- **判断**: 削除 → カラム追加 → check 制約更新 を 1 つの migration にまとめる。
- **理由**: 1 トランザクションでの原子性を最優先。中途半端な「データだけ消えた状態」を防ぐ。
- **ファイル名**: `supabase/migrations/20260612NNNNNN_feat006_chat_rounds_and_greetings.sql`（NNNNNN は配置時の HHMMSS）。

### 5. `cases.phase` は ENUM ではなく `text + check`

- **判断**: `ALTER TABLE cases DROP CONSTRAINT cases_phase_check; ADD CONSTRAINT ... CHECK (phase IN (..., 'extension_voting', ...));`
- **理由**: 現行 schema.sql で確認済み。ENUM ではないため `ALTER TYPE ADD VALUE` 不要、`DROP/ADD CONSTRAINT` で安全に値追加できる。

---

## 実装の順序（推奨）

1. **migration 作成**: `supabase/migrations/20260612NNNNNN_feat006_chat_rounds_and_greetings.sql` を新規作成。下記 DDL ドラフトに従う。
2. **schema.sql 反映**: 本番 snapshot 方針に揃え、新カラム / check 制約更新を schema.sql に追記。
3. **型定義更新**: `lib/types.ts` の `Phase` / `Case` / `Profile` / `ArgumentRow`（実名に応じて） に新フィールド追加。
4. **snake→camel マップ**: `lib/case-response.ts` に新カラム 3 つ（cases）の写像を明示追加（BUG-003 の教訓）。
5. **既定挨拶モジュール**: `lib/greetings.ts`（新規）に `DEFAULT_OPENING_GREETING` / `DEFAULT_CLOSING_GREETING` / `resolveOpeningGreeting` / `resolveClosingGreeting` を実装。
6. **PHASE_LABELS 更新**: 既存定義位置（`lib/types.ts` か `lib/phase.ts`）に `extension_voting: "延長投票"` を追加。
7. **プロフィール API 改修**: `app/api/profile/route.ts`（既存実装位置に揃える）の PATCH に `openingGreeting` / `closingGreeting` 受領を追加。バリデーション: NULL 可、空文字 NG、長さ 1〜125、改行は 1 つまで。
8. **プロフィール画面 UI**: `app/profile/page.tsx` に 2 つのテキスト入力 + 「デフォルトに戻す」ボタンを追加。
9. **ケース作成画面の縮退**: `app/page.tsx` から `maxRounds` state / `<select>` / body 送信を削除。
10. **ケース作成 API**: `app/api/cases/route.ts` POST から `maxRounds` の参照を完全撤去（無視ではなく非読み取り）。
11. **opening 進入点に挨拶 INSERT**: 既存の opening 開始ロジック（場所は実装側で grep 確認）に、原告 / 被告の opening_greeting を 2 行 INSERT する処理を追加。
12. **新規 API: end-proposal**: `app/api/cases/[id]/end-proposal/route.ts` を新設。
13. **新規 API: extension-vote**: `app/api/cases/[id]/extension-vote/route.ts` を新設。
14. **CaseRoom UI 拡張**: `app/case/[id]/CaseRoom.tsx` にサイドアイコン、相手側バナー、延長投票モーダル、挨拶 row 表示を追加。polling 周期は既存に乗せる。
15. **closing → extension_voting 遷移ロジック**: 既存の closing → judging 遷移コードに分岐を入れて、`round === max_rounds` 到達時に `phase = 'extension_voting'` へ。
16. **judging 遷移時の終了挨拶 INSERT**: 両者 finish 確定時の処理内で終了挨拶を 2 行 INSERT してから `phase = 'judging'` に遷移。

---

## migration DDL ドラフト

```sql
-- supabase/migrations/20260612NNNNNN_feat006_chat_rounds_and_greetings.sql
-- FEAT-006: チャット回数仕様の柔軟化と固定挨拶導入
-- 1) 旧データ全削除（cascade で arguments/verdicts/judge_messages も掃ける）
-- 2) cases に新カラム追加（end_proposed_by, extension_vote_*）
-- 3) profiles に挨拶 2 カラム追加
-- 4) arguments.is_greeting 追加
-- 5) cases.phase の check 制約に 'extension_voting' を追加

-- ============ 1. 旧データ削除 ============
-- cases に on delete cascade が設定済みのため、
-- DELETE FROM cases; で arguments / verdicts / judge_messages も同時削除される。
delete from public.cases;

-- ============ 2. cases に新カラム追加 ============
alter table public.cases
  add column end_proposed_by text null
    check (end_proposed_by is null or end_proposed_by in ('plaintiff','defendant','guest')),
  add column extension_vote_plaintiff text null
    check (extension_vote_plaintiff is null or extension_vote_plaintiff in ('continue','finish')),
  add column extension_vote_defendant text null
    check (extension_vote_defendant is null or extension_vote_defendant in ('continue','finish'));

-- ============ 3. profiles に挨拶カラム追加 ============
alter table public.profiles
  add column opening_greeting text null
    check (opening_greeting is null or (char_length(opening_greeting) between 1 and 125)),
  add column closing_greeting text null
    check (closing_greeting is null or (char_length(closing_greeting) between 1 and 125));

-- ============ 4. arguments.is_greeting ============
alter table public.arguments
  add column is_greeting boolean not null default false;

-- ============ 5. cases.phase check 制約更新 ============
alter table public.cases drop constraint if exists cases_phase_check;
alter table public.cases add constraint cases_phase_check
  check (phase in ('waiting','opening','argument','closing','extension_voting','judging','verdict'));
```

- 既存テーブルへの GRANT は元テーブルから継承するため追加不要。
- RLS ポリシーは既存ポリシーで新カラムも自動カバー（`cases` SELECT `using (true)`、`profiles` SELECT/UPDATE `auth.uid() = id`、`arguments` SELECT `using (true)`）。新規ポリシー追加なし。

---

## 新規 API ハンドラの認証パターン

両エンドポイントとも以下のパターンで実装する:

```typescript
// app/api/cases/[id]/end-proposal/route.ts（および extension-vote）
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import { verifyGuestToken } from "@/lib/guest-token";
import { NextResponse } from "next/server";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const caseId = params.id;
  // UUID バリデーション（既存 UUID_REGEX を流用）
  if (!UUID_REGEX.test(caseId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const admin = createAdminClient();
  const { data: caseRow, error } = await admin
    .from("cases")
    .select("id, plaintiff_id, defendant_id, phase, end_proposed_by, extension_vote_plaintiff, extension_vote_defendant, max_rounds, round")
    .eq("id", caseId)
    .single();
  if (error || !caseRow) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // actor 識別
  let actorRole: "plaintiff" | "defendant" | "guest" | null = null;
  try {
    const session = createSessionClient();
    const { data: { user } } = await session.auth.getUser();
    if (user?.id === caseRow.plaintiff_id) actorRole = "plaintiff";
    else if (user?.id === caseRow.defendant_id) actorRole = "defendant";
  } catch { /* ignore */ }

  if (!actorRole && caseRow.defendant_id === null) {
    // ゲスト被告経路: 既存の verifyGuestToken
    const cookieToken = /* cookies().get("guest_token_" + caseId)?.value */ "...";
    if (cookieToken && await verifyGuestToken(caseId, cookieToken)) {
      actorRole = "guest";
    }
  }

  if (!actorRole) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // ... 以下、設計書記載の状態遷移分岐
}
```

- `createSessionClient()` の try-catch 保護は既存パターン（LOW-001）に揃える。
- 書き込みは必ず `createAdminClient()` 経由。
- 楽観的更新（`WHERE end_proposed_by IS [old]` / `WHERE extension_vote_<side> IS NULL`）で同時実行時の競合を抑える。

---

## CaseRoom 状態管理に追加するもの

- polling で取得する case フィールドに以下を追加:
  - `endProposedBy: "plaintiff" | "defendant" | "guest" | null`
  - `extensionVotePlaintiff: "continue" | "finish" | null`
  - `extensionVoteDefendant: "continue" | "finish" | null`
  - `phase` リテラルに `"extension_voting"` を含める
- 追加 `useState`:
  - `isProposingEnd`（in-flight 抑止）
  - `isVotingExtension`（in-flight 抑止）
  - `extensionModalState`: `"closed" | "voting" | "awaiting_opponent"`
- 新規 interval は不要（既存 polling に乗る）。
- 自分側のロール特定は既存のロジック（plaintiff_id / defendant_id / ゲストトークン）に揃える。

---

## フェーズラベル定義の更新

grep ヒント:

```bash
# PHASE_LABELS の定義箇所を特定
grep -rn "PHASE_LABELS" lib/ app/
# Phase 型の定義箇所を特定
grep -rn "type Phase" lib/
grep -rn '"verdict"' lib/  # phase リテラルが羅列されている箇所
```

更新時は **labels と type literal の両方** に `"extension_voting"` を加える。type literal が漏れると TypeScript エラーで気付ける。

---

## `app/page.tsx` から削除する箇所

特定方法:

```bash
grep -n "maxRounds" app/page.tsx
```

削除対象:

- `maxRounds` の `useState`
- `<label>議論ラウンド数</label>` 配下の `<select>` ブロック
- `fetch(..., { body: JSON.stringify({ topic, maxRounds, ... }) })` の `maxRounds` キー
- 関連する import や型注釈で `maxRounds` だけのために残っているもの

---

## リグレッション確認シナリオ（必須）

1. **新規ケース作成 → 3 回まで普通に進行 → 延長投票で両者 finish → 判決画面に到達**
   - ラウンド数表示は 0 から数えず 1〜3 で進行すること
   - 終了挨拶 2 行が判決画面前に表示されていること
2. **新規ケース作成 → 2 回目で原告が終了提案 → 被告が「同意して終了」 → 判決画面**
   - 自分が提案中表示が原告側に出ること
   - 相手側バナーが被告側に出ること
   - 判決が生成され、それまでの arguments が判決入力に使われていること
3. **新規ケース作成 → 終了提案を出して撤回 → 普通に 3 回まで進行**
   - 撤回後、相手側のバナーが消えること
4. **新規ケース作成 → 3 回終了後の延長投票で原告 continue / 被告 finish → max_rounds が 6 に → 6 回目まで進行**
   - 4 回目開始時に current_turn が plaintiff にリセットされていること
   - max_rounds が 6 になったことが画面表示にも反映されていること
5. **延長後さらに 6 回終了 → 同じ流れで再度延長**
   - 上限なしを確認
6. **profile 編集画面で挨拶を変更 → 新ケース開始時に反映**
   - 旧ケースの挨拶は変わらないこと（既に INSERT 済みのため）
   - 空文字保存で 400 エラーになること
   - 「デフォルトに戻す」でカラムが NULL に戻り、新ケースで「よろしくお願いします」が表示されること
7. **ゲスト被告のケース**
   - ゲスト被告の挨拶はサーバ既定文「よろしくお願いします」/「ありがとうございました。」が表示されること
   - ゲスト被告も終了提案アイコンが押せること
   - ゲスト被告も延長投票モーダルで投票できること
8. **既存機能の regression なし**
   - 認証 / フレンド / 法律機能 / プロフィール他項目編集 / アバター変更 / API キー登録
   - マイページ (`/me`) の表示 / 過去のケースダイジェスト
   - 旧データ削除後の動作（`/history` などで旧ケースが消えていることを確認）

---

## 未解決事項 / 実装で迷ったら

1. **AI 履歴から挨拶を除外するか**: 案 1 採用で `arguments` に挨拶が混在するため、AI 入力にも挨拶が入る。初版では除外しない。AI 品質劣化が観察された場合のみ次タスクで対応する。判断は実装後の動作確認時にダイチへ。
2. **closing フェーズの存続**: 本設計では closing フェーズを廃止せず、closing → extension_voting → (continue) argument 再開 または (finish) judging の順序を採用。closing 中の自由弁論ターンが本当に残るべきかは曖昧、要件定義書通り維持する判断。
3. **「同意して終了」CTA の二重押下**: バナー CTA とサイドアイコンが同一 API を叩くため、共通の `isProposingEnd` フラグで両方 disable する。
4. **延長後 `round` の値**: 加算前 `max_rounds + 1`（例: max 3 → 延長後 6、次 round は 4）を採用、`current_turn = 'plaintiff'` にリセット。task.md 明示なし、UX 一貫性のための判断。
5. **延長突入時の `end_proposed_by` リセット**: extension_voting 突入時に `end_proposed_by = NULL` も同時更新する（過去の終了提案は意味を失うため）。
6. **挨拶 row の `phase` 値**: 開始挨拶 = `'opening'`、終了挨拶 = `'closing'`（直前のフェーズに揃える）。`'argument'` は使わない。
7. **`round = 0` を使う既存箇所の確認**: 実装時に `from("arguments")` を全件 grep し、`round = 1` から始まる前提を持つ箇所があれば `is_greeting = false` フィルタを明示追加すること。

---

## やってはいけないこと（再掲）

- 既存 `design.md` セクションを削除・短縮しない。
- 旧データの後方互換ロジックを書かない（`max_rounds = 2/5` のケース対応、`is_greeting` を持たない arguments の分岐などは不要）。
- 新規 npm 依存を追加しない（アイコン用ライブラリ・モーダル用ライブラリ等）。
- breakpoint を導入しない。
- `brand-500` を使わない。
- 弁護人 AI のプロンプト / 出力契約を変更しない。
- ヘッダー本体 (`Header.tsx`) のレイアウトを変更しない。
- マイページ (`/me`) 本体に挨拶設定 UI を追加しない（`/profile` のみ）。

---

## 関連ドキュメント

- `docs/knowledge/task.md`（最優先）
- `docs/knowledge/design.md` の `## FEAT-006 対応` セクション（本メモと併読）
- `docs/knowledge/requirements.md`
- `docs/knowledge/environment.md`
- `docs/decisions/003-db-design.md`（RLS 方針）
- `docs/backlog.md` の FEAT-006
