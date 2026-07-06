-- =============================================
-- 家庭裁判所 DB スキーマ
-- Supabase SQL Editor で実行してください
-- =============================================

-- profiles: auth.users と 1対1 で紐付く
create table public.profiles (
  id            uuid references auth.users(id) on delete cascade primary key,
  display_name  text not null,
  api_key_encrypted text,           -- ユーザーの AI API キー（AES-256 暗号化済み）
  avatar_url    text,               -- アバター画像 URL（Supabase Storage）
  defense_custom_instruction text   -- 弁護人AIへのカスタム指示（最大200文字）
    check (defense_custom_instruction is null or char_length(defense_custom_instruction) <= 200),
  opening_greeting text             -- 開始時の固定挨拶（NULL=サーバ既定文を使用、1〜125文字）
    check (opening_greeting is null or (char_length(opening_greeting) between 1 and 125)),
  closing_greeting text             -- 終了時の固定挨拶（NULL=サーバ既定文を使用、1〜125文字）
    check (closing_greeting is null or (char_length(closing_greeting) between 1 and 125)),
  credits       integer not null default 3   -- MON-001: クレジット残高（無料お試し 3 個）
    constraint profiles_credits_non_negative check (credits >= 0),
  created_at    timestamptz default now() not null,
  updated_at    timestamptz default now() not null
);

alter table public.profiles enable row level security;

create policy "自分のプロフィールのみ参照可"
  on public.profiles for select
  using (auth.uid() = id);

create policy "自分のプロフィールのみ更新可"
  on public.profiles for update
  using (auth.uid() = id);

create policy "サインアップ時に自分のプロフィールを作成可"
  on public.profiles for insert
  with check (auth.uid() = id);

-- サインアップ時に自動でプロフィールを作成するトリガー
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- cases: 話し合いのケース
create table public.cases (
  id                   uuid default gen_random_uuid() primary key,
  topic                text not null,
  plaintiff_id         uuid references public.profiles(id) not null,  -- 提案者（要認証）
  defendant_id         uuid references public.profiles(id),           -- 反対者（認証済みの場合）
  defendant_guest_name text,                                          -- 反対者（ゲストの場合）
  phase                text not null default 'waiting'
                         check (phase in ('waiting','opening','argument','closing','extension_voting','judging','verdict')),
  current_turn         text not null default 'plaintiff'
                         check (current_turn in ('plaintiff','defendant')),
  round                int not null default 1,
  max_rounds           int not null default 3,
  -- 終了提案者のロール（NULL=未提案）。ゲスト被告対応のため uuid ではなく text + check で表現。
  end_proposed_by      text
                         check (end_proposed_by is null or end_proposed_by in ('plaintiff','defendant','guest')),
  -- 延長投票の確定値（NULL=未投票）。両者揃ったら集計後 NULL に戻して次の延長サイクルへ。
  extension_vote_plaintiff text
                         check (extension_vote_plaintiff is null or extension_vote_plaintiff in ('continue','finish')),
  extension_vote_defendant text
                         check (extension_vote_defendant is null or extension_vote_defendant in ('continue','finish')),
  -- MON-001: このケースの AI 実行にサービスキーを使うか（作成時に確定）。
  uses_service_key     boolean not null default false,
  created_at           timestamptz default now() not null,
  updated_at           timestamptz default now() not null,
  -- 被告は「認証済みアカウント」か「ゲスト名」のどちらか一方のみ
  constraint defendant_exclusive check (
    not (defendant_id is not null and defendant_guest_name is not null)
  )
);

alter table public.cases enable row level security;

-- 共有リンク経由でアクセスするため誰でも読める
create policy "誰でもケースを参照可"
  on public.cases for select
  using (true);

-- ケース作成は認証済みユーザーのみ（自分が原告）
create policy "認証済みユーザーがケースを作成可"
  on public.cases for insert
  with check (auth.uid() = plaintiff_id);

-- arguments: 各ターンの発言
create table public.arguments (
  id        uuid default gen_random_uuid() primary key,
  case_id   uuid references public.cases(id) on delete cascade not null,
  role      text not null check (role in ('plaintiff','defendant')),
  phase     text not null,
  round     int not null,
  content   text not null,
  -- 固定挨拶 row を識別。true の場合 round=0 で INSERT し、ラウンドカウントから除外される。
  is_greeting boolean not null default false,
  created_at timestamptz default now() not null
);

alter table public.arguments enable row level security;

create policy "誰でも発言を参照可"
  on public.arguments for select
  using (true);

-- verdicts: AI 裁判官の判決
create table public.verdicts (
  id               uuid default gen_random_uuid() primary key,
  case_id          uuid references public.cases(id) on delete cascade not null unique,
  winner           text not null check (winner in ('plaintiff','defendant','draw')),
  summary          text not null,
  reasoning        text not null,
  plaintiff_score  int not null check (plaintiff_score between 0 and 100),
  defendant_score  int not null check (defendant_score between 0 and 100),
  created_at       timestamptz default now() not null
);

alter table public.verdicts enable row level security;

create policy "誰でも判決を参照可"
  on public.verdicts for select
  using (true);

-- judge_messages: 裁判官 AI によるコメント
create table public.judge_messages (
  id           uuid default gen_random_uuid() primary key,
  case_id      uuid references public.cases(id) on delete cascade not null,
  content      text not null,
  trigger_type text not null check (trigger_type in ('opening', 'turn', 'closing')),
  created_at   timestamptz default now() not null
);

alter table public.judge_messages enable row level security;

create policy "誰でも裁判官メッセージを参照可"
  on public.judge_messages for select
  using (true);

-- PostgREST ロールへの明示的な権限付与（Supabase SQL Editor 経由では自動付与されないため必須）
-- anon: 閲覧のみ（RLS でさらに絞る）
grant select on public.profiles  to anon;
grant select on public.cases     to anon;
grant select on public.arguments to anon;
grant select on public.verdicts  to anon;
-- authenticated: 参照のみ（書き込みは API Route 経由で service_role が担う）。
-- MON-001: profiles の直接 UPDATE 権限は付与しない（credits / api_key_encrypted の
-- クライアント改ざんを防ぐ多層防御。正当な更新は createAdminClient()/service_role 経由）。
grant select         on public.profiles  to authenticated;
grant select         on public.cases     to authenticated;
grant select         on public.arguments to authenticated;
grant select         on public.verdicts  to authenticated;
-- service_role: API Routes（createAdminClient）から使用するため全権
grant all on public.profiles  to service_role;
grant all on public.cases     to service_role;
grant all on public.arguments to service_role;
grant all on public.verdicts  to service_role;
grant select on public.judge_messages to anon;
grant select on public.judge_messages to authenticated;
grant all    on public.judge_messages to service_role;

-- MON-001: クレジットを原子的に 1 減算する関数。
-- UPDATE ... WHERE credits > 0 RETURNING により同時実行でも二重消費・マイナス残高が
-- 起きない。減算できなければ NULL（消費失敗＝残高 0）を返す。
-- public 配置だが anon/authenticated/PUBLIC から EXECUTE を REVOKE し service_role にのみ
-- GRANT することで、admin(service_role) からのみ呼べる（RPC 非露出）。
create or replace function public.consume_credit(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining integer;
begin
  update public.profiles
     set credits = credits - 1
   where id = p_user_id
     and credits > 0
  returning credits into v_remaining;
  return v_remaining;
end;
$$;

revoke execute on function public.consume_credit(uuid) from public, anon, authenticated;
grant  execute on function public.consume_credit(uuid) to service_role;

-- MON-001: クレジットを原子的に 1 加算する関数（消費後にケース INSERT が失敗した際の
-- 補償用）。SELECT→+1 の read-then-write は並行更新で上書き競合を起こすため、
-- credits = credits + 1 の SQL 式更新をサーバ専用 RPC に閉じる。
create or replace function public.refund_credit(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining integer;
begin
  update public.profiles
     set credits = credits + 1
   where id = p_user_id
  returning credits into v_remaining;
  return v_remaining;
end;
$$;

revoke execute on function public.refund_credit(uuid) from public, anon, authenticated;
grant  execute on function public.refund_credit(uuid) to service_role;

-- MON-001 PR-B: Stripe webhook 冪等性（二重付与防止）用の記録テーブル。
-- RLS 有効・ポリシーなし = service_role のみ（guest_tokens と同方針）。
create table if not exists public.stripe_events (
  id         text primary key,
  type       text,
  created_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

grant all on table public.stripe_events to service_role;

-- MON-001 PR-B: Stripe 決済成功イベントの記録（冪等）とクレジット付与を単一トランザクションで
-- 原子的に行う。webhook から service_role で呼ぶ。unique_violation（既処理）なら 0 を返し付与しない。
-- 記録と付与が不可分なので二重付与も付与漏れも起きない。EXECUTE を REVOKE し service_role のみ GRANT。
create or replace function public.record_stripe_event_and_grant(
  p_event_id text,
  p_type text,
  p_user_id uuid,
  p_amount integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'record_stripe_event_and_grant: p_amount must be a positive integer (got %)', p_amount;
  end if;
  insert into public.stripe_events (id, type) values (p_event_id, p_type);
  update public.profiles set credits = credits + p_amount where id = p_user_id;
  return p_amount;
exception when unique_violation then
  return 0;
end;
$$;

revoke execute on function public.record_stripe_event_and_grant(text, text, uuid, integer)
  from public, anon, authenticated;
grant  execute on function public.record_stripe_event_and_grant(text, text, uuid, integer)
  to service_role;
