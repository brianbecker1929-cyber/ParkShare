-- ParkShare database schema
-- Run this in your Supabase project: SQL Editor -> New query -> paste -> Run

-- 1. Profiles: one row per authenticated user, extends built-in auth.users
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  role text not null default 'driver' check (role in ('driver', 'host')),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "Profiles are viewable by everyone"
  on profiles for select using (true);

create policy "Users can insert their own profile"
  on profiles for insert with check (auth.uid() = id);

create policy "Users can update their own profile"
  on profiles for update using (auth.uid() = id);

-- 2. Listings: driveways hosts have listed
create table if not exists listings (
  id bigint generated always as identity primary key,
  host_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  address text not null,
  price numeric not null,
  spaces int not null default 1,
  features text[] not null default '{}',
  img text,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);

alter table listings enable row level security;

create policy "Listings are viewable by everyone"
  on listings for select using (true);

create policy "Hosts can insert their own listings"
  on listings for insert with check (auth.uid() = host_id);

create policy "Hosts can update their own listings"
  on listings for update using (auth.uid() = host_id);

create policy "Hosts can delete their own listings"
  on listings for delete using (auth.uid() = host_id);

-- 3. Bookings: a driver booking a listing for a time window
create table if not exists bookings (
  id bigint generated always as identity primary key,
  listing_id bigint not null references listings(id) on delete cascade,
  renter_id uuid not null references profiles(id) on delete cascade,
  hours numeric not null,
  total numeric not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'completed')),
  created_at timestamptz not null default now()
);

alter table bookings enable row level security;

create policy "Renters can view their own bookings"
  on bookings for select using (auth.uid() = renter_id);

create policy "Hosts can view bookings on their listings"
  on bookings for select using (
    auth.uid() in (select host_id from listings where listings.id = bookings.listing_id)
  );

create policy "Renters can create bookings"
  on bookings for insert with check (auth.uid() = renter_id);

create policy "Renters can update their own bookings"
  on bookings for update using (auth.uid() = renter_id);

-- 4. Messages: chat between renter and host, scoped to a listing
create table if not exists messages (
  id bigint generated always as identity primary key,
  listing_id bigint not null references listings(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

alter table messages enable row level security;

create policy "Participants can view messages on a listing they're involved in"
  on messages for select using (
    auth.uid() = sender_id
    or auth.uid() in (select host_id from listings where listings.id = messages.listing_id)
    or auth.uid() in (select sender_id from messages m2 where m2.listing_id = messages.listing_id)
  );

create policy "Authenticated users can send messages"
  on messages for insert with check (auth.uid() = sender_id);

-- 5. Reviews
create table if not exists reviews (
  id bigint generated always as identity primary key,
  listing_id bigint not null references listings(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  text text,
  created_at timestamptz not null default now()
);

alter table reviews enable row level security;

create policy "Reviews are viewable by everyone"
  on reviews for select using (true);

create policy "Authenticated users can leave reviews"
  on reviews for insert with check (auth.uid() = user_id);

-- 6. Stripe Connect fields (safe to run after the original schema)
alter table profiles add column if not exists stripe_account_id text unique;
alter table profiles add column if not exists stripe_onboarding_complete boolean not null default false;
alter table profiles add column if not exists stripe_charges_enabled boolean not null default false;
alter table profiles add column if not exists stripe_payouts_enabled boolean not null default false;
alter table profiles add column if not exists stripe_requirements_due text[] not null default '{}';

alter table bookings drop constraint if exists bookings_status_check;
alter table bookings add constraint bookings_status_check check (
  status in ('pending', 'confirmed', 'cancelled', 'completed', 'payment_failed', 'refunded', 'partially_refunded', 'disputed')
);
alter table bookings add column if not exists subtotal numeric;
alter table bookings add column if not exists service_fee numeric;
alter table bookings add column if not exists stripe_checkout_session_id text unique;
alter table bookings add column if not exists stripe_payment_intent_id text;
alter table bookings add column if not exists stripe_charge_id text;
alter table bookings add column if not exists stripe_connected_account_id text;
alter table bookings add column if not exists spot_label text;
alter table bookings add column if not exists booking_date text;
alter table bookings add column if not exists start_hour numeric;
alter table bookings add column if not exists end_hour numeric;
alter table bookings add column if not exists paid_at timestamptz;

create index if not exists profiles_stripe_account_id_idx on profiles(stripe_account_id);
create index if not exists bookings_stripe_payment_intent_id_idx on bookings(stripe_payment_intent_id);
