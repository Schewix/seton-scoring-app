create table if not exists public.content_gallery_albums (
  folder_id text primary key,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_content_gallery_albums_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_content_gallery_albums_updated_at on public.content_gallery_albums;
create trigger set_content_gallery_albums_updated_at
  before update on public.content_gallery_albums
  for each row execute function public.set_content_gallery_albums_updated_at();

alter table public.content_gallery_albums enable row level security;
