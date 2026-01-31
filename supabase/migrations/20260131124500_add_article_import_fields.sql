alter table public.content_articles
  add column if not exists source text not null default 'local' check (source in ('local', 'pionyr')),
  add column if not exists external_id text,
  add column if not exists external_url text,
  add column if not exists synced_at timestamptz;

create index if not exists content_articles_source_idx
  on public.content_articles (source);

create unique index if not exists content_articles_source_external_id_idx
  on public.content_articles (source, external_id)
  where external_id is not null;
