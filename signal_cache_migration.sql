-- ============================================================
-- Nexus Omega — signal_cache table
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- Signal cache table (one row, id='main', upserted every 2 min by cron)
create table if not exists signal_cache (
  id                text primary key default 'main',
  signal            text not null default 'NEUTRAL',
  confidence        numeric default 0,
  score             numeric default 0,
  regime            text default 'UNKNOWN',
  reasons           jsonb default '[]',
  risk_flags        jsonb default '[]',
  targets           jsonb default '{}',
  indicators        jsonb default '{}',
  market_structure  jsonb default '{}',
  htf_context       jsonb default '{}',
  micro_entry       jsonb default '{}',
  data_quality      jsonb default '{}',
  consensus_price   numeric default 0,
  price_exchanges   jsonb default '[]',
  price_spread      numeric default 0,
  liq_long          numeric default 0,
  liq_short         numeric default 0,
  liq_magnet        numeric,
  computed_at       timestamptz default now(),
  compute_ms        integer,
  updated_at        timestamptz default now()
);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists signal_cache_updated_at on signal_cache;
create trigger signal_cache_updated_at
  before update on signal_cache
  for each row execute procedure update_updated_at();

-- Allow service key to upsert
alter table signal_cache enable row level security;

create policy "service_full" on signal_cache
  for all using (true) with check (true);
