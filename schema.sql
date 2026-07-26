-- ============================================================
-- Charted — schema for Supabase
-- Run this in your Supabase project's SQL editor (SQL Editor > New query)
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- TOPICS (the map's regions) ----------
create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  parent_id uuid references topics(id) on delete cascade,
  title text not null,
  status text not null default 'uncharted' check (status in ('uncharted','exploring','charted','review')),
  position int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_reviewed_at timestamptz default now()
);

-- ---------- NOTES (field notes) ----------
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  topic_id uuid references topics(id) on delete cascade not null,
  content text not null default '',
  tags text[] not null default '{}',
  pinned boolean not null default false,
  is_quick_ref boolean not null default false,
  image_paths text[] not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- CHECKLIST ITEMS (step-by-step how-tos) ----------
create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  topic_id uuid references topics(id) on delete cascade not null,
  text text not null,
  checked boolean not null default false,
  position int default 0,
  created_at timestamptz default now()
);

-- ---------- ACTIVITY LOG (for streaks) ----------
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  activity_date date not null default current_date,
  unique(user_id, activity_date)
);

-- ============================================================
-- Row Level Security — every user only ever sees their own rows
-- ============================================================
alter table topics enable row level security;
alter table notes enable row level security;
alter table checklist_items enable row level security;
alter table activity_log enable row level security;

create policy "own topics" on topics for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own notes" on notes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own checklist items" on checklist_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own activity" on activity_log for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Storage — bucket for note screenshots/images
-- Run these AFTER creating a bucket named "note-images" in
-- Supabase Dashboard > Storage (create it as a private bucket).
-- ============================================================
create policy "own images read" on storage.objects for select
  using (bucket_id = 'note-images' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "own images write" on storage.objects for insert
  with check (bucket_id = 'note-images' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "own images delete" on storage.objects for delete
  using (bucket_id = 'note-images' and auth.uid()::text = (storage.foldername(name))[1]);
