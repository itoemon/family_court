# バックログ

プロダクトの未対応タスクを蓄積するファイルである。
オーディの監査指摘・ダイチの機能要望・改善案をまとめて管理する。
リードがセッション開始時・PR マージ後にダイチへ内容を共有する。
アーキは次の設計時にここを参照し、関連する指摘を設計に反映すること。

由来表記は監査レポートへの相対パスを記載する（複数の監査レポートで同じ ID が出るため、`(由来 …)` と組み合わせて項目を一意に識別する）。

---

## 未対応

### 機能（FEAT）

#### [FEAT-004] 法案 Hub（公開・インポート機能）

- **内容**:
  - 他ユーザーが作った法律を閲覧できる公開 Hub を設ける
  - オーナーは自分の法律を Hub に公開できる
  - 他ユーザーは公開法案を「自分がオーナーの新しい法律」としてインポートでき、自分のフレンド間で利用できる
- **優先度**: 低（FEAT-003 完成後）
- **依存**: FEAT-003, FEAT-002

---

#### [FEAT-005] マイページ（フレンド・過去のケース・プロフィール統合ハブ）

- **内容**:
  - ログインユーザーが自身のプロフィール・フレンド一覧・過去のケース（必要に応じて参加中の法律）を一画面で参照できるマイページを実装する
  - SNS のプロフィールページのような体裁を想定（アバター・表示名・カスタム指示等の頭部 + タブまたはセクション分割でフレンド/履歴を一覧）
  - 既存の `/profile`・`/friends`・`/history` の各専用ページとの役割分担を整理する（マイページに集約してリダイレクトするか、専用ページを維持してマイページから導線を張るかは設計時に決定）
- **優先度**: 中（既存機能の統合導線として価値が高い）
- **依存**: FEAT-002（プロフィール・フレンド）, FEAT-003（法律＝過去のケース相当の参照導線）
- **由来**: 2026-06-02 ダイチ提案

---

#### [FEAT-RESP-HEADER] ヘッダーのレスポンシブ対応（スマホ最適化）

- **内容**:
  - `app/components/Header.tsx` のスマホ表示時のレイアウト崩れを解消する
  - 現状: 認証時に「過去のケース / フレンド / プロフィール / ログアウト」を `flex gap-4` の横並びで配置しているため、スマホ幅（375–390px）でロゴと干渉する
  - スコープは Header 単独。他ページのレスポンシブ調整は実機検証で別途判断
  - 設計方針（パターン・breakpoint・既存 stone/brand トーンとの整合）はアーキ段階で詰める
- **優先度**: 中（実害がある UI 不具合）
- **由来**: 2026-06-02 ダイチ提案

---

### 運用・テスト基盤（OPS）

#### [OPS-001] E2E 実行基盤の運用見直し

- **背景**: パイプラインのテスタ段階で E2E（Playwright）を回す前提が、本環境（Ubuntu）で課題を抱えていた。

- **Part 1（node 実行基盤）: 解決済み ✅**（2026-05-29）
  - 課題: Next.js 16 は node ≥ 20.9.0 必須だが、`claude -p` で起動するパイプライン各エージェントは volta-node18（claude の pin）を継承し直すため、テスタ内の `npm run dev` が node18 で起動失敗していた。さらに Playwright ブラウザ（chromium）が未導入だった。
  - 対応:
    - `package.json` に `volta.node = 20.20.2` を pin（PR #27 で同梱済み）。
    - `scripts/agents.sh` の `run_tester` が dev サーバーを**自前で node20 環境で起動/停止**するよう変更（PATH から node18 実体を除去し `_VOLTA_TOOL_RECURSION` を解除して volta シムに project pin を解決させる）。停止はポート 3000 のリスナーから実 PGID を特定してグループごと kill。テスタは playwright 実行のみ担当（ランナーは node18 で可）。
    - `docs/agents/tester.md` から dev サーバーの起動/停止指示を除去し「agents.sh が起動済み・確認のみ」に変更。
    - `run_tester` に Playwright chromium の自動導入ガードを追加（初回のみ）。
    - 判定ロジックを修正: 「実施不可」も不合格扱いにし、環境不備による未実施を誤って通過扱いにしない。
  - 検証: 読み取り専用テスト（VISUAL-BRAND-001）を node20 サーバー + node18 playwright + chromium で実行し、chain が end-to-end で動作することを確認済み。
  - **追記 (PR #30 / 2026-06-02)**: 2026-05-30 の claude CLI ネイティブ版移行（node 非依存、`~/.local/bin/claude`）により、claude → 子プロセスへの node18 強制（`_VOLTA_TOOL_RECURSION` 経由）が消滅した。これに伴い PR #30 で `package.json` の `volta.node` pin を撤去し、要件は `engines.node: ">=20.9.0"` で表明する形へ切り替えた。`scripts/agents.sh` の PATH サニタイズおよび `_VOLTA_TOOL_RECURSION` 解除処理も併せて撤去し、`start_dev_server` は素の `setsid bash -c "npm run dev"` に簡素化した。停止側の PGID 特定ロジックおよびテスタの判定ロジックは本筋なので残置している。

- **Part 2（E2E のターゲット DB）: 未対応**
  - 現状 `.env.local` が**本番 Supabase** を指しており、laws/friends 系 spec が本番にテストデータを作りうる。テスト用 Supabase プロジェクト + `.env.test`、またはシード&クリーンアップ戦略の検討が必要。
  - 暫定運用: 当面は従来どおり本番ターゲット（または読み取り系のみリードが手動検証）。
- **優先度**: 中（Part 1 完了によりパイプラインで E2E が回せるようになった。残るは Part 2）
- **由来**: 2026-05-29 LOW バッチ対応時に顕在化

---

### 監査由来の品質改善

（現在、未対応の監査由来 LOW はない。過去の指摘は「対応済み」セクション参照。）

---

### マネタイズ（MON）

#### [MON-001] クレジット制課金（1 クレジット = 1 ケース）

- **内容**:
  - ケース作成時にクレジットを 1 消費する課金モデル
  - BYOK（自分の API キーを持ち込む）ユーザーは無料
  - サブスクリプションプランも将来的に追加したい（月額でクレジット付与）
  - 目的: サービス側が負担する API 料金を賄う
- **優先度**: 中（ユーザーが増えてきたタイミングで実装）
- **備考**: Stripe 等の決済基盤が必要。BYOK 判定ロジックは既存の `validateApiKey` を流用できる。

---

#### [MON-002] 広告表示

- **内容**: ユーザー体験を阻害しない範囲での広告を表示する（Google AdSense 等を想定）
- **目的**: サーバー代（Vercel・Supabase）を賄う
- **優先度**: 低
- **備考**: 課金ユーザー（MON-001）には広告を非表示にするのが理想。

---

## 対応済み

| PR | 内容 |
|----|------|
| PR #12       | middleware の保護パス整備・Suspense 境界・logout エラー処理 |
| PR #13 (B-1) | `defendantId`（被告 UUID）を認証なし API レスポンスから除去 |
| PR #13 (B-2) | ログアウト失敗時のフラッシュ Cookie + ErrorBanner 実装 |
| PR #14 (C-1) | `verifyGuestToken` try-catch 保護（argument / defense / draft の 3 ファイル） |
| PR #14 (C-2) | `GUEST_TOKEN_SECRET` 未設定時のフェイルファスト（lib/guest-token.ts） |
| PR #14 (C-3) | プロンプトインジェクション対策（escapeXml + truncate(50)） |
| PR #14 (C-4) | profiles 重複クエリ削減・contradiction_warnings に .limit(100) |
| PR #14 (D-1) | `defense.ts` dialogHistory.content に truncate 適用・text-utils.ts に切り出し |
| PR #14 (D-2) | `defense/route.ts` 認証ユーザーパスを try-catch で保護 |
| PR #14 (D-3) | `clear-flash` Cookie 削除に httpOnly: true（確認済み） |
| PR #14 (D-4) | A-2 テスト env チェック（確認済み） |
| PR #14 (D-5) | `judge_messages` 空文字列挿入ガード × 3 箇所 |
| PR #14 (D-6) | ゲスト名 DB バリデーション 50 文字（確認済み） |
| PR #15 (E-1) | `defense.ts` generateDraft の defenseHistory に truncate 適用 |
| PR #15 (E-2) | `route.ts` PATCH 非 asGuest パスを try-catch で保護 |
| PR #15 (E-3) | `layout.tsx` `<main>` → `<div>`（確認済み・実装済み） |
| PR #15 (E-4) | `validateApiKey` エラー種別区別（AuthenticationError のみ false） |
| PR #15 (E-5) | `history/page.tsx` Supabase エラーログ（確認済み・実装済み） |
| PR #15 (E-6) | `middleware.ts` 保護パスをプレフィックスマッチに変更 |
| PR #16 (F-1) | HMAC ゲストトークンを nonce ベースに刷新（guest_tokens テーブル追加） |
| PR #17 (FEAT-001) | igiari リネーム（UI・メタデータ・README・package.json） |
| PR #17 (IMP-002)  | デザイン色調統一（brand-* パレット定義・indigo/rose → brand 置換） |
| PR #17 (コパ指摘) | 無効 ESLint ルール名削除・フッター著作権年を動的生成に変更 |
| PR #18 (LOW-001)  | `defense/draft/route.ts` の `createSessionClient()` を try-catch で保護 |
| PR #18 (LOW-002)  | `guest_tokens.token_hash` に UNIQUE INDEX 追加（migration） |
| PR #18 (MEDIUM-001) | プライマリボタンを brand-700/800 に変更（WCAG AA コントラスト対応） |
| PR #18 (IMP-001)  | 自動スクロールをメッセージ存在時のみ発火するよう修正 |
| PR #19 (FEAT-002 P1) | プロフィールアイコン設定・弁護人 AI カスタム指示 |
| PR #19 (MEDIUM-001) | avatars バケットに file_size_limit・allowed_mime_types を設定 |
| PR #19 (LOW-001) | avatar アップロード時の magic bytes 検証を実装（Content-Type 偽装対策） |
| PR #19 (LOW-002) | `defenseCustomInstruction` の型検証を追加（typeof !== "string" チェック） |
| PR #20 (FEAT-002 P2) | フレンド機能（リクエスト送信・承認/拒否・一覧・削除） |
| PR #20 (LOW-001) | `friend_requests` への `anon` GRANT を最初から付与せず最小権限を確立（由来: `docs/knowledge/archive/audit-log/audit_20260526_142833.md`） |
| PR #20 (LOW-002) | `POST /api/friends/requests` で FK 違反 (23503) を 400 で個別ハンドル（由来: `docs/knowledge/archive/audit-log/audit_20260526_142833.md`） |
| PR #21 (MEDIUM-001) | `/api/users/search` に Upstash Redis レートリミットを実装 |
| PR #22 (FEAT-003) | 法律作成機能（作成・招待・投票・退会・改定・所有権移譲） |
| PR #23 (BUG-001) | サインアップ時の確認メール未着を修正（Gmail SMTP・emailRedirectTo の明示化） |
| PR #24 (chore) | トークン消費の可視化（statusline.py・token_report.py）とログローテーション機構（rotate_logs.sh） |
| PR #25 (chore) | backlog の完了項目整理・由来重複の掃除 |
| PR #26 (MEDIUM-001) | Server Component の `law_*` 読み取りを `createAdminClient()` → `createSessionClient()`（RLS 二重防御）に切替・`laws` SELECT ポリシーを invitee 本人まで拡張（由来: `docs/knowledge/archive/audit-log/audit_20260526_200752.md`） |
| PR #27 (LOW-001) | API 動的セグメントの UUID バリデーション追加（全 15 ルート）・`UUID_REGEX` を `lib/text-utils.ts` に共通化（由来: `docs/knowledge/archive/audit-log/audit_20260526_200752.md`） |
| PR #27 (LOW-002) | `PendingInvitations.tsx` の fetch ステータス検査・失敗時エラー表示とリフレッシュ抑止（由来: `docs/knowledge/archive/audit-log/audit_20260526_200752.md`） |
| PR #31 (FEAT-RESP-HEADER) | ヘッダーをアバター起点のドロップダウンメニュー方式へ刷新（全画面サイズ統一、breakpoint 不使用）|
| PR #32 (FEAT-005) | マイページ `/me` を新設（プロフィール / フレンド / 過去のケース / 参加中の法律 のダイジェスト、ヘッダー導線に「マイページ」追加）|
| 本 PR (LOW-001) | `package.json` の `name` フィールド変更経緯を README に明示（PR #17 で `family_court` → `igiari` にリネーム済みの追跡性を回復、由来: `docs/knowledge/audit-log/audit_20260526_152517.md`） |
| 本 PR (LOW-002) | `@upstash/core-analytics` の外部送信不可検証（`analytics: false` 設定時に Analytics クラス未インスタンス化 + `if (this.analytics)` ガードで record/ingest 実行経路なし、本番ビルドのバンドル含有はコードのみで動作経路なし、由来: `docs/knowledge/audit-log/audit_20260526_152517.md`） |
