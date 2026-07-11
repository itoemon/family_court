# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。
>
> **重要 1（design.md 取り扱い）**: `docs/knowledge/design.md` は永続累積資料。既存設計を削除・短縮・全面書き換えしない。**末尾に新規セクション `## SEC-001/003 判決ルート堅牢化` を純追記**する。
>
> **重要 2（実装体制）**: 標準フロー = リード（要件・設計レビュー・テスト・アドバサリアル・PR）→ アーキ（設計）→ ビルド（実装）→ リードがテスト＋アドバサリアル → **オーディ（独立セキュリティ監査・本タスクは必須）** → コパ。セキュリティ修正なのでオーディを必ず通す。
>
> **重要 3**: セキュリティ修正のため、**「直したつもりで直っていない」を防ぐ**。実際に「未認証/第三者が verdict を叩けない」ことをリードがアドバサリアル検証（本番でなくテスト DB + REST 直叩き）で実証する。

## 今回のタスク

判決ルート `app/api/cases/[id]/verdict/route.ts` のセキュリティ穴（SEC-001）と出力未検証（SEC-003）を塞ぐ。由来: 2026-07-07 全ディレクトリ・コードレビュー（`docs/backlog.md` の SEC-001 / SEC-003）。

**バックログ ID**: SEC-001（HIGH）+ SEC-003（MEDIUM）
**依存**: MON-001 PR-A/PR-B（`uses_service_key` / `resolveCaseAiKey`）。

---

### 背景（実コードで裏取り済み）

- `verdict/route.ts` は **認証・認可が一切ない**。ガードは `if (c.phase !== "judging")` のみ（20 行目）。middleware は `/api` を除外するため、**ケース UUID を知る第三者（未ログイン含む）が POST で判決生成を叩ける**。
  - 影響: (1) `requestVerdict` が Claude を呼ぶ → **サービスキーモード（`uses_service_key=true`）なら運営が課金される**、(2) 他人のケースに verdict 書き込み・`phase='verdict'` 強制進行、(3) `phase` チェック → `update`（87 行目）間に排他がなく、**同時リクエストで二重生成＝二重課金**（TOCTOU）。
- 対照的に `defense/route.ts` は `resolveAuth`（`getUser` + 参加者チェック + `verifyGuestToken`）で認証済み。**verdict だけ抜けている**。
- verdict の POST 呼び出し元は `app/case/[id]/CaseRoom.tsx:154`（ケース参加者が閲覧中に叩く）。→ **認可は「そのケースの参加者（原告 / 認証被告 / ゲスト被告）」に限定**するのが正しい。
- 出力未検証（SEC-003・`lib/claude.ts`）: `message.content[0].type`（56 行付近）は content が空配列だと実行時例外。verdict ルートは `requestVerdict` を try/catch しておらず未処理例外 → 500。`JSON.parse` 結果も未検証で `winner` enum・スコア 0–100 をクランプせず DB 保存。

---

### スコープ（IN / OUT）

**IN**:
1. **共通認可ヘルパーの切り出し**: `defense/route.ts` の `resolveAuth` 相当を `lib/case-auth.ts`（新規）に切り出す。責務: 「このリクエストが対象ケースの参加者か」を判定し、`{ ok: true, userId?, isGuest? }` / `{ ok: false, status, error }` を返す。認証ユーザーは `user.id ∈ {plaintiff_id, defendant_id}`、ゲスト被告は `verifyGuestToken(id, cookieToken)`。**既存 defense の挙動を変えない**よう、まず defense の実装を移設して同一挙動を担保（defense も新ヘルパー経由に張り替え、回帰しないこと）。
2. **verdict ルートに認可を追加**: 冒頭（`isUuid` 検証の後、DB 参照の前後どちらでも可だが Claude 呼び出しより必ず前）で `resolveCaseAuth` を通し、非参加者は 403 / 未ログイン & ゲストトークン無しは 401。ケース不在は 404。
3. **TOCTOU（二重生成）対策**: 判決確定の `update` を**条件付き更新**にする。`update cases set phase='verdict', updated_at=now() where id=? and phase='judging'` とし、**更新行数 0 なら 409 を返して Claude 呼び出し前に弾く**。実装順序は「(a) 認可 → (b) 条件付き `phase` 更新で judging→verdict を原子的に奪取（成功した1リクエストだけが以降へ進む）→ (c) Claude 呼び出し → (d) verdict 保存」。※ (b) を Claude より前に置くのが肝（先にフェーズを奪ってから生成）。もし生成失敗時に phase を戻す要否は設計で判断（戻さないと再生成不能になる懸念 vs 二重課金防止。トレードオフを design.md に明記）。
4. **SEC-003 出力検証**（`lib/claude.ts:requestVerdict` + verdict ルート）:
   - `message.content` が空 / 先頭が非 text ブロックのケースをガード（例外にせずフォールバックへ）。
   - verdict ルートで `requestVerdict` を try/catch し、失敗時は 500 を整形して返す（未処理例外にしない）。
   - パース後に `winner ∈ {plaintiff, defendant, draw}` を検証、`plaintiffScore`/`defendantScore` を 0–100 にクランプ。異常時は既存の draw フォールバック（`lib/claude.ts` の catch 分岐）に寄せる。
5. **E2E spec**（`tests/e2e/sec001-verdict-auth.spec.ts` 新規）: 下記テスト観点。

**OUT（本 PR では扱わない）**:
- SEC-002（AI ルートのレート制限・ケース単位の生成回数上限）→ 別 PR（次工程）。
- SEC-004（モデル ID 集約）→ 別 PR（任意）。
- defense/draft/argument 以外への認可ヘルパー横展開は最小限（verdict 対応が主眼。defense は移設で挙動不変）。

---

### 認可仕様（確定）

- **判決をトリガーしてよいのは対象ケースの参加者**（原告 `plaintiff_id` / 認証被告 `defendant_id` / ゲスト被告=有効な guest token 保持者）。第三者・未ログインは不可。
- 既存 `verifyGuestToken` / `createSessionClient` / `createAdminClient` / `isUuid` を流用。
- middleware は `/api` を通さない前提なので、**API ルート内で自前認可を持つ**（defense と同じ設計）。

---

### テスト観点（テスタ／リードのアドバサリアル）

E2E は `bug005` / `mon001b` の admin fast-path + 専用 ephemeral ユーザーパターンを踏襲。テスト DB 対象。`tests/e2e/sec001-verdict-auth.spec.ts`:

1. **未認証は弾かれる**: phase=judging のケースを用意 → **未ログインで POST /verdict → 401/403**、verdict が生成されない（`verdicts` 行が増えない・`phase` が judging のまま）。
2. **第三者（非参加者）は弾かれる**: 別の認証ユーザーで POST → **403**、生成されない。
3. **参加者（原告）は成功**: 原告セッションで POST → 200、verdict 生成、phase=verdict（TEST_MODE で Claude をモックできるなら活用。requestVerdict のモック有無を確認し、無ければ最小で「認可を通って処理に入る」ことを検証）。
4. **二重生成防止**: judging のケースに参加者が並行 or 連続で 2 回 POST → 1 回だけ生成、2 回目は 409（`verdicts` 行が 1 つ）。
5. **出力検証**: （可能なら）content 空 / 不正スコアのモックで、例外 500 でなくフォールバック（draw・クランプ）になること。
6. 既存 spec（critical / bug005 / mon001-credits / mon001b）がリグレッションしないこと。特に **defense の認可が移設後も同一挙動**（bug004-defense-tab 等）。
- 後始末は case→user 順。`e2e_user_a` を汚染しない。

**リードのアドバサリアル検証（必須）**: テスト DB に judging ケースを作り、(a) 未認証 REST 直叩き → 401/403、(b) 非参加者 JWT で直叩き → 403、(c) 生成されないこと（verdicts 行数・phase 不変）を実証する。

---

### オーディに対する観点（本タスクは監査必須）

- verdict の全経路（認証ユーザー/ゲスト/未認証）で認可が正しく効くか。Claude 呼び出しが認可通過後にのみ走るか。
- TOCTOU: 条件付き更新が Claude 呼び出しの**前**にあり、二重生成・二重課金が起きないか。生成失敗時の phase 復帰方針が妥当か。
- resolveAuth 移設で defense の既存挙動が変わっていないか（回帰）。
- 出力検証: 空 content / 不正 JSON / 範囲外スコアでクラッシュや不正保存が起きないか。
- 情報漏洩: 認可失敗時にケース内部情報をエコーしていないか。
- git status 最終確認（新規 spec / lib/case-auth.ts の取りこぼしなし）。

---

### 関連ファイル（想定）

- `lib/case-auth.ts`（新規・共通認可ヘルパー）
- `app/api/cases/[id]/verdict/route.ts`（認可追加・条件付き更新・try/catch）
- `app/api/cases/[id]/defense/route.ts`（resolveAuth を新ヘルパーへ移設・挙動不変）
- `lib/claude.ts`（`requestVerdict` の出力検証・content ガード・スコアクランプ）
- `tests/e2e/sec001-verdict-auth.spec.ts`（新規）
- `docs/knowledge/design.md`（**末尾に SEC-001/003 セクション追記**）

### 既存資産の再利用

- `defense/route.ts:resolveAuth`（getUser + 参加者 + verifyGuestToken）を土台に共通化。
- `createSessionClient` / `createAdminClient` / `isUuid` / `verifyGuestToken` / `resolveCaseAiKey`。
