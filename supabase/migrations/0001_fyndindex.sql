-- Fyndindex -- schema.
--
-- Kör bara den här om du vill ha inloggning och delad historik. POC:en
-- fungerar helt utan Supabase: insamlaren skriver data/snapshot-latest.json
-- och webbappen läser den filen direkt.
--
-- Fyndindex delar Supabase-projekt med Packlista och Tor-dash. Därför är
-- allt prefixat fyndindex_ och rör inte befintliga tabeller. Sessionerna
-- hålls isär av storageKey i app.js, inte av databasen.

-- ---------------------------------------------------------------------------
-- Insamlade ögonblicksbilder. En rad per körning.
-- ---------------------------------------------------------------------------
create table if not exists public.fyndindex_snapshots (
  id            bigint generated always as identity primary key,
  collected_at  timestamptz not null default now(),
  markets       text[]      not null default '{SE}',
  -- Hela snapshot-objektet som collectorn producerar. jsonb och inte
  -- normaliserade tabeller med flit: formen ändras varje gång du lägger
  -- till en källa eller ett mått, och en POC ska inte betala en migrering
  -- för varje sådan ändring.
  payload       jsonb       not null,
  created_by    uuid        references auth.users(id) on delete set null
);

create index if not exists fyndindex_snapshots_collected_at_idx
  on public.fyndindex_snapshots (collected_at desc);

alter table public.fyndindex_snapshots enable row level security;

-- Trenddatan är sammanställd av publik information och innehåller inget
-- personligt. Alla får läsa den, även utloggade -- det är hela poängen med
-- att översikten ska gå att visa utan konto.
drop policy if exists "fyndindex_snapshots_read" on public.fyndindex_snapshots;
create policy "fyndindex_snapshots_read"
  on public.fyndindex_snapshots for select
  using (true);

-- Skriva får bara inloggade göra. I praktiken är det insamlaren som kör med
-- en service role-nyckel och därmed går förbi RLS helt; den här policyn
-- finns för när du kör den för hand från din egen session.
drop policy if exists "fyndindex_snapshots_write" on public.fyndindex_snapshots;
create policy "fyndindex_snapshots_write"
  on public.fyndindex_snapshots for insert
  to authenticated
  with check (auth.uid() = created_by);

-- ---------------------------------------------------------------------------
-- Dina egna annonser, för korsannonseringskontrollen.
-- ---------------------------------------------------------------------------
create table if not exists public.fyndindex_my_listings (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  source         text not null default 'tradera',
  source_item_id text not null,
  title          text not null,
  url            text,
  price_sek      integer,
  category_id    text,
  -- Normaliserad ordmängd från titeln, samma som titleFingerprint() i
  -- collector/core/normalize.js. Sparad så att matchningen kan göras i SQL
  -- när annonsmängden blir för stor för att jämföras i webbläsaren.
  fingerprint    text[],
  updated_at     timestamptz not null default now(),
  unique (user_id, source, source_item_id)
);

alter table public.fyndindex_my_listings enable row level security;

-- Dina annonser är dina. Ingen delning, ingen publik läsning -- till
-- skillnad från snapshots ovan.
drop policy if exists "fyndindex_my_listings_owner" on public.fyndindex_my_listings;
create policy "fyndindex_my_listings_owner"
  on public.fyndindex_my_listings for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Flaggade dubbletter: "den här av mina saker ligger också ute hos X".
-- ---------------------------------------------------------------------------
create table if not exists public.fyndindex_cross_listings (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  listing_id    bigint not null references public.fyndindex_my_listings(id) on delete cascade,
  match_source  text not null,
  match_url     text not null,
  match_title   text not null,
  match_price_sek integer,
  -- Jaccard-likhet 0–1. Sparas som numeric för att du ska kunna sortera på
  -- den och själv bedöma var tröskeln bör ligga -- 0.45 är en gissning som
  -- fungerar bra på svenska annonstitlar, inte en sanning.
  similarity    numeric(4,3) not null,
  dismissed     boolean not null default false,
  found_at      timestamptz not null default now(),
  unique (listing_id, match_source, match_url)
);

alter table public.fyndindex_cross_listings enable row level security;

drop policy if exists "fyndindex_cross_listings_owner" on public.fyndindex_cross_listings;
create policy "fyndindex_cross_listings_owner"
  on public.fyndindex_cross_listings for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Bekvämlighetsvy: senaste insamlingen, utan att appen behöver sortera själv.
-- ---------------------------------------------------------------------------
create or replace view public.fyndindex_latest as
  select collected_at, markets, payload
  from public.fyndindex_snapshots
  order by collected_at desc
  limit 1;
