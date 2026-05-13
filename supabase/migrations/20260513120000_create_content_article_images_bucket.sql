insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-article-images',
  'content-article-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "content_article_images_public_read" on storage.objects;
create policy "content_article_images_public_read" on storage.objects
  for select using (
    bucket_id = 'content-article-images'
    and auth.role() in ('anon', 'authenticated', 'service_role')
  );

drop policy if exists "content_article_images_admin_insert" on storage.objects;
create policy "content_article_images_admin_insert" on storage.objects
  for insert with check (
    bucket_id = 'content-article-images'
    and auth.role() = 'service_role'
  );

drop policy if exists "content_article_images_admin_update" on storage.objects;
create policy "content_article_images_admin_update" on storage.objects
  for update using (
    bucket_id = 'content-article-images'
    and auth.role() = 'service_role'
  ) with check (
    bucket_id = 'content-article-images'
    and auth.role() = 'service_role'
  );

drop policy if exists "content_article_images_admin_delete" on storage.objects;
create policy "content_article_images_admin_delete" on storage.objects
  for delete using (
    bucket_id = 'content-article-images'
    and auth.role() = 'service_role'
  );
