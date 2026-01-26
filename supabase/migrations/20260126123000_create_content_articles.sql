create table if not exists public.content_articles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  excerpt text,
  body text,
  author text,
  cover_image_url text,
  cover_image_alt text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_articles_published_at_idx
  on public.content_articles (published_at desc);

create index if not exists content_articles_status_idx
  on public.content_articles (status);

create or replace function public.set_content_articles_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_content_articles_updated_at on public.content_articles;
create trigger set_content_articles_updated_at
  before update on public.content_articles
  for each row execute function public.set_content_articles_updated_at();

alter table public.content_articles enable row level security;
