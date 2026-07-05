-- =============================================
-- MON-001 PR-A: クレジット基盤（消費・サービスキー・無料付与）
-- OPS-002 方針で冪等化。schema.sql（冷凍庫）と二重適用しても停止しない。
-- =============================================

-- 1. profiles.credits: 無料お試し 3 個をカラム default で付与。
--    既存行は default 3 でバックフィル（既存ユーザーへの一度きり無料付与として許容）。
alter table public.profiles
  add column if not exists credits integer not null default 3;

-- 非負制約（冪等: 既存なら握りつぶす）。原子的減算の WHERE credits > 0 と二重で
-- マイナス残高を防ぐ。
do $$
begin
  alter table public.profiles
    add constraint profiles_credits_non_negative check (credits >= 0);
exception when duplicate_object then null;
end $$;

-- 2. cases.uses_service_key: このケースの AI 実行にサービスキーを使うかを作成時に確定。
--    既存ケースは false（BYOK 前提の従来挙動）でバックフィル。
alter table public.cases
  add column if not exists uses_service_key boolean not null default false;

-- 3. consume_credit(uuid): 原子的に 1 減算する関数。
--    UPDATE ... WHERE credits > 0 RETURNING により同時実行でも二重消費・マイナス残高が
--    起きない。減算できなければ RETURNING が行を返さず NULL（消費失敗＝残高 0）を返す。
--    SECURITY DEFINER + search_path='' で堅牢化（FEAT-004 定石）。
--    配置は public（PostgREST の /rest/v1/rpc/* は public スキーマの関数のみ露出）だが、
--    anon/authenticated/PUBLIC から EXECUTE を REVOKE し service_role にのみ GRANT する
--    ことで、一般認証ユーザーは RPC を叩けず、admin(service_role) からのみ呼べる状態にする。
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
  return v_remaining;   -- 減算できなければ NULL（更新行なし）
end;
$$;

revoke execute on function public.consume_credit(uuid) from public, anon, authenticated;
grant  execute on function public.consume_credit(uuid) to service_role;

-- 3b. refund_credit(uuid): 消費後のケース INSERT 失敗時の補償用に原子的 +1 加算する関数。
--    アプリ側の SELECT→+1→UPDATE（read-then-write）は並行更新で上書き競合を起こすため、
--    credits = credits + 1 の SQL 式更新をサーバ専用 RPC に閉じる。EXECUTE も service_role のみ。
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

-- 4. クレジット改ざん防止: authenticated / anon から profiles のテーブル UPDATE 権限を
--    REVOKE する。正当なプロフィール更新は全て createAdminClient()(service_role) 経由
--    (app/api/profile/route.ts) で行われるため authenticated の直接 UPDATE は本来不要。
--    これで credits だけでなく api_key_encrypted 等の直接改ざん面も一括で塞ぐ（多層防御）。
--    self-update ポリシーは残す（GRANT と RLS は AND 評価。GRANT を外せば UPDATE は通らない）。
revoke update on table public.profiles from authenticated, anon;

-- 5. PostgREST スキーマキャッシュ再読込（新カラムの column does not exist 対策）。
notify pgrst, 'reload schema';
