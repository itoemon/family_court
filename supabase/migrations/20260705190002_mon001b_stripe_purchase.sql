-- =============================================
-- MON-001 PR-B: Stripe クレジット購入（webhook 冪等性 + 記録・付与の原子的実行）
-- OPS-002 方針で冪等化。schema.sql（冷凍庫）と二重適用しても停止しない。
-- =============================================

-- 1. stripe_events: webhook 冪等性（二重付与防止）用の最小記録。id は Stripe の event.id。
--    RLS 有効・ポリシーなし = service_role のみ（guest_tokens と同方針）。
create table if not exists public.stripe_events (
  id         text primary key,
  type       text,
  created_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- ポリシーを CREATE しない = anon/authenticated はブロック。service_role は RLS/grant をバイパス。
grant all on table public.stripe_events to service_role;

-- 2. record_stripe_event_and_grant: イベント記録（冪等）とクレジット付与を
--    単一トランザクションで不可分に行う。決済成功 webhook から service_role で呼ぶ。
--    insert が unique_violation（既処理）なら 0 を返し付与しない。新規なら付与して amount を返す。
--    記録と付与が原子的なので「付与 commit 後の再送で二重付与」も「記録だけ残って付与漏れ」も
--    起きない（PR-A の consume/refund と同じ SECURITY DEFINER + service_role-only の堅牢化）。
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
  -- ここに到達 = 新規イベント。同一トランザクションで付与する。
  update public.profiles set credits = credits + p_amount where id = p_user_id;
  return p_amount;   -- 付与した数
exception when unique_violation then
  return 0;          -- 既処理（二重付与しない）
end;
$$;

revoke execute on function public.record_stripe_event_and_grant(text, text, uuid, integer)
  from public, anon, authenticated;
grant  execute on function public.record_stripe_event_and_grant(text, text, uuid, integer)
  to service_role;

-- 3. PostgREST スキーマキャッシュ再読込。
notify pgrst, 'reload schema';
