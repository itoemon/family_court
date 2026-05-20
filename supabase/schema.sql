-- =============================================
-- 家庭裁判所 DB スキーマ
-- Supabase SQL Editor で実行してください
-- =============================================

-- profiles: auth.users と 1対1 で紐付く
create table public.profiles (
  id            uuid references auth.users(id) on delete cascade primary key,
  display_name  text not null,
  api_key_encrypted text,           -- ユーザーの AI API キー（AES-256 暗号化済み）
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
                         check (phase in ('waiting','opening','argument','closing','judging','verdict')),
  current_turn         text not null default 'plaintiff'
                         check (current_turn in ('plaintiff','defendant')),
  round                int not null default 1,
  max_rounds           int not null default 3,
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

-- PostgREST ロールへの明示的な権限付与（Supabase SQL Editor 経由では自動付与されないため必須）
-- anon: 閲覧のみ（RLS でさらに絞る）
grant select on public.profiles  to anon;
grant select on public.cases     to anon;
grant select on public.arguments to anon;
grant select on public.verdicts  to anon;
-- authenticated: プロフィール更新のみ追加（他テーブルへの書き込みは API Route 経由で service_role が担う）
grant select, update on public.profiles  to authenticated;
grant select         on public.cases     to authenticated;
grant select         on public.arguments to authenticated;
grant select         on public.verdicts  to authenticated;
-- service_role: API Routes（createAdminClient）から使用するため全権
grant all on public.profiles  to service_role;
grant all on public.cases     to service_role;
grant all on public.arguments to service_role;
grant all on public.verdicts  to service_role;
