-- Shelem: users + per-user game storage for Supabase.
-- Paste this whole file in Supabase -> SQL Editor -> Run. Safe to re-run.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_users (
    id uuid primary key default gen_random_uuid(),
    username text not null unique,
    pass_hash text not null,
    is_admin boolean not null default false,
    disabled boolean not null default false,
    created_at timestamptz not null default now()
);
create table if not exists public.app_sessions (
    token text primary key,
    user_id uuid not null references public.app_users(id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '90 days'
);
create table if not exists public.app_games (
    user_id uuid not null references public.app_users(id) on delete cascade,
    game_id text not null,
    data jsonb,
    updated_at bigint not null,
    deleted boolean not null default false,
    primary key (user_id, game_id)
);

-- Tables are private: RLS on with NO policies, and no direct grants. Only the functions below can touch them.
alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.app_games enable row level security;
revoke all on public.app_users, public.app_sessions, public.app_games from anon, authenticated;

-- ---------- internal helpers ----------
create or replace function public._app_uid(p_token text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
    select s.user_id into v from app_sessions s join app_users u on u.id = s.user_id
     where s.token = p_token and s.expires_at > now() and not u.disabled;
    if v is null then raise exception 'unauthorized'; end if;
    return v;
end $$;

create or replace function public._app_admin(p_token text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
    v := _app_uid(p_token);
    if not (select is_admin from app_users where id = v) then raise exception 'forbidden'; end if;
    return v;
end $$;

-- ---------- auth ----------
create or replace function public.app_login(p_username text, p_password text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare u app_users; t text;
begin
    select * into u from app_users where username = lower(trim(p_username));
    if u.id is null or u.disabled or u.pass_hash <> crypt(p_password, u.pass_hash) then
        perform pg_sleep(0.7);                       -- slow down guessing
        raise exception 'invalid_credentials';
    end if;
    t := encode(gen_random_bytes(32), 'hex');
    insert into app_sessions(token, user_id) values (t, u.id);
    delete from app_sessions where user_id = u.id and expires_at < now();
    return json_build_object('token', t, 'username', u.username, 'is_admin', u.is_admin);
end $$;

create or replace function public.app_me(p_token text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid; u app_users;
begin
    v := _app_uid(p_token);
    select * into u from app_users where id = v;
    return json_build_object('username', u.username, 'is_admin', u.is_admin);
end $$;

create or replace function public.app_logout(p_token text) returns void
language sql security definer set search_path = public, extensions as $$
    delete from app_sessions where token = p_token;
$$;

create or replace function public.app_change_password(p_token text, p_old text, p_new text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid; u app_users;
begin
    v := _app_uid(p_token);
    select * into u from app_users where id = v;
    if u.pass_hash <> crypt(p_old, u.pass_hash) then raise exception 'invalid_credentials'; end if;
    if length(p_new) < 6 then raise exception 'password_too_short'; end if;
    update app_users set pass_hash = crypt(p_new, gen_salt('bf')) where id = v;
end $$;

-- ---------- admin: user management ----------
create or replace function public.app_create_user(p_token text, p_username text, p_password text, p_is_admin boolean default false) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
    perform _app_admin(p_token);
    if length(trim(p_username)) < 3 then raise exception 'username_too_short'; end if;
    if length(p_password) < 6 then raise exception 'password_too_short'; end if;
    if exists (select 1 from app_users where username = lower(trim(p_username))) then raise exception 'username_taken'; end if;
    insert into app_users(username, pass_hash, is_admin)
    values (lower(trim(p_username)), crypt(p_password, gen_salt('bf')), coalesce(p_is_admin, false));
end $$;

create or replace function public.app_list_users(p_token text) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
    perform _app_admin(p_token);
    return (select coalesce(json_agg(json_build_object('username', username, 'is_admin', is_admin, 'disabled', disabled,
            'games', (select count(*) from app_games g where g.user_id = app_users.id and not g.deleted)) order by created_at), '[]'::json)
            from app_users);
end $$;

create or replace function public.app_admin_reset_password(p_token text, p_username text, p_new text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
    perform _app_admin(p_token);
    if length(p_new) < 6 then raise exception 'password_too_short'; end if;
    update app_users set pass_hash = crypt(p_new, gen_salt('bf')) where username = lower(trim(p_username));
    delete from app_sessions where user_id = (select id from app_users where username = lower(trim(p_username)));
end $$;

create or replace function public.app_set_disabled(p_token text, p_username text, p_disabled boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me uuid;
begin
    me := _app_admin(p_token);
    if (select id from app_users where username = lower(trim(p_username))) = me then raise exception 'cannot_disable_self'; end if;
    update app_users set disabled = p_disabled where username = lower(trim(p_username));
    if p_disabled then delete from app_sessions where user_id = (select id from app_users where username = lower(trim(p_username))); end if;
end $$;

-- ---------- games ----------
create or replace function public.app_list_games(p_token text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
    v := _app_uid(p_token);
    return (select coalesce(json_agg(json_build_object('game_id', game_id, 'data', data, 'updated_at', updated_at, 'deleted', deleted)), '[]'::json)
            from app_games where user_id = v);
end $$;

-- p_games: [{game_id, data, updated_at, deleted}]  (a row is only replaced by a NEWER updated_at)
create or replace function public.app_save_games(p_token text, p_games jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid; g jsonb;
begin
    v := _app_uid(p_token);
    for g in select * from jsonb_array_elements(p_games) loop
        insert into app_games(user_id, game_id, data, updated_at, deleted)
        values (v, g->>'game_id', case when (g->>'deleted')::boolean then null else g->'data' end,
                (g->>'updated_at')::bigint, coalesce((g->>'deleted')::boolean, false))
        on conflict (user_id, game_id) do update
           set data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted
         where app_games.updated_at < excluded.updated_at;
    end loop;
end $$;

-- ---------- bootstrap (SQL editor only, never callable from the app) ----------
create or replace function public.bootstrap_admin(p_username text, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
    insert into app_users(username, pass_hash, is_admin)
    values (lower(trim(p_username)), crypt(p_password, gen_salt('bf')), true)
    on conflict (username) do update set pass_hash = excluded.pass_hash, is_admin = true, disabled = false;
end $$;

-- ---------- permissions ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
    public.app_login(text, text), public.app_me(text), public.app_logout(text),
    public.app_change_password(text, text, text),
    public.app_create_user(text, text, text, boolean), public.app_list_users(text),
    public.app_admin_reset_password(text, text, text), public.app_set_disabled(text, text, boolean),
    public.app_list_games(text), public.app_save_games(text, jsonb)
to anon, authenticated;
