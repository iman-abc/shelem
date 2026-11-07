-- Run once in Supabase SQL Editor (after 01_schema.sql). Safe to re-run.
-- Lets an ADMIN list every user's (non-deleted) games, read-only.
create or replace function public.app_admin_list_games(p_token text) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
    perform _app_admin(p_token);
    return (select coalesce(json_agg(json_build_object(
                'owner', u.username, 'game_id', g.game_id, 'data', g.data, 'updated_at', g.updated_at)
                order by g.updated_at desc), '[]'::json)
            from app_games g join app_users u on u.id = g.user_id
            where not g.deleted and g.data is not null);
end $$;

revoke execute on function public.app_admin_list_games(text) from public;
grant execute on function public.app_admin_list_games(text) to anon, authenticated;
