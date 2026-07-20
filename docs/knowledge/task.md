# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。
>
> **重要 1（design.md 取り扱い）**: `docs/knowledge/design.md` は永続累積資料。既存設計を削除・短縮・全面書き換えしない。**末尾に新規セクション `## SEC-002 AI ルートのレート制限とケース単位生成上限` を純追記**する。
>
> **重要 2（実装体制）**: 標準フロー = リード（要件・設計レビュー・テスト・アドバサリアル・PR）→ アーキ（設計）→ ビルド（実装）→ リードがテスト＋アドバサリアル → **オーディ（独立セキュリティ監査・本タスクは必須）** → コパ。**お金（サービスキー課金）に直結するため、money-critical として原子性を厳守**する。
>
> **重要 3**: 「1 クレジット = 無制限 API コール」を塞ぐのが本タスクの目的。**「上限を付けたつもりで、並行・連続で抜ける」を防ぐ**。ケース単位の生成カウントは**原子的**に増やし、リードがアドバサリアル検証（テスト DB + REST 直叩きで上限超が弾かれ、並行でも抜けないこと）を実証する。

## 今回のタスク

Claude を呼ぶ AI ルートに**レート制限**を横断適用し、さらに**サービスキーモードのケースには生成回数のケース単位上限**を設ける。由来: 2026-07-07 全ディレクトリ・コードレビュー（`docs/backlog.md` の SEC-002）。

**バックログ ID**: SEC-002（HIGH）
**依存**: MON-001 PR-A/PR-B（`uses_service_key` / `resolveCaseAiKey` / `consume_credit` の原子的 RPC パターン）。

---

### 背景（実コードで裏取り済み）

- レート制限（`@upstash/ratelimit`）が入っているのは `app/api/users/search/route.ts` の **1 本のみ**（slidingWindow 30/分・`user.id` キー・429＋`X-RateLimit-*`/`Retry-After` ヘッダ）。**共通ヘルパー化されておらず直書き**。
- Claude を呼ぶ AI ルートは無制限:
  - `app/api/cases/[id]/defense/route.ts`（POST・弁護チャット。**1 ケース内で回数無制限**に `defense_messages` へ user→assistant を積む＝**AI 生成が青天井**）
  - `app/api/cases/[id]/defense/draft/route.ts`（下書き生成・**回数無制限**）
  - `app/api/cases/[id]/argument/route.ts`（意見。`max_rounds=3`＋延長で概ね有界だが AI 呼び出しは通る）
  - `app/api/cases/[id]/verdict/route.ts`（判決。SEC-001 で認可＋TOCTOU により**1 ケース 1 回**に確定済み）
  - `app/api/cases/[id]/end-proposal`・`extension-vote`（`phase=judging` 遷移時に閉廷宣告 judge メッセージを 1 回生成）
- MON-001 はクレジットを**ケース作成時に 1 回だけ**消費（`consume_credit`）。よって `uses_service_key=true` のケースで defense POST / draft を無制限に叩くと、**1 クレジット = 無制限のサービスキー Claude 呼び出し**になり、API 料金を賄う MON-001 の目的が崩れる。
- 保存モデル: `defense_messages(role in ('user','assistant'), content, case_id, created_at)`。AI 生成 = `role='assistant'`。draft は `defense_messages` に保存しない生成もある（要実装確認）。

---

### スコープ（IN / OUT）

**IN**:

1. **レート制限の共通化（濫用防止・第 1 層）**
   - `app/api/users/search/route.ts` の Upstash 実装を **`lib/ratelimit.ts`（新規）に切り出して共通化**。`users/search` も新ヘルパー経由に張り替え、**挙動不変**（30/分・user.id キー・同一ヘッダ）を担保。
   - `lib/ratelimit.ts` は「識別子（string）と窓・上限を受け取り、`{ success, limit, remaining, reset }` を返す」形＋「429 レスポンスを整形して返すユーティリティ（`X-RateLimit-*` / `Retry-After`）」を提供。用途別に**名前付きの limiter インスタンス**を持てるようにする（例: `aiRouteLimiter`、`searchLimiter`）。
   - **AI 呼び出しルート全て**（defense POST / defense/draft / argument / verdict / end-proposal / extension-vote のうち Claude を実際に呼ぶ経路）に**横断適用**。
     - **識別子キー**: 認証ユーザーは `user.id`。**ゲスト被告は `guest:{caseId}`**（ゲストは user.id を持たないため case 単位で代用）。`resolveCaseAuth` の戻りから userId/isGuest を判定して決める。
     - 上限（**確定値**・定数集約）: **AI ルート横断 = 20 リクエスト/分/識別子**。超過は **429**（`Retry-After` 付き）。
   - Upstash 未設定（`UPSTASH_*` env なし）でも**落ちない**フォールバック方針を design で決める（例: env 未設定時は rate-limit をスキップして通す。テスト DB / ローカルの扱いを明記）。

2. **ケース単位の生成上限（MON-001 の本丸・money-critical・第 2 層）**
   - `uses_service_key=true` のケースに対し、**弁護チャット/下書きの生成回数をケース単位で上限**。BYOK（`uses_service_key=false`）は当人負担なので**上限なし（第 1 層のレート制限のみ）**。
   - **DB（migration・冪等）**: `cases` に `service_ai_calls int not null default 0`（サービスキー AI 生成の累積回数）を追加。**原子的にインクリメント＋上限判定する RPC** を新設（`consume_credit` と同じ思想）:
     - 例: `consume_service_ai_call(p_case_id uuid, p_cap int) returns int`。`update cases set service_ai_calls = service_ai_calls + 1 where id=p_case_id and uses_service_key=true and service_ai_calls < p_cap returning service_ai_calls` 相当。**更新行 0（＝上限到達 or 非サービスキー）なら上限到達を表す値/例外**を返し、呼び出し側が Claude 呼び出し前に弾く。`consume_credit` 同様 **EXECUTE を service_role のみ**に絞る。schema.sql にも反映。
   - **適用ルート**: `defense`(POST) / `defense/draft` / `argument`（サービスキーで per-turn 生成する経路）。**Claude 呼び出しの直前**に `uses_service_key` の場合のみ `consume_service_ai_call` を呼び、上限到達なら **429（or 402/403 は design で確定）**を返して Claude を呼ばない。
     - `verdict` は 1 回確定済みなのでケース上限のカウント対象に含めるかは design で判断（含めても 1、除外でも可。二重課金防止は SEC-001 で担保済み）。
   - **上限値（確定）**: **service-key ケースあたり AI 生成 30 回**（弁護往復＋下書き合算）。定数に集約し後から調整可能に。
   - **失敗時補償**: `consume_service_ai_call` 成功後に Claude 呼び出しや保存が失敗した場合、カウントを戻すか（`refund` 相当）を design で判断（MON-001 の `refund_credit` と同じ論点。過大カウントでユーザーが損する vs 抜け穴。トレードオフを design.md に明記）。

3. **定数集約**: レート上限（20/分）・ケース上限（30/ケース）・窓を **1 ファイルに集約**（例 `lib/limits.ts`）。価格と同様「コード変更のみで調整可能」にする。

4. **E2E spec**（`tests/e2e/sec002-ratelimit.spec.ts` 新規）: 下記テスト観点。

**OUT（本 PR では扱わない）**:
- SEC-004（モデル ID 集約）→ 別 PR（任意）。
- サブスク/プラン別の閾値切替（MON の将来拡張）→ 設計に「キー種別で閾値を変える余地」を残すのみ。
- 既存のクレジット消費モデル（ケース作成時 1 消費）自体の変更はしない。

---

### 仕様（確定）

- **第 1 層（レート制限）**: 全 AI ルート、20 リクエスト/分/識別子（認証=user.id、ゲスト=`guest:{caseId}`）、超過 429＋`Retry-After`。
- **第 2 層（ケース上限）**: `uses_service_key=true` のみ、ケース累積 AI 生成 30 回、超過は Claude を呼ばず弾く。BYOK は上限なし。
- 原子性: ケース上限のカウントは**原子的 RPC**（並行・連続で抜けない）。`consume_credit` / SEC-001 TOCTOU と同じ思想。
- 既存 `resolveCaseAuth`（SEC-001 で新設）・`resolveCaseAiKey`・`isUuid` を流用。認可は各ルート既存のものを維持（本タスクで緩めない）。

---

### テスト観点（テスタ／リードのアドバサリアル）

E2E は `mon001-credits` / `sec001` の admin fast-path + 専用 ephemeral ユーザーパターンを踏襲。テスト DB 対象。`tests/e2e/sec002-ratelimit.spec.ts`:

1. **レート制限（第 1 層）**: 同一ユーザーで AI ルートを短時間に上限＋1 回叩く → **超過分が 429**（`Retry-After` ヘッダ有り）。窓内でのカウントが効くこと。
2. **ケース上限（第 2 層・service-key）**: `uses_service_key=true` のケースで defense 生成を上限（30）まで → **31 回目が弾かれ Claude を呼ばない**（`defense_messages` の assistant 行 / `service_ai_calls` が上限で頭打ち）。
3. **並行で抜けない（原子性）**: 上限直前のケースに **並行で複数 POST** → 上限を超えて生成されない（`service_ai_calls` が cap を超えない）。
4. **BYOK は上限なし**: `uses_service_key=false` のケースは第 2 層の上限に掛からない（第 1 層のみ）。
5. **Upstash 未設定フォールバック**: env 未設定時に 500 で全滅せず、design で決めた方針どおり動く。
6. 既存 spec（critical / mon001-credits / mon001b / sec001 / bug004-defense-tab / bug005）が**リグレッションしない**こと。特に defense/argument の正常系が上限内で従来どおり通ること。
- 後始末は case→user 順。`e2e_user_a` を汚染しない。TEST_MODE で Claude をモック（`generateDefenseResponse` 等の TEST_MODE 分岐の有無を確認、無ければ最小追加）。

**リードのアドバサリアル検証（必須）**: テスト DB に service-key ケースを作り、(a) 上限まで生成 → 上限超の REST 直叩きが弾かれ `defense_messages` が増えない、(b) **並行 POST で `service_ai_calls` が cap を超えない**、(c) `consume_service_ai_call` RPC の直叩きが 403（service_role のみ）を実証する。

---

### オーディに対する観点（本タスクは監査必須・money-critical）

- 第 2 層の原子性: `consume_service_ai_call` が並行・連続で cap を超えないか（TOCTOU なし）。Claude 呼び出しの**前**に消費し、上限到達なら呼ばないか。
- 補償方針: 生成失敗時のカウント戻し（or 戻さない）の判断が妥当か。過大カウントでユーザーが不当に損しないか / 抜け穴にならないか。
- 権限: `service_ai_calls` の UPDATE / `consume_service_ai_call` の EXECUTE が service_role のみに絞られているか（改ざん防止・MON-001 と同水準）。
- レート制限の識別子: ゲストキー `guest:{caseId}` が他ケースと混ざらないか。認証ユーザーのなりすまし不可か。
- フォールバック: Upstash 未設定時に「無制限に素通し」して money を垂れ流さないか（テスト環境と本番の差を design で明示）。
- BYOK と service-key の分岐が正しいか（BYOK に不要な上限を掛けていないか / service-key の抜けがないか）。
- 既存ルートの認可・挙動が回帰していないか。git status 最終確認（新規 spec / lib/ratelimit.ts / lib/limits.ts / migration の取りこぼしなし）。

---

### 関連ファイル（想定）

- `lib/ratelimit.ts`（新規・Upstash 共通ヘルパー＋429 整形）
- `lib/limits.ts`（新規・上限定数集約：AI 20/分、ケース 30/ケース、窓）
- `app/api/users/search/route.ts`（新ヘルパーへ移設・挙動不変）
- `app/api/cases/[id]/defense/route.ts`（レート制限＋service-key ケース上限）
- `app/api/cases/[id]/defense/draft/route.ts`（同上）
- `app/api/cases/[id]/argument/route.ts`（レート制限＋ケース上限）
- `app/api/cases/[id]/verdict/route.ts`（レート制限。ケース上限は判断）
- `app/api/cases/[id]/end-proposal/route.ts`・`extension-vote/route.ts`（Claude を呼ぶ経路にレート制限）
- `supabase/migrations/<timestamp>_sec002_service_ai_calls.sql`（新規・冪等。`cases.service_ai_calls` 列＋`consume_service_ai_call` RPC＋EXECUTE 権限）
- `supabase/schema.sql`（列・関数・権限を反映）
- `tests/e2e/sec002-ratelimit.spec.ts`（新規）
- `docs/knowledge/design.md`（**末尾に SEC-002 セクション追記**）

### 既存資産の再利用

- `users/search` の Upstash 実装（限界値・ヘッダ整形）。
- `consume_credit` / `refund_credit` の**原子的 RPC + EXECUTE を service_role 限定**パターン（MON-001 PR-A）。
- SEC-001 の `resolveCaseAuth`（userId / isGuest 判定）でレート制限キーを決める。
- `resolveCaseAiKey`（`uses_service_key` 判定）。
