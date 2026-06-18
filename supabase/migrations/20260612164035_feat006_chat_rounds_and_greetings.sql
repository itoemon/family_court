-- =============================================
-- FEAT-006: チャット回数仕様の柔軟化と固定挨拶導入
-- 由来: docs/knowledge/task.md FEAT-006
-- 設計: docs/knowledge/design.md ## FEAT-006 対応
-- =============================================
-- 1) 旧データ全削除（cascade で arguments / verdicts / judge_messages も同時削除される）
-- 2) cases に新カラム追加（end_proposed_by, extension_vote_plaintiff, extension_vote_defendant）
-- 3) profiles に挨拶 2 カラム追加（opening_greeting, closing_greeting）
-- 4) arguments に is_greeting カラム追加
-- 5) cases.phase の check 制約に 'extension_voting' を追加
-- 後方互換ロジックなし。本タスクの最初のステップで全ケース削除を行う。

-- ============ 1. 旧データ削除 ============
-- arguments.case_id / verdicts.case_id / judge_messages.case_id はすべて
-- on delete cascade で定義済み (supabase/schema.sql) のため、
-- cases の全行削除で下流テーブルも掃ける。
delete from public.cases;

-- ============ 2. cases に新カラム追加 ============
-- end_proposed_by: 終了提案者のロール識別子。NULL=未提案。
--   ゲスト被告対応のため uuid ではなく text + check で値を絞る (design.md 参照)。
-- extension_vote_*: 延長投票の確定値。NULL=未投票。両者揃ったら集計後に NULL に戻す。
alter table public.cases
  add column if not exists end_proposed_by text null
    check (end_proposed_by is null or end_proposed_by in ('plaintiff','defendant','guest')),
  add column if not exists extension_vote_plaintiff text null
    check (extension_vote_plaintiff is null or extension_vote_plaintiff in ('continue','finish')),
  add column if not exists extension_vote_defendant text null
    check (extension_vote_defendant is null or extension_vote_defendant in ('continue','finish'));

-- ============ 3. profiles に挨拶カラム追加 ============
-- NULL=未設定 → サーバ側既定文 (lib/greetings.ts) を採用。
-- 空文字は check 制約と API バリデーションの二重で拒否。
alter table public.profiles
  add column if not exists opening_greeting text null
    check (opening_greeting is null or (char_length(opening_greeting) between 1 and 125)),
  add column if not exists closing_greeting text null
    check (closing_greeting is null or (char_length(closing_greeting) between 1 and 125));

-- ============ 4. arguments.is_greeting ============
-- 固定挨拶 row の識別。挨拶は round = 0 で INSERT、ラウンドカウントから除外。
alter table public.arguments
  add column if not exists is_greeting boolean not null default false;

-- ============ 5. cases.phase check 制約更新 ============
-- 'extension_voting' を追加。ENUM ではなく text + check のため DROP/ADD で安全に切替。
alter table public.cases drop constraint if exists cases_phase_check;
alter table public.cases add constraint cases_phase_check
  check (phase in ('waiting','opening','argument','closing','extension_voting','judging','verdict'));
