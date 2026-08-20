-- ===========================================================================
-- 001 — Hand history
--
-- Run this in the Supabase SQL editor. It is idempotent: every statement is
-- IF NOT EXISTS / OR REPLACE, so re-running it is safe.
--
-- What lives here
--   hands         one row per completed hand
--   hand_players  one row per player dealt into that hand, incl. hole cards
--   hand_actions  every action in order, enough to replay the hand exactly
--   table_seats   who is sitting where, and behind how much
--
-- Who may touch it
--   The game server writes, using the service-role key, through record_hand()
--   below. Nothing else writes — not the browser, not the Next.js app.
--   A signed-in player may read their OWN rows and nothing else. That last
--   part is the point of the file: hole_cards are in here, and a hand a user
--   did not play must never be readable by them, or the history becomes a
--   window into everyone else's cards after the fact.
--
-- A note on identity
--   This app signs its own `ps_token` (see src/lib/auth.ts); it does not use
--   Supabase Auth. Until a request carries a Supabase-signed JWT for the
--   player, app_user_id() below returns NULL and the SELECT policies match
--   nothing — the tables are simply unreadable through PostgREST. That is the
--   safe direction to be wrong in, and the policies are already correct for
--   when those tokens exist.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.hands (
  id          uuid primary key default gen_random_uuid(),
  table_id    text        not null,
  variant     text        not null,
  hand_number bigint      not null,
  started_at  timestamptz not null,
  ended_at    timestamptz not null default now(),
  board       jsonb       not null default '[]'::jsonb,
  pots        jsonb       not null default '[]'::jsonb,
  rake        int         not null default 0
);

-- "The last N hands at this table", the only way this is ever read in bulk.
create index if not exists idx_hands_table_ended
  on public.hands (table_id, ended_at desc);

create table if not exists public.hand_players (
  hand_id        uuid   not null references public.hands (id) on delete cascade,
  -- No FK to users: hand history outlives an account, and the id arrives from
  -- the session token rather than from a join.
  user_id        bigint not null,
  seat           int    not null,
  -- BTN / SB / BB / UTG / MP / CO …
  position       text,
  -- SECRET. Readable only by the player who held them (see the policy below).
  hole_cards     jsonb  not null default '[]'::jsonb,
  starting_stack int    not null,
  -- Chips this player put in the pot across the whole hand.
  committed      int    not null default 0,
  -- What the hand did to their stack: won minus committed. Negative is a loss.
  net            int    not null default 0,
  -- 'WON' | 'LOST' | 'FOLDED'
  result         text,
  -- e.g. "Full House", when the hand was shown down.
  hand_name      text,
  primary key (hand_id, user_id)
);

create index if not exists idx_hand_players_user
  on public.hand_players (user_id);

create table if not exists public.hand_actions (
  hand_id uuid   not null references public.hands (id) on delete cascade,
  -- Position in the hand, from 0. The replay order, and half the primary key.
  seq     int    not null,
  -- Null for events the table did rather than a player: DEAL, STREET, PAYOUT.
  user_id bigint,
  street  text   not null,
  action  text   not null,
  amount  int    not null default 0,
  at      timestamptz not null default now(),
  primary key (hand_id, seq)
);

create table if not exists public.table_seats (
  table_id   text   not null,
  user_id    bigint not null,
  seat       int    not null,
  stack      int    not null,
  updated_at timestamptz not null default now(),
  primary key (table_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Identity for the read policies
-- ---------------------------------------------------------------------------

-- The caller's app user id, or NULL when the request carries no usable JWT.
--
-- NULL is the important case: every policy below compares against it, and
-- `user_id = NULL` is never true, so an unauthenticated (or foreign-token)
-- request reads nothing at all rather than everything.
create or replace function public.app_user_id()
returns bigint
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select case
           when coalesce(auth.jwt() ->> 'user_id', auth.jwt() ->> 'sub') ~ '^[0-9]+$'
           then (coalesce(auth.jwt() ->> 'user_id', auth.jwt() ->> 'sub'))::bigint
         end
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- RLS decides which rows; the GRANTs below decide which verbs. Both are set,
-- because either one alone is a single point of failure: a policy added later
-- by mistake cannot grant a write that was never granted, and a grant restored
-- by mistake still hits a table with no write policy.
-- ---------------------------------------------------------------------------

alter table public.hands        enable row level security;
alter table public.hand_players enable row level security;
alter table public.hand_actions enable row level security;
alter table public.table_seats  enable row level security;

-- Applies the policies to the table owner as well, so nothing reads past them
-- just by virtue of having created the table. Roles with BYPASSRLS — which is
-- what service_role is for — are unaffected, and that is the one path the
-- game server uses.
alter table public.hands        force row level security;
alter table public.hand_players force row level security;
alter table public.hand_actions force row level security;
alter table public.table_seats  force row level security;

revoke insert, update, delete, truncate
  on public.hands, public.hand_players, public.hand_actions, public.table_seats
  from anon, authenticated;

grant select
  on public.hands, public.hand_players, public.hand_actions, public.table_seats
  to authenticated;

-- Supabase grants these by default; stated anyway so the write path does not
-- depend on a default staying put.
grant select, insert, update, delete
  on public.hands, public.hand_players, public.hand_actions, public.table_seats
  to service_role;

-- A hand is "yours" if you were dealt into it. Note this reads hand_players,
-- which is itself behind the policy below — so the inner lookup can only ever
-- see the caller's own seat in that hand.
drop policy if exists hands_select_own on public.hands;
create policy hands_select_own on public.hands
  for select to authenticated
  using (
    exists (
      select 1
      from public.hand_players hp
      where hp.hand_id = hands.id
        and hp.user_id = public.app_user_id()
    )
  );

-- The one that matters: your row carries your hole cards, and there is no
-- readable path to anyone else's.
drop policy if exists hand_players_select_own on public.hand_players;
create policy hand_players_select_own on public.hand_players
  for select to authenticated
  using (user_id = public.app_user_id());

-- Deliberately your own actions only, not every action in a hand you played.
-- Widen this to the `exists (…hand_players…)` form above if a client ever
-- needs to replay a hand itself; it leaks nothing that was not already public
-- at the table, but it is not needed yet, and this is the tighter default.
drop policy if exists hand_actions_select_own on public.hand_actions;
create policy hand_actions_select_own on public.hand_actions
  for select to authenticated
  using (user_id = public.app_user_id());

drop policy if exists table_seats_select_own on public.table_seats;
create policy table_seats_select_own on public.table_seats
  for select to authenticated
  using (user_id = public.app_user_id());

-- No INSERT, UPDATE or DELETE policy exists on any of these tables, on
-- purpose. Do not add one: writes belong to the game server alone.

-- ---------------------------------------------------------------------------
-- The write path
--
-- One hand, one call, one transaction. A function rather than four inserts
-- because PostgREST cannot span requests in a transaction, and a half-written
-- hand — say the hands row without its actions — is worse than no hand at all:
-- it looks complete to every reader that comes after.
--
-- `security invoker`, deliberately, not `definer`: the caller is service_role,
-- which bypasses RLS on its own, so the function needs no authority of its
-- own. A `definer` version would carry the owner's rights permanently, and one
-- stray EXECUTE grant would then hand the browser the write path every policy
-- above exists to deny.
-- ---------------------------------------------------------------------------

create or replace function public.record_hand(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_hand_id uuid := coalesce((payload ->> 'id')::uuid, gen_random_uuid());
begin
  insert into public.hands (
    id, table_id, variant, hand_number, started_at, ended_at, board, pots, rake
  )
  values (
    v_hand_id,
    payload ->> 'table_id',
    payload ->> 'variant',
    (payload ->> 'hand_number')::bigint,
    (payload ->> 'started_at')::timestamptz,
    coalesce((payload ->> 'ended_at')::timestamptz, now()),
    coalesce(payload -> 'board', '[]'::jsonb),
    coalesce(payload -> 'pots', '[]'::jsonb),
    coalesce((payload ->> 'rake')::int, 0)
  )
  -- Retrying a write the server was unsure about must not duplicate a hand.
  on conflict (id) do nothing;

  insert into public.hand_players (
    hand_id, user_id, seat, position, hole_cards,
    starting_stack, committed, net, result, hand_name
  )
  select
    v_hand_id,
    (p ->> 'user_id')::bigint,
    (p ->> 'seat')::int,
    p ->> 'position',
    coalesce(p -> 'hole_cards', '[]'::jsonb),
    (p ->> 'starting_stack')::int,
    coalesce((p ->> 'committed')::int, 0),
    coalesce((p ->> 'net')::int, 0),
    p ->> 'result',
    p ->> 'hand_name'
  from jsonb_array_elements(coalesce(payload -> 'players', '[]'::jsonb)) as p
  on conflict (hand_id, user_id) do nothing;

  insert into public.hand_actions (hand_id, seq, user_id, street, action, amount, at)
  select
    v_hand_id,
    (a ->> 'seq')::int,
    (a ->> 'user_id')::bigint,   -- null for DEAL / STREET / PAYOUT
    a ->> 'street',
    a ->> 'action',
    coalesce((a ->> 'amount')::int, 0),
    coalesce((a ->> 'at')::timestamptz, now())
  from jsonb_array_elements(coalesce(payload -> 'actions', '[]'::jsonb)) as a
  on conflict (hand_id, seq) do nothing;

  return v_hand_id;
end;
$$;

-- Only the game server's key may call it. Even if this grant were wrong, an
-- anon caller running the body would be stopped by the missing INSERT grants
-- and the write policies that do not exist — the two checks back each other up.
revoke all on function public.record_hand(jsonb) from public, anon, authenticated;
grant execute on function public.record_hand(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Check
-- ---------------------------------------------------------------------------

select
  c.relname                                             as table_name,
  c.relrowsecurity                                      as rls_enabled,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('hands', 'hand_players', 'hand_actions', 'table_seats')
order by c.relname;
