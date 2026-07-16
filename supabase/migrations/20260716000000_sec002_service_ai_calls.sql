-- =============================================
-- SEC-002 第 2 層: サービスキーケースの生成回数上限（money-critical）
-- OPS-002 方針で冪等化。schema.sql（冷凍庫）と二重適用しても停止しない。
-- MON-001 の consume_credit / refund_credit と同思想の原子的 RPC + EXECUTE を
-- service_role 限定するパターンを踏襲する。
-- =============================================

-- 1. cases.service_ai_calls: サービスキーを用いた AI 生成の累積回数。
--    既存ケースは 0 でバックフィルされリグレッションしない。第 2 層の適用ルート
--    （defense POST / defense/draft / argument）でのみ加算される。
alter table public.cases
  add column if not exists service_ai_calls integer not null default 0;

-- 2. consume_service_ai_call(uuid, int): 原子的にインクリメントし上限判定する関数。
--    UPDATE ... WHERE service_ai_calls < p_cap RETURNING により、同時実行でも 1 行への
--    インクリメントは直列化され、並行・連続でも service_ai_calls が p_cap を超えない
--    （consume_credit の WHERE credits > 0 と同思想。TOCTOU の隙が無い）。
--    返り値: 成功時はインクリメント後の回数。更新行 0（＝上限到達 or 非サービスキー）なら
--    RETURNING が行を返さず NULL。呼び出し側は uses_service_key=true を確認済みのため
--    NULL = 上限到達と一意に解釈できる。WHERE uses_service_key=true は、万一 BYOK ケースで
--    誤って呼ばれてもカウントを増やさない安全弁である。
--    SECURITY DEFINER + search_path='' で堅牢化。public 配置だが anon/authenticated/PUBLIC
--    から EXECUTE を REVOKE し service_role にのみ GRANT する（RPC 非露出・改ざん防止）。
create or replace function public.consume_service_ai_call(p_case_id uuid, p_cap integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_calls integer;
begin
  update public.cases
     set service_ai_calls = service_ai_calls + 1
   where id = p_case_id
     and uses_service_key = true
     and service_ai_calls < p_cap
  returning service_ai_calls into v_calls;
  return v_calls;   -- 更新行 0（＝上限到達 or 非サービスキー）なら NULL
end;
$$;

revoke execute on function public.consume_service_ai_call(uuid, integer) from public, anon, authenticated;
grant  execute on function public.consume_service_ai_call(uuid, integer) to service_role;

-- 3. refund_service_ai_call(uuid): 生成失敗時の補償用に原子的に 1 減算する関数。
--    consume 後に Claude 生成または保存が失敗した際にカウントを戻す（refund_credit と同思想）。
--    WHERE service_ai_calls > 0 でカウントが負に落ちないよう保護し、read-then-write の
--    競合を避けるため SQL 式更新を service_role 専用 RPC に閉じる。
create or replace function public.refund_service_ai_call(p_case_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_calls integer;
begin
  update public.cases
     set service_ai_calls = service_ai_calls - 1
   where id = p_case_id
     and service_ai_calls > 0
  returning service_ai_calls into v_calls;
  return v_calls;
end;
$$;

revoke execute on function public.refund_service_ai_call(uuid) from public, anon, authenticated;
grant  execute on function public.refund_service_ai_call(uuid) to service_role;

-- 4. PostgREST スキーマキャッシュ再読込（新カラム・新 RPC の反映）。
notify pgrst, 'reload schema';
