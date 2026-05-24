create table if not exists public.judge_messages (
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

grant select on public.judge_messages to anon;
grant select on public.judge_messages to authenticated;
grant all    on public.judge_messages to service_role;
