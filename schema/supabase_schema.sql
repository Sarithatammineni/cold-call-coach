-- ============================================================================
--  Cold Call Coach — Supabase schema
--  Run this first, then seed_stages.sql, in the Supabase SQL editor.
--  Everything here is server-side: the browser never talks to Supabase
--  directly, the Render API does, with the service_role key.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- stages — the reference sheet: the eight stages of the call, what each is
-- for, what prospects tend to say there, and what the caller should do.
-- Seeded from seed_stages.sql.
-- ---------------------------------------------------------------------------
create table if not exists stages (
  number          integer primary key,          -- 1..8, order of the call
  key             text        not null unique,
  name            text        not null,         -- short label shown on screen
  purpose         text        not null,         -- what this stage is for
  caller_does     jsonb       not null default '[]'::jsonb,  -- what to do here
  prospects_say   jsonb       not null default '[]'::jsonb,  -- likely prospect lines
  prospects_mean  jsonb       not null default '[]'::jsonb,  -- what those lines mean
  tap_options     jsonb       not null default '[]'::jsonb,  -- "what happened" taps
  watch_out       text,                          -- the way this stage goes wrong
  median_seconds  integer,                       -- how long it lasts in real calls
  exit_pct        numeric(5,2),                  -- % of calls that end right here
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- outcomes — the list the caller picks from when they close a call, and the
-- tone the history screen uses to badge the row. Seeded by seed_stages.sql.
-- ---------------------------------------------------------------------------
create table if not exists outcomes (
  key   text primary key,
  label text not null,
  tone  text not null default 'warm',  -- good | warm | bad
  meta  text
);

-- ---------------------------------------------------------------------------
-- calls — one row per phone call.
-- ---------------------------------------------------------------------------
create table if not exists calls (
  id              uuid primary key default gen_random_uuid(),
  prospect_name   text        not null,
  company         text,
  phone           text,
  caller          text,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  outcome         text,                          -- final outcome of the call
  outcome_note    text,
  reached_stage   integer     references stages(number),  -- furthest stage reached
  created_by      text,
  updated_at      timestamptz not null default now()
);

create index if not exists calls_started_at_idx on calls (started_at desc);
create index if not exists calls_outcome_idx     on calls (outcome);

-- ---------------------------------------------------------------------------
-- stage_results — what happened at each stage of one call, and the
-- prospect's own words captured there. One row per (call, stage); re-tapping
-- a stage overwrites it rather than duplicating.
-- ---------------------------------------------------------------------------
create table if not exists stage_results (
  id               uuid primary key default gen_random_uuid(),
  call_id          uuid not null references calls(id) on delete cascade,
  stage_number     integer not null references stages(number),
  what_happened    jsonb    not null default '[]'::jsonb,   -- tapped answers
  prospect_words   text,                                    -- the prospect's own words
  seconds_on_stage integer,
  skipped          boolean  not null default false,
  saved_at         timestamptz not null default now(),
  unique (call_id, stage_number)
);

create index if not exists stage_results_call_idx on stage_results (call_id, stage_number);

-- Keep calls.updated_at honest.
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists calls_touch on calls;
create trigger calls_touch before update on calls
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- advance_reached_stage — the API asks this after every saved stage so the
-- "stage this call reached" on the history screen is derived from real rows,
-- never from a guess sent by the client.
-- ---------------------------------------------------------------------------
create or replace function advance_reached_stage(p_call_id uuid, p_stage integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update calls
     set reached_stage = p_stage
   where id = p_call_id
     and (reached_stage is null or reached_stage < p_stage);
end $$;

-- The API reads and writes with the service_role key, which bypasses RLS.
-- Lock the tables down anyway so a leaked anon key can read nothing.
alter table stages        enable row level security;
alter table calls         enable row level security;
alter table stage_results enable row level security;
alter table outcomes      enable row level security;

do $$
declare r record;
begin
  for r in
    select tablename from pg_tables
     where schemaname = 'public'
       and tablename in ('stages', 'calls', 'stage_results', 'outcomes')
  loop
    execute format('drop policy if exists %I_service_only on public.%I', r.tablename, r.tablename);
  end loop;
end $$;

-- No policies: with RLS on and no policy, anon/authenticated reads return zero rows.
